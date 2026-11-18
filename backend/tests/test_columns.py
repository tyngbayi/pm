import pytest
from fastapi.testclient import TestClient

from conftest import board_id, board_url

ADMIN = {"username": "user", "password": "password"}


def sign_in(client, credentials=None):
    response = client.post("/api/auth/login", json=credentials or ADMIN)
    assert response.status_code == 200
    return response.json()


def register(client, username):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": "hunter2hunter2"},
    )
    assert response.status_code == 201
    return response.json()


def titles(board) -> list[str]:
    return [column["title"] for column in board["columns"]]


def client_board(client) -> dict:
    board = client.get(board_url(client)).json()
    return {
        "id": board_id(client),
        "column_id": board["columns"][0]["id"],
        "titles": titles(board),
    }


def test_create_column_appends_it_to_the_board(client):
    sign_in(client)
    before = client.get(board_url(client)).json()

    response = client.post(
        "/api/columns", json={"board_id": board_id(client), "title": "Blocked"}
    )

    assert response.status_code == 201
    assert titles(response.json()) == titles(before) + ["Blocked"]
    assert titles(client.get(board_url(client)).json()) == titles(before) + ["Blocked"]


def test_create_column_trims_the_title_and_rejects_a_blank_one(client):
    sign_in(client)
    target = board_id(client)

    padded = client.post("/api/columns", json={"board_id": target, "title": "  Ideas  "})
    blank = client.post("/api/columns", json={"board_id": target, "title": "   "})

    assert padded.status_code == 201
    assert titles(padded.json())[-1] == "Ideas"
    assert blank.status_code == 422


def test_create_column_rejects_an_empty_title_before_the_handler(client):
    sign_in(client)

    response = client.post(
        "/api/columns", json={"board_id": board_id(client), "title": ""}
    )

    assert response.status_code == 422


def test_delete_column_removes_it_and_its_cards(client):
    sign_in(client)
    board = client.get(board_url(client)).json()
    doomed = board["columns"][0]
    assert doomed["cardIds"], "the seeded first column should hold cards"

    response = client.delete(f"/api/columns/{doomed['id']}")

    assert response.status_code == 200
    assert titles(response.json()) == titles(board)[1:]
    # The column's cards cascade away rather than lingering unreferenced.
    assert not set(doomed["cardIds"]) & set(response.json()["cards"])


def test_delete_column_renumbers_the_remaining_positions(client):
    sign_in(client)
    board = client.get(board_url(client)).json()

    client.delete(f"/api/columns/{board['columns'][1]['id']}")
    # A gap in `position` would break the UNIQUE (board_id, position) rewrite
    # the next move performs, so prove the order still round-trips.
    moved = client.patch(
        f"/api/columns/{board['columns'][0]['id']}/move", json={"position": 3}
    )

    assert moved.status_code == 200
    expected = titles(board)
    expected.remove(board["columns"][1]["title"])
    expected.append(expected.pop(0))
    assert titles(moved.json()) == expected


def test_delete_every_column_leaves_an_empty_board_that_still_accepts_one(client):
    sign_in(client)
    target = board_id(client)
    for column in client.get(board_url(client)).json()["columns"]:
        assert client.delete(f"/api/columns/{column['id']}").status_code == 200

    emptied = client.get(board_url(client)).json()
    recreated = client.post("/api/columns", json={"board_id": target, "title": "Todo"})

    assert emptied == {"columns": [], "cards": {}}
    assert titles(recreated.json()) == ["Todo"]


@pytest.mark.parametrize("position", [0, 2, 99])
def test_move_column_reorders_the_board(client, position):
    sign_in(client)
    board = client.get(board_url(client)).json()
    moved_title = board["columns"][-1]["title"]

    response = client.patch(
        f"/api/columns/{board['columns'][-1]['id']}/move", json={"position": position}
    )

    assert response.status_code == 200
    expected = titles(board)[:-1]
    expected.insert(min(position, len(expected)), moved_title)
    assert titles(response.json()) == expected
    assert titles(client.get(board_url(client)).json()) == expected


def test_move_column_rejects_a_negative_position(client):
    sign_in(client)
    column_id = client.get(board_url(client)).json()["columns"][0]["id"]

    response = client.patch(f"/api/columns/{column_id}/move", json={"position": -1})

    assert response.status_code == 422


def test_column_routes_reject_unknown_ids(client):
    sign_in(client)

    assert client.delete("/api/columns/missing").status_code == 404
    assert (
        client.patch("/api/columns/missing/move", json={"position": 0}).status_code
        == 404
    )
    assert (
        client.post(
            "/api/columns", json={"board_id": "missing", "title": "Blocked"}
        ).status_code
        == 404
    )


def test_column_routes_do_not_reach_another_users_board(app):
    with TestClient(app) as owner, TestClient(app) as intruder:
        sign_in(owner)
        owner_board = client_board(owner)
        register(intruder, "grace")

        created = intruder.post(
            "/api/columns",
            json={"board_id": owner_board["id"], "title": "Injected"},
        )
        deleted = intruder.delete(f"/api/columns/{owner_board['column_id']}")
        moved = intruder.patch(
            f"/api/columns/{owner_board['column_id']}/move", json={"position": 0}
        )

        assert [created.status_code, deleted.status_code, moved.status_code] == [
            404,
            404,
            404,
        ]
        assert titles(owner.get(board_url(owner)).json()) == owner_board["titles"]


def test_replace_board_now_accepts_an_added_column(client):
    sign_in(client)
    url = board_url(client)
    board = client.get(url).json()
    board["columns"].append({"id": "col-new", "title": "Shipped", "cardIds": []})

    response = client.put(url, json=board)

    assert response.status_code == 200
    assert titles(response.json())[-1] == "Shipped"


def test_replace_board_still_rejects_a_card_in_two_columns(client):
    sign_in(client)
    url = board_url(client)
    board = client.get(url).json()
    shared = board["columns"][0]["cardIds"][0]
    board["columns"][1]["cardIds"].append(shared)

    response = client.put(url, json=board)

    assert response.status_code == 422
    assert "exactly once" in response.json()["detail"]
