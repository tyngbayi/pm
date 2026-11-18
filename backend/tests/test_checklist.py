"""Checklists: the subtasks that live on a card."""

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


def add(client, card_id: str, body: str):
    return client.post(f"/api/cards/{card_id}/checklist", json={"body": body})


def items(client, card_id: str) -> list[dict]:
    response = client.get(f"/api/cards/{card_id}/checklist")
    assert response.status_code == 200, response.text
    return response.json()


def card_counts(client, board: str, card_id: str) -> tuple[int, int]:
    card = client.get(f"/api/boards/{board}").json()["cards"][card_id]
    return card["checklistDone"], card["checklistTotal"]


class Shared(NamedTuple):
    owner: TestClient
    member: TestClient
    board: str
    card: str


@pytest.fixture
def shared(app):
    """An owner and a member sharing a board, plus one of its cards."""
    with TestClient(app) as owner, TestClient(app) as member:
        register(member, MEMBER)
        sign_in(owner)
        board = owned_board_id(owner)
        added = owner.post(
            f"/api/boards/{board}/members", json={"username": MEMBER["username"]}
        )
        assert added.status_code == 201, added.text
        card = owner.get(f"/api/boards/{board}").json()["columns"][0][
            "cardIds"
        ][0]
        yield Shared(owner, member, board, card)


def test_a_card_starts_with_an_empty_checklist(client):
    sign_in(client)
    board = owned_board_id(client)
    card_id = client.get(f"/api/boards/{board}").json()["columns"][0][
        "cardIds"
    ][0]

    assert items(client, card_id) == []
    assert card_counts(client, board, card_id) == (0, 0)


def test_items_are_added_unticked_and_kept_in_order(shared):
    first = add(shared.owner, shared.card, "Draft the spec")
    assert first.status_code == 201, first.text
    assert first.json() == {
        "id": first.json()["id"],
        "body": "Draft the spec",
        "done": False,
    }
    add(shared.owner, shared.card, "Review it")
    add(shared.owner, shared.card, "Ship it")

    assert [item["body"] for item in items(shared.owner, shared.card)] == [
        "Draft the spec",
        "Review it",
        "Ship it",
    ]


def test_the_card_carries_its_progress(shared):
    first = add(shared.owner, shared.card, "Draft the spec").json()
    add(shared.owner, shared.card, "Review it")

    ticked = shared.owner.patch(
        f"/api/checklist/{first['id']}", json={"done": True}
    )
    assert ticked.status_code == 200, ticked.text
    assert ticked.json()["done"] is True

    assert card_counts(shared.owner, shared.board, shared.card) == (1, 2)


def test_an_item_can_be_unticked_again(shared):
    item = add(shared.owner, shared.card, "Draft the spec").json()
    shared.owner.patch(f"/api/checklist/{item['id']}", json={"done": True})

    shared.owner.patch(f"/api/checklist/{item['id']}", json={"done": False})

    assert card_counts(shared.owner, shared.board, shared.card) == (0, 1)


def test_deleting_an_item_drops_it_from_the_count(shared):
    item = add(shared.owner, shared.card, "Draft the spec").json()
    add(shared.owner, shared.card, "Review it")

    removed = shared.owner.delete(f"/api/checklist/{item['id']}")
    assert removed.status_code == 204, removed.text

    assert [item["body"] for item in items(shared.owner, shared.card)] == [
        "Review it"
    ]
    assert card_counts(shared.owner, shared.board, shared.card) == (0, 1)


def test_a_member_may_tick_an_item_the_owner_wrote(shared):
    item = add(shared.owner, shared.card, "Draft the spec").json()

    ticked = shared.member.patch(
        f"/api/checklist/{item['id']}", json={"done": True}
    )

    assert ticked.status_code == 200, ticked.text
    assert items(shared.member, shared.card)[0]["done"] is True


def test_a_non_member_cannot_reach_a_checklist(shared, app):
    item = add(shared.owner, shared.card, "Draft the spec").json()

    with TestClient(app) as outsider:
        register(outsider, OUTSIDER)

        assert (
            outsider.get(f"/api/cards/{shared.card}/checklist").status_code
            == 404
        )
        assert add(outsider, shared.card, "Sneak in").status_code == 404
        assert (
            outsider.patch(
                f"/api/checklist/{item['id']}", json={"done": True}
            ).status_code
            == 404
        )
        assert outsider.delete(f"/api/checklist/{item['id']}").status_code == 404


def test_an_empty_or_overlong_item_is_refused(shared):
    assert add(shared.owner, shared.card, "").status_code == 422
    assert add(shared.owner, shared.card, "x" * 201).status_code == 422


def test_a_checklist_survives_a_whole_board_rewrite(shared):
    item = add(shared.owner, shared.card, "Draft the spec").json()
    shared.owner.patch(f"/api/checklist/{item['id']}", json={"done": True})
    board = shared.owner.get(f"/api/boards/{shared.board}").json()

    replaced = shared.owner.put(f"/api/boards/{shared.board}", json=board)
    assert replaced.status_code == 200, replaced.text

    assert items(shared.owner, shared.card) == [
        {"id": item["id"], "body": "Draft the spec", "done": True}
    ]
    assert replaced.json()["cards"][shared.card]["checklistDone"] == 1


def test_a_checklist_goes_with_its_card(shared):
    item = add(shared.owner, shared.card, "Draft the spec").json()

    assert shared.owner.delete(f"/api/cards/{shared.card}").status_code == 204

    assert shared.owner.delete(f"/api/checklist/{item['id']}").status_code == 404


def test_a_checklist_requires_a_session(shared, app):
    with TestClient(app) as anonymous:
        assert (
            anonymous.get(f"/api/cards/{shared.card}/checklist").status_code
            == 401
        )
