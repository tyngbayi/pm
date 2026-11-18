"""Moving a card to another board the user can open."""

from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient

ADMIN = {"username": "user", "password": "password"}
MEMBER = {"username": "teammate", "password": "hunter2hunter2"}


def sign_in(client, credentials=ADMIN):
    response = client.post("/api/auth/login", json=credentials)
    assert response.status_code == 200, response.text
    return response.json()


def register(client, credentials):
    response = client.post("/api/auth/register", json=credentials)
    assert response.status_code == 201, response.text
    return response.json()


def owned_board_id(client) -> str:
    boards = client.get("/api/boards").json()
    return next(board["id"] for board in boards if board["owned"])


def create_board(client, name: str) -> str:
    response = client.post("/api/boards", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def board_data(client, board: str) -> dict:
    response = client.get(f"/api/boards/{board}")
    assert response.status_code == 200, response.text
    return response.json()


class Pair(NamedTuple):
    source: str
    destination: str
    card_id: str


@pytest.fixture
def pair(client):
    """Two of one owner's boards, with a card on the first."""
    sign_in(client)
    source = owned_board_id(client)
    destination = create_board(client, "Destination")
    card_id = board_data(client, source)["columns"][0]["cardIds"][0]
    return Pair(source, destination, card_id)


def test_a_card_moves_to_the_end_of_the_destinations_first_column(client, pair):
    title = board_data(client, pair.source)["cards"][pair.card_id]["title"]
    before = board_data(client, pair.destination)["columns"][0]["cardIds"]

    response = client.patch(
        f"/api/cards/{pair.card_id}/board", json={"board_id": pair.destination}
    )

    assert response.status_code == 200, response.text
    # The response is the board the card left, since that is the one on screen.
    assert pair.card_id not in response.json()["cards"]
    assert response.json() == board_data(client, pair.source)
    landed = board_data(client, pair.destination)
    assert landed["columns"][0]["cardIds"] == [*before, pair.card_id]
    assert landed["cards"][pair.card_id]["title"] == title


def test_the_source_column_closes_the_gap_the_card_left(client, pair):
    column = board_data(client, pair.source)["columns"][0]
    remaining = [id for id in column["cardIds"] if id != pair.card_id]

    client.patch(
        f"/api/cards/{pair.card_id}/board", json={"board_id": pair.destination}
    )

    moved = board_data(client, pair.source)["columns"][0]
    assert moved["cardIds"] == remaining
    # Positions are absolute, so a gap would collide with the next insert.
    created = client.post(
        "/api/cards", json={"column_id": column["id"], "title": "Next"}
    )
    assert created.status_code == 201, created.text


def test_a_cards_comments_and_checklist_travel_with_it(client, pair):
    client.post(
        f"/api/cards/{pair.card_id}/comments", json={"body": "Still relevant"}
    )
    client.post(
        f"/api/cards/{pair.card_id}/checklist", json={"body": "Still to do"}
    )

    client.patch(
        f"/api/cards/{pair.card_id}/board", json={"board_id": pair.destination}
    )

    comments = client.get(f"/api/cards/{pair.card_id}/comments").json()
    assert [comment["body"] for comment in comments] == ["Still relevant"]
    checklist = client.get(f"/api/cards/{pair.card_id}/checklist").json()
    assert [item["body"] for item in checklist] == ["Still to do"]
    card = board_data(client, pair.destination)["cards"][pair.card_id]
    assert card["commentCount"] == 1
    assert card["checklistTotal"] == 1


def test_an_assignee_who_cannot_open_the_destination_is_cleared(app):
    with TestClient(app) as owner, TestClient(app) as member:
        member_account = register(member, MEMBER)
        sign_in(owner)
        source = owned_board_id(owner)
        owner.post(
            f"/api/boards/{source}/members",
            json={"username": MEMBER["username"]},
        )
        destination = create_board(owner, "Private")
        card_id = board_data(owner, source)["columns"][0]["cardIds"][0]
        assigned = owner.patch(
            f"/api/cards/{card_id}", json={"assigneeId": member_account["id"]}
        )
        assert assigned.status_code == 200, assigned.text

        owner.patch(
            f"/api/cards/{card_id}/board", json={"board_id": destination}
        )

        card = board_data(owner, destination)["cards"][card_id]
        assert card["assigneeId"] is None


def test_an_assignee_who_can_open_the_destination_keeps_the_card(app):
    with TestClient(app) as owner, TestClient(app) as member:
        member_account = register(member, MEMBER)
        sign_in(owner)
        source = owned_board_id(owner)
        destination = create_board(owner, "Also shared")
        for board in (source, destination):
            owner.post(
                f"/api/boards/{board}/members",
                json={"username": MEMBER["username"]},
            )
        card_id = board_data(owner, source)["columns"][0]["cardIds"][0]
        owner.patch(
            f"/api/cards/{card_id}", json={"assigneeId": member_account["id"]}
        )

        owner.patch(
            f"/api/cards/{card_id}/board", json={"board_id": destination}
        )

        card = board_data(owner, destination)["cards"][card_id]
        assert card["assigneeId"] == member_account["id"]


def test_both_boards_record_the_move(client, pair):
    title = board_data(client, pair.source)["cards"][pair.card_id]["title"]

    client.patch(
        f"/api/cards/{pair.card_id}/board", json={"board_id": pair.destination}
    )

    left = client.get(f"/api/boards/{pair.source}/activity").json()
    arrived = client.get(f"/api/boards/{pair.destination}/activity").json()
    assert left[0]["summary"] == f'Moved card "{title}" to board "Destination"'
    assert arrived[0]["summary"].startswith(f'Moved card "{title}" in from board ')


def test_a_member_can_move_a_card_onto_a_board_they_share(app):
    with TestClient(app) as owner, TestClient(app) as member:
        register(member, MEMBER)
        sign_in(owner)
        source = owned_board_id(owner)
        owner.post(
            f"/api/boards/{source}/members",
            json={"username": MEMBER["username"]},
        )
        destination = owned_board_id(member)
        card_id = board_data(member, source)["columns"][0]["cardIds"][0]

        response = member.patch(
            f"/api/cards/{card_id}/board", json={"board_id": destination}
        )

        assert response.status_code == 200, response.text
        assert card_id in board_data(member, destination)["cards"]


def test_a_board_the_user_cannot_open_is_a_404(app):
    with TestClient(app) as owner, TestClient(app) as member:
        register(member, MEMBER)
        sign_in(owner)
        source = owned_board_id(owner)
        card_id = board_data(owner, source)["columns"][0]["cardIds"][0]
        stranger_board = owned_board_id(member)

        response = owner.patch(
            f"/api/cards/{card_id}/board", json={"board_id": stranger_board}
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Board not found"


def test_a_card_the_user_cannot_reach_is_a_404(app):
    with TestClient(app) as owner, TestClient(app) as member:
        register(member, MEMBER)
        sign_in(owner)
        owner_card = board_data(owner, owned_board_id(owner))["columns"][0][
            "cardIds"
        ][0]
        destination = owned_board_id(member)

        response = member.patch(
            f"/api/cards/{owner_card}/board", json={"board_id": destination}
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Card not found"


def test_a_destination_with_no_columns_is_refused(client, pair):
    for column in board_data(client, pair.destination)["columns"]:
        client.delete(f"/api/columns/{column['id']}")

    response = client.patch(
        f"/api/cards/{pair.card_id}/board", json={"board_id": pair.destination}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "That board has no columns to hold the card"


def test_moving_a_card_to_the_board_it_is_already_on_is_refused(client, pair):
    response = client.patch(
        f"/api/cards/{pair.card_id}/board", json={"board_id": pair.source}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "The card is already on that board"


@pytest.mark.parametrize("payload", [{}, {"board_id": ""}, {"board_id": None}])
def test_an_unusable_destination_is_malformed(client, pair, payload):
    response = client.patch(f"/api/cards/{pair.card_id}/board", json=payload)

    assert response.status_code == 422


def test_moving_a_card_requires_a_session(client):
    response = client.patch(
        "/api/cards/anything/board", json={"board_id": "anywhere"}
    )

    assert response.status_code == 401
