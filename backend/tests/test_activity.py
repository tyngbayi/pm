"""The per-board history of who changed what."""

from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient

ADMIN = {"username": "user", "password": "password"}
MEMBER = {"username": "teammate", "password": "hunter2hunter2"}
OUTSIDER = {"username": "stranger", "password": "hunter2hunter2"}


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


def summaries(client, board: str) -> list[str]:
    response = client.get(f"/api/boards/{board}/activity")
    assert response.status_code == 200, response.text
    return [entry["summary"] for entry in response.json()]


class Shared(NamedTuple):
    owner: TestClient
    member: TestClient
    board: str
    member_id: str
    member_name: str


@pytest.fixture
def shared(app):
    """An owner and a member sharing one board."""
    with TestClient(app) as owner, TestClient(app) as member:
        account = register(member, MEMBER)
        sign_in(owner)
        board = owned_board_id(owner)
        added = owner.post(
            f"/api/boards/{board}/members", json={"username": MEMBER["username"]}
        )
        assert added.status_code == 201, added.text
        yield Shared(
            owner, member, board, account["id"], account["display_name"]
        )


def test_a_new_board_starts_with_an_empty_history(client):
    sign_in(client)
    created = client.post("/api/boards", json={"name": "Platform"})
    assert created.status_code == 201, created.text

    assert summaries(client, created.json()["id"]) == []


def test_every_kind_of_change_is_recorded(shared):
    board = shared.owner.get(f"/api/boards/{shared.board}").json()
    column = board["columns"][0]
    card_id = column["cardIds"][0]
    card_title = board["cards"][card_id]["title"]

    shared.owner.post(
        "/api/cards",
        json={"column_id": column["id"], "title": "Write the brief"},
    )
    shared.owner.patch(f"/api/cards/{card_id}", json={"priority": "high"})
    shared.owner.patch(
        f"/api/columns/{column['id']}", json={"title": "Inbox"}
    )
    shared.owner.patch(f"/api/boards/{shared.board}", json={"name": "Delivery"})

    assert summaries(shared.owner, shared.board) == [
        'Renamed the board to "Delivery"',
        f'Renamed column "{column["title"]}" to "Inbox"',
        f'Edited card "{card_title}"',
        'Added card "Write the brief"',
        f"Shared the board with {shared.member_name}",
    ]


def test_a_card_move_names_its_destination(shared):
    board = shared.owner.get(f"/api/boards/{shared.board}").json()
    card_id = board["columns"][0]["cardIds"][0]
    destination = board["columns"][1]

    moved = shared.owner.patch(
        f"/api/cards/{card_id}/move",
        json={"column_id": destination["id"], "position": 0},
    )
    assert moved.status_code == 200, moved.text

    assert summaries(shared.owner, shared.board)[0] == (
        f'Moved card "{board["cards"][card_id]["title"]}"'
        f' to {destination["title"]}'
    )


def test_entries_name_their_author_and_are_newest_first(shared):
    column = shared.owner.get(f"/api/boards/{shared.board}").json()["columns"][0]
    shared.owner.post(
        "/api/cards", json={"column_id": column["id"], "title": "By the owner"}
    )
    shared.member.post(
        "/api/cards", json={"column_id": column["id"], "title": "By the member"}
    )

    entries = shared.owner.get(f"/api/boards/{shared.board}/activity").json()

    assert [(entry["summary"], entry["author_name"]) for entry in entries][:2] == [
        ('Added card "By the member"', shared.member_name),
        ('Added card "By the owner"', "Demo User"),
    ]


def test_a_member_reads_the_same_history_as_the_owner(shared):
    assert summaries(shared.member, shared.board) == summaries(
        shared.owner, shared.board
    )


def test_a_non_member_cannot_read_a_boards_history(shared, app):
    with TestClient(app) as outsider:
        register(outsider, OUTSIDER)

        response = outsider.get(f"/api/boards/{shared.board}/activity")

    assert response.status_code == 404


def test_removing_a_member_is_recorded_and_hides_the_history(shared):
    removed = shared.owner.delete(
        f"/api/boards/{shared.board}/members/{shared.member_id}"
    )
    assert removed.status_code == 204, removed.text

    assert summaries(shared.owner, shared.board)[0] == (
        f"Removed {shared.member_name} from the board"
    )
    assert (
        shared.member.get(f"/api/boards/{shared.board}/activity").status_code
        == 404
    )


def test_a_board_rewrite_is_recorded_and_keeps_the_history(shared):
    before = len(summaries(shared.owner, shared.board))
    board = shared.owner.get(f"/api/boards/{shared.board}").json()

    replaced = shared.owner.put(f"/api/boards/{shared.board}", json=board)
    assert replaced.status_code == 200, replaced.text

    after = summaries(shared.owner, shared.board)
    assert after[0] == "Rewrote the whole board"
    assert len(after) == before + 1


def test_a_comment_is_recorded_on_the_board(shared):
    board = shared.owner.get(f"/api/boards/{shared.board}").json()
    card_id = board["columns"][0]["cardIds"][0]

    posted = shared.member.post(
        f"/api/cards/{card_id}/comments", json={"body": "On it"}
    )
    assert posted.status_code == 201, posted.text

    assert summaries(shared.owner, shared.board)[0] == (
        f'Commented on "{board["cards"][card_id]["title"]}"'
    )


def test_deleting_a_column_or_card_is_recorded(shared):
    board = shared.owner.get(f"/api/boards/{shared.board}").json()
    column = board["columns"][0]
    card_id = column["cardIds"][0]

    shared.owner.delete(f"/api/cards/{card_id}")
    shared.owner.delete(f"/api/columns/{column['id']}")

    assert summaries(shared.owner, shared.board)[:2] == [
        f'Deleted column "{column["title"]}"',
        f'Deleted card "{board["cards"][card_id]["title"]}"',
    ]


def test_an_entry_outlives_its_author(shared, client):
    column = shared.owner.get(f"/api/boards/{shared.board}").json()["columns"][0]
    shared.member.post(
        "/api/cards", json={"column_id": column["id"], "title": "By the member"}
    )

    sign_in(client)
    assert client.delete(f"/api/users/{shared.member_id}").status_code == 204

    entry = shared.owner.get(f"/api/boards/{shared.board}/activity").json()[0]
    assert entry["summary"] == 'Added card "By the member"'
    assert entry["author_name"] == "A deleted account"


def test_the_history_goes_with_its_board(client):
    sign_in(client)
    second = client.post("/api/boards", json={"name": "Throwaway"}).json()
    client.patch(f"/api/boards/{second['id']}", json={"name": "Renamed"})
    assert summaries(client, second["id"]) == ['Renamed the board to "Renamed"']

    assert client.delete(f"/api/boards/{second['id']}").status_code == 204

    assert client.get(f"/api/boards/{second['id']}/activity").status_code == 404


def test_the_history_requires_a_session(client, app):
    sign_in(client)
    board = owned_board_id(client)

    with TestClient(app) as anonymous:
        assert (
            anonymous.get(f"/api/boards/{board}/activity").status_code == 401
        )
