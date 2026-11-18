"""Column WIP limits: a working agreement the board shows but never enforces."""

import pytest
from fastapi.testclient import TestClient

ADMIN = {"username": "user", "password": "password"}
MEMBER = {"username": "teammate", "password": "hunter2hunter2"}


def sign_in(client, credentials=ADMIN):
    response = client.post("/api/auth/login", json=credentials)
    assert response.status_code == 200, response.text
    return response.json()


def owned_board_id(client) -> str:
    boards = client.get("/api/boards").json()
    return next(board["id"] for board in boards if board["owned"])


def first_column(client, board: str) -> dict:
    return client.get(f"/api/boards/{board}").json()["columns"][0]


@pytest.fixture
def board(client):
    """A signed-in owner's board id."""
    sign_in(client)
    return owned_board_id(client)


def test_columns_start_with_no_limit(client, board):
    assert all(
        column["wipLimit"] == 0
        for column in client.get(f"/api/boards/{board}").json()["columns"]
    )


def test_setting_a_limit_leaves_the_title_alone(client, board):
    column = first_column(client, board)

    response = client.patch(
        f"/api/columns/{column['id']}", json={"wipLimit": 3}
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": column["id"],
        "title": column["title"],
        "wipLimit": 3,
    }
    assert first_column(client, board)["wipLimit"] == 3


def test_a_rename_and_a_limit_travel_together(client, board):
    column = first_column(client, board)

    response = client.patch(
        f"/api/columns/{column['id']}", json={"title": "Queue", "wipLimit": 2}
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": column["id"],
        "title": "Queue",
        "wipLimit": 2,
    }
    updated = first_column(client, board)
    assert (updated["title"], updated["wipLimit"]) == ("Queue", 2)


def test_zero_clears_the_limit(client, board):
    column_id = first_column(client, board)["id"]
    client.patch(f"/api/columns/{column_id}", json={"wipLimit": 4})

    response = client.patch(f"/api/columns/{column_id}", json={"wipLimit": 0})

    assert response.status_code == 200, response.text
    assert response.json()["wipLimit"] == 0


def test_the_board_lets_a_column_go_over_its_limit(client, board):
    """The limit is advisory. Blocking the move would strand work mid-flow."""
    column = first_column(client, board)
    client.patch(f"/api/columns/{column['id']}", json={"wipLimit": 1})

    added = client.post(
        "/api/cards", json={"column_id": column["id"], "title": "One more"}
    )

    assert added.status_code == 201, added.text
    over = first_column(client, board)
    assert len(over["cardIds"]) > over["wipLimit"]


def test_a_limit_change_is_recorded_in_the_history(client, board):
    column_id = first_column(client, board)["id"]

    client.patch(f"/api/columns/{column_id}", json={"wipLimit": 5})
    client.patch(f"/api/columns/{column_id}", json={"wipLimit": 0})

    summaries = [
        entry["summary"]
        for entry in client.get(f"/api/boards/{board}/activity").json()
    ]
    assert summaries[:2] == [
        'Cleared the limit on column "Backlog"',
        'Set column "Backlog" to a limit of 5',
    ]


def test_a_rename_with_a_limit_is_recorded_as_one_entry(client, board):
    column_id = first_column(client, board)["id"]

    client.patch(
        f"/api/columns/{column_id}", json={"title": "Queue", "wipLimit": 5}
    )

    newest = client.get(f"/api/boards/{board}/activity").json()[0]
    assert newest["summary"] == (
        'Renamed column "Backlog" to "Queue" and set its limit to 5'
    )


def test_a_member_may_set_a_limit_on_a_shared_board(app):
    with TestClient(app) as owner, TestClient(app) as member:
        member.post("/api/auth/register", json=MEMBER)
        sign_in(owner)
        board_id = owned_board_id(owner)
        owner.post(
            f"/api/boards/{board_id}/members",
            json={"username": MEMBER["username"]},
        )
        column_id = first_column(owner, board_id)["id"]

        response = member.patch(
            f"/api/columns/{column_id}", json={"wipLimit": 2}
        )

        assert response.status_code == 200, response.text
        assert first_column(owner, board_id)["wipLimit"] == 2


def test_a_non_member_cannot_see_or_set_a_limit(app):
    with TestClient(app) as owner, TestClient(app) as outsider:
        outsider.post("/api/auth/register", json=MEMBER)
        sign_in(owner)
        column_id = first_column(owner, owned_board_id(owner))["id"]

        response = outsider.patch(
            f"/api/columns/{column_id}", json={"wipLimit": 2}
        )

        assert response.status_code == 404


def test_an_unusable_limit_is_refused(client, board):
    column_id = first_column(client, board)["id"]

    assert (
        client.patch(
            f"/api/columns/{column_id}", json={"wipLimit": -1}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/columns/{column_id}", json={"wipLimit": 100}
        ).status_code
        == 422
    )
    assert client.patch(f"/api/columns/{column_id}", json={}).status_code == 422
    assert (
        client.patch(
            f"/api/columns/{column_id}", json={"wipLimit": None}
        ).status_code
        == 422
    )
    assert first_column(client, board)["wipLimit"] == 0


def test_a_limit_survives_a_whole_board_rewrite(client, board):
    column_id = first_column(client, board)["id"]
    client.patch(f"/api/columns/{column_id}", json={"wipLimit": 3})
    rewritten = client.get(f"/api/boards/{board}").json()

    response = client.put(f"/api/boards/{board}", json=rewritten)

    assert response.status_code == 200, response.text
    assert response.json()["columns"][0]["wipLimit"] == 3


def test_a_board_update_that_omits_the_limit_clears_it(client, board):
    """The AI answers with the board shape it was given, which may predate
    limits. Defaulting to 0 keeps that reply valid instead of rejecting it."""
    column_id = first_column(client, board)["id"]
    client.patch(f"/api/columns/{column_id}", json={"wipLimit": 3})
    stripped = client.get(f"/api/boards/{board}").json()
    for column in stripped["columns"]:
        column.pop("wipLimit")

    response = client.put(f"/api/boards/{board}", json=stripped)

    assert response.status_code == 200, response.text
    assert response.json()["columns"][0]["wipLimit"] == 0


def test_a_new_column_starts_without_a_limit(client, board):
    response = client.post(
        "/api/columns", json={"board_id": board, "title": "Blocked"}
    )

    assert response.status_code == 201, response.text
    assert response.json()["columns"][-1]["wipLimit"] == 0


def test_setting_a_limit_needs_an_account(client, board):
    column_id = first_column(client, board)["id"]
    client.post("/api/auth/logout")

    assert (
        client.patch(
            f"/api/columns/{column_id}", json={"wipLimit": 2}
        ).status_code
        == 401
    )
