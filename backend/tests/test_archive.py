"""Archiving a card: off the board, but not gone."""

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


def board_data(client, board: str) -> dict:
    response = client.get(f"/api/boards/{board}")
    assert response.status_code == 200, response.text
    return response.json()


def archive(client, card_id: str, archived: bool = True):
    return client.patch(
        f"/api/cards/{card_id}/archived", json={"archived": archived}
    )


@pytest.fixture
def board(client):
    sign_in(client)
    return owned_board_id(client)


def test_an_archived_card_leaves_the_board_but_stays_in_the_archive(
    client, board
):
    column = board_data(client, board)["columns"][0]
    card_id = column["cardIds"][0]
    title = board_data(client, board)["cards"][card_id]["title"]

    response = archive(client, card_id)

    assert response.status_code == 200, response.text
    assert card_id not in response.json()["cards"]
    assert card_id not in response.json()["columns"][0]["cardIds"]
    archived = client.get(f"/api/boards/{board}/archive").json()
    assert [entry["title"] for entry in archived] == [title]
    assert archived[0]["column_title"] == column["title"]
    assert archived[0]["archived_at"]


def test_an_archived_card_is_restored_to_the_foot_of_its_column(client, board):
    column = board_data(client, board)["columns"][0]
    card_id = column["cardIds"][0]
    remaining = [id for id in column["cardIds"] if id != card_id]
    archive(client, card_id)

    response = archive(client, card_id, archived=False)

    assert response.status_code == 200, response.text
    assert response.json()["columns"][0]["cardIds"] == [*remaining, card_id]
    assert client.get(f"/api/boards/{board}/archive").json() == []


def test_the_column_closes_the_gap_an_archived_card_left(client, board):
    column = board_data(client, board)["columns"][0]
    archive(client, column["cardIds"][0])

    # A gap would collide with the position the next card is given.
    created = client.post(
        "/api/cards", json={"column_id": column["id"], "title": "Next"}
    )

    assert created.status_code == 201, created.text
    assert board_data(client, board)["columns"][0]["cardIds"][-1] == (
        created.json()["id"]
    )


def test_a_card_dropped_at_the_end_lands_before_the_archive(client, board):
    columns = board_data(client, board)["columns"]
    destination = columns[1]
    archive(client, destination["cardIds"][0])
    moving = columns[0]["cardIds"][0]

    response = client.patch(
        f"/api/cards/{moving}/move",
        json={
            "column_id": destination["id"],
            "position": len(destination["cardIds"]) - 1,
        },
    )

    assert response.status_code == 200, response.text
    landed = next(
        column
        for column in response.json()["columns"]
        if column["id"] == destination["id"]
    )
    assert landed["cardIds"][-1] == moving


def test_an_archived_card_keeps_its_comments_and_checklist(client, board):
    card_id = board_data(client, board)["columns"][0]["cardIds"][0]
    client.post(f"/api/cards/{card_id}/comments", json={"body": "For later"})
    client.post(f"/api/cards/{card_id}/checklist", json={"body": "Unfinished"})

    archive(client, card_id)
    archive(client, card_id, archived=False)

    card = board_data(client, board)["cards"][card_id]
    assert card["commentCount"] == 1
    assert card["checklistTotal"] == 1


def test_an_archived_card_survives_a_whole_board_rewrite(client, board):
    card_id = board_data(client, board)["columns"][0]["cardIds"][0]
    client.post(f"/api/cards/{card_id}/comments", json={"body": "For later"})
    archive(client, card_id)
    rewritten = board_data(client, board)

    response = client.put(f"/api/boards/{board}", json=rewritten)

    assert response.status_code == 200, response.text
    assert card_id not in response.json()["cards"]
    assert [
        entry["id"] for entry in client.get(f"/api/boards/{board}/archive").json()
    ] == [card_id]
    comments = client.get(f"/api/cards/{card_id}/comments").json()
    assert [comment["body"] for comment in comments] == ["For later"]


def test_a_rewrite_that_drops_a_column_drops_what_it_archived(client, board):
    columns = board_data(client, board)["columns"]
    archive(client, columns[0]["cardIds"][0])
    without_first = board_data(client, board)
    dropped = without_first["columns"].pop(0)
    for card_id in dropped["cardIds"]:
        del without_first["cards"][card_id]

    response = client.put(f"/api/boards/{board}", json=without_first)

    assert response.status_code == 200, response.text
    assert client.get(f"/api/boards/{board}/archive").json() == []


def test_a_rewrite_that_still_shows_an_archived_card_keeps_it_visible(
    client, board
):
    # A tab open since before the archive sends the card back as visible.
    stale = board_data(client, board)
    card_id = stale["columns"][0]["cardIds"][0]
    archive(client, card_id)

    response = client.put(f"/api/boards/{board}", json=stale)

    assert response.status_code == 200, response.text
    assert card_id in response.json()["cards"]
    assert client.get(f"/api/boards/{board}/archive").json() == []


def test_an_archived_card_goes_with_the_column_it_was_archived_from(
    client, board
):
    column = board_data(client, board)["columns"][0]
    card_id = column["cardIds"][0]
    archive(client, card_id)

    assert client.delete(f"/api/columns/{column['id']}").status_code == 200

    assert client.get(f"/api/boards/{board}/archive").json() == []


def test_archiving_is_recorded_in_the_board_history(client, board):
    card_id = board_data(client, board)["columns"][0]["cardIds"][0]
    title = board_data(client, board)["cards"][card_id]["title"]

    archive(client, card_id)
    archive(client, card_id, archived=False)

    summaries = [
        entry["summary"]
        for entry in client.get(f"/api/boards/{board}/activity").json()
    ]
    assert summaries[:2] == [
        f'Restored card "{title}"',
        f'Archived card "{title}"',
    ]


def test_a_member_can_archive_and_read_the_archive_of_a_shared_board(app):
    with TestClient(app) as owner, TestClient(app) as member:
        register(member, MEMBER)
        sign_in(owner)
        board = owned_board_id(owner)
        owner.post(
            f"/api/boards/{board}/members", json={"username": MEMBER["username"]}
        )
        card_id = board_data(member, board)["columns"][0]["cardIds"][0]

        assert archive(member, card_id).status_code == 200

        archived = owner.get(f"/api/boards/{board}/archive").json()
        assert [entry["id"] for entry in archived] == [card_id]


def test_a_non_member_cannot_archive_or_read_the_archive(app):
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(stranger, MEMBER)
        sign_in(owner)
        board = owned_board_id(owner)
        card_id = board_data(owner, board)["columns"][0]["cardIds"][0]

        assert archive(stranger, card_id).status_code == 404
        assert stranger.get(f"/api/boards/{board}/archive").status_code == 404


@pytest.mark.parametrize("payload", [{}, {"archived": "later"}, {"archived": None}])
def test_an_unusable_archive_flag_is_malformed(client, board, payload):
    card_id = board_data(client, board)["columns"][0]["cardIds"][0]

    response = client.patch(f"/api/cards/{card_id}/archived", json=payload)

    assert response.status_code == 422


def test_archiving_requires_a_session(client):
    assert archive(client, "anything").status_code == 401
    assert client.get("/api/boards/anything/archive").status_code == 401
