"""The cross-board view of every card assigned to the signed-in user."""

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


def cards_of(client, board: str) -> list[str]:
    columns = client.get(f"/api/boards/{board}").json()["columns"]
    return [card_id for column in columns for card_id in column["cardIds"]]


def assign(client, card_id: str, user_id: str | None, **fields):
    response = client.patch(
        f"/api/cards/{card_id}", json={"assigneeId": user_id, **fields}
    )
    assert response.status_code == 200, response.text
    return response.json()


def assignments(client) -> list[dict]:
    response = client.get("/api/assignments")
    assert response.status_code == 200, response.text
    return response.json()


class Shared(NamedTuple):
    owner: TestClient
    member: TestClient
    board: str
    cards: list[str]
    owner_id: str
    member_id: str


@pytest.fixture
def shared(app):
    """An owner sharing their board with a member, plus that board's cards."""
    with TestClient(app) as owner, TestClient(app) as member:
        member_account = register(member, MEMBER)
        owner_account = sign_in(owner)
        board = owned_board_id(owner)
        added = owner.post(
            f"/api/boards/{board}/members", json={"username": MEMBER["username"]}
        )
        assert added.status_code == 201, added.text
        yield Shared(
            owner,
            member,
            board,
            cards_of(owner, board),
            owner_account["id"],
            member_account["id"],
        )


def test_assignments_are_empty_until_a_card_is_assigned(shared):
    assert assignments(shared.owner) == []


def test_an_assigned_card_carries_its_board_and_column(shared):
    assign(shared.owner, shared.cards[0], shared.owner_id, dueDate="2027-01-04")

    entry = assignments(shared.owner)[0]

    board = shared.owner.get(f"/api/boards/{shared.board}").json()
    assert entry == {
        "card_id": shared.cards[0],
        "title": board["cards"][shared.cards[0]]["title"],
        "priority": board["cards"][shared.cards[0]]["priority"],
        "dueDate": "2027-01-04",
        "board_id": shared.board,
        "board_name": next(
            b["name"]
            for b in shared.owner.get("/api/boards").json()
            if b["id"] == shared.board
        ),
        "column_title": board["columns"][0]["title"],
    }


def test_cards_span_every_board_the_user_can_open(shared):
    second = shared.owner.post("/api/boards", json={"name": "Platform"})
    assert second.status_code == 201, second.text
    second_board = second.json()["id"]

    assign(shared.owner, shared.cards[0], shared.owner_id, dueDate="2027-03-01")
    assign(
        shared.owner,
        cards_of(shared.owner, second_board)[0],
        shared.owner_id,
        dueDate="2027-02-01",
    )

    entries = assignments(shared.owner)

    assert [entry["board_id"] for entry in entries] == [
        second_board,
        shared.board,
    ]


def test_a_shared_board_counts_as_the_members_work(shared):
    assign(shared.owner, shared.cards[0], shared.member_id)

    entries = assignments(shared.member)

    assert [entry["card_id"] for entry in entries] == [shared.cards[0]]
    assert entries[0]["board_id"] == shared.board


def test_only_ones_own_cards_are_listed(shared):
    assign(shared.owner, shared.cards[0], shared.member_id)

    assert assignments(shared.owner) == []


def test_losing_board_access_drops_the_assignment(shared):
    assign(shared.owner, shared.cards[0], shared.member_id)

    removed = shared.owner.delete(
        f"/api/boards/{shared.board}/members/{shared.member_id}"
    )
    assert removed.status_code == 204, removed.text

    assert assignments(shared.member) == []


def test_soonest_due_first_with_undated_cards_last(shared):
    assign(shared.owner, shared.cards[0], shared.owner_id, dueDate="")
    assign(shared.owner, shared.cards[1], shared.owner_id, dueDate="2027-12-31")
    assign(shared.owner, shared.cards[2], shared.owner_id, dueDate="2027-01-01")

    entries = assignments(shared.owner)

    assert [entry["dueDate"] for entry in entries] == [
        "2027-01-01",
        "2027-12-31",
        "",
    ]


def test_unassigning_removes_the_card_from_the_list(shared):
    assign(shared.owner, shared.cards[0], shared.owner_id)

    assign(shared.owner, shared.cards[0], None)

    assert assignments(shared.owner) == []


def test_deleting_an_assigned_card_removes_it(shared):
    assign(shared.owner, shared.cards[0], shared.owner_id)

    deleted = shared.owner.delete(f"/api/cards/{shared.cards[0]}")
    assert deleted.status_code == 204, deleted.text

    assert assignments(shared.owner) == []


def test_assignments_require_a_session(client):
    assert client.get("/api/assignments").status_code == 401
