"""Card dependencies: what has to be done before what."""

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


def card_ids(client, board: str) -> list[str]:
    data = board_data(client, board)
    return [id for column in data["columns"] for id in column["cardIds"]]


def block(client, blocked: str, blocker: str):
    return client.post(
        f"/api/cards/{blocked}/links", json={"blocker_id": blocker}
    )


def links(client, card_id: str) -> dict:
    response = client.get(f"/api/cards/{card_id}/links")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def board(client):
    sign_in(client)
    return owned_board_id(client)


def test_a_card_blocked_by_another_names_it_from_both_sides(client, board):
    blocked, blocker = card_ids(client, board)[:2]
    titles = board_data(client, board)["cards"]

    response = block(client, blocked, blocker)

    assert response.status_code == 201, response.text
    assert response.json()["card_id"] == blocker
    assert response.json()["title"] == titles[blocker]["title"]
    assert response.json()["column_title"] == "Backlog"
    assert [entry["card_id"] for entry in links(client, blocked)["blocked_by"]] == [
        blocker
    ]
    assert links(client, blocked)["blocks"] == []
    assert [entry["card_id"] for entry in links(client, blocker)["blocks"]] == [
        blocked
    ]


def test_the_board_counts_what_is_blocking_each_card(client, board):
    blocked, blocker = card_ids(client, board)[:2]

    block(client, blocked, blocker)

    cards = board_data(client, board)["cards"]
    assert cards[blocked]["blockerCount"] == 1
    assert cards[blocker]["blockerCount"] == 0


def test_a_dependency_is_lifted_by_deleting_the_link(client, board):
    blocked, blocker = card_ids(client, board)[:2]
    link_id = block(client, blocked, blocker).json()["id"]

    response = client.delete(f"/api/links/{link_id}")

    assert response.status_code == 204, response.text
    assert links(client, blocked)["blocked_by"] == []
    assert board_data(client, board)["cards"][blocked]["blockerCount"] == 0


def test_deleting_a_card_lifts_the_dependencies_it_was_part_of(client, board):
    blocked, blocker = card_ids(client, board)[:2]
    block(client, blocked, blocker)

    assert client.delete(f"/api/cards/{blocker}").status_code == 204

    assert links(client, blocked)["blocked_by"] == []


def test_an_archived_blocker_still_blocks(client, board):
    # Parking the blocker does not finish it, so the dependency stands.
    blocked, blocker = card_ids(client, board)[:2]
    block(client, blocked, blocker)

    client.patch(f"/api/cards/{blocker}/archived", json={"archived": True})

    assert [
        entry["card_id"] for entry in links(client, blocked)["blocked_by"]
    ] == [blocker]


def test_a_card_cannot_block_itself(client, board):
    card_id = card_ids(client, board)[0]

    response = block(client, card_id, card_id)

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == "A card cannot block itself"


def test_a_dependency_that_closes_a_loop_is_refused(client, board):
    first, second, third = card_ids(client, board)[:3]
    block(client, second, first)
    block(client, third, second)

    # first -> second -> third already, so third blocking first is a cycle.
    response = block(client, first, third)

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == "That would make the dependency circular"
    assert links(client, first)["blocked_by"] == []


def test_the_same_dependency_is_not_recorded_twice(client, board):
    blocked, blocker = card_ids(client, board)[:2]
    block(client, blocked, blocker)

    response = block(client, blocked, blocker)

    assert response.status_code == 409, response.text
    assert len(links(client, blocked)["blocked_by"]) == 1


def test_two_cards_may_both_block_a_third(client, board):
    blocked, first, second = card_ids(client, board)[:3]

    assert block(client, blocked, first).status_code == 201
    assert block(client, blocked, second).status_code == 201

    assert board_data(client, board)["cards"][blocked]["blockerCount"] == 2


def test_a_blocker_on_another_board_is_refused(client, board):
    other = client.post("/api/boards", json={"name": "Roadmap"}).json()["id"]
    blocked = card_ids(client, board)[0]
    elsewhere = card_ids(client, other)[0]

    response = block(client, blocked, elsewhere)

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "That card is not on this board"


def test_moving_a_card_to_another_board_lifts_its_dependencies(client, board):
    other = client.post("/api/boards", json={"name": "Roadmap"}).json()["id"]
    blocked, blocker = card_ids(client, board)[:2]
    block(client, blocked, blocker)

    response = client.patch(
        f"/api/cards/{blocker}/board", json={"board_id": other}
    )

    assert response.status_code == 200, response.text
    assert links(client, blocked)["blocked_by"] == []
    assert links(client, blocker)["blocks"] == []


def test_dependencies_survive_a_whole_board_rewrite(client, board):
    blocked, blocker = card_ids(client, board)[:2]
    block(client, blocked, blocker)
    rewritten = board_data(client, board)

    response = client.put(f"/api/boards/{board}", json=rewritten)

    assert response.status_code == 200, response.text
    assert response.json()["cards"][blocked]["blockerCount"] == 1
    assert [
        entry["card_id"] for entry in links(client, blocked)["blocked_by"]
    ] == [blocker]


def test_a_rewrite_that_drops_one_end_drops_the_dependency(client, board):
    columns = board_data(client, board)["columns"]
    blocked, blocker = columns[0]["cardIds"][:2]
    block(client, blocked, blocker)
    without_first = board_data(client, board)
    dropped = without_first["columns"].pop(0)
    for card_id in dropped["cardIds"]:
        del without_first["cards"][card_id]

    response = client.put(f"/api/boards/{board}", json=without_first)

    assert response.status_code == 200, response.text
    assert client.get(f"/api/cards/{blocked}/links").status_code == 404


def test_blocking_is_recorded_in_the_board_history(client, board):
    blocked, blocker = card_ids(client, board)[:2]
    titles = board_data(client, board)["cards"]

    block(client, blocked, blocker)

    summaries = [
        entry["summary"]
        for entry in client.get(f"/api/boards/{board}/activity").json()
    ]
    assert summaries[0] == (
        f'Blocked card "{titles[blocked]["title"]}" on'
        f' "{titles[blocker]["title"]}"'
    )


def test_a_member_of_a_shared_board_can_manage_its_dependencies(app):
    with TestClient(app) as owner, TestClient(app) as member:
        register(member, MEMBER)
        sign_in(owner)
        board = owned_board_id(owner)
        owner.post(
            f"/api/boards/{board}/members", json={"username": MEMBER["username"]}
        )
        blocked, blocker = card_ids(member, board)[:2]

        created = block(member, blocked, blocker)

        assert created.status_code == 201, created.text
        assert len(links(owner, blocked)["blocked_by"]) == 1
        assert member.delete(f"/api/links/{created.json()['id']}").status_code == (
            204
        )


def test_a_non_member_cannot_read_or_change_dependencies(app):
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(stranger, MEMBER)
        sign_in(owner)
        board = owned_board_id(owner)
        blocked, blocker = card_ids(owner, board)[:2]
        link_id = block(owner, blocked, blocker).json()["id"]

        assert stranger.get(f"/api/cards/{blocked}/links").status_code == 404
        assert block(stranger, blocked, blocker).status_code == 404
        assert stranger.delete(f"/api/links/{link_id}").status_code == 404


def test_an_unknown_card_or_link_is_not_found(client, board):
    blocker = card_ids(client, board)[0]

    assert client.get("/api/cards/missing/links").status_code == 404
    assert block(client, "missing", blocker).status_code == 404
    assert client.delete("/api/links/missing").status_code == 404


@pytest.mark.parametrize("payload", [{}, {"blocker_id": ""}, {"blocker_id": None}])
def test_an_unusable_blocker_is_malformed(client, board, payload):
    card_id = card_ids(client, board)[0]

    response = client.post(f"/api/cards/{card_id}/links", json=payload)

    assert response.status_code == 422


def test_dependencies_require_a_session(client):
    assert client.get("/api/cards/anything/links").status_code == 401
    assert block(client, "anything", "other").status_code == 401
    assert client.delete("/api/links/anything").status_code == 401
