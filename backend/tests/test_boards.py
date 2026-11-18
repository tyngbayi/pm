import json

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


def test_a_new_account_starts_with_one_named_board(client):
    register(client, "ada")

    boards = client.get("/api/boards")

    assert boards.status_code == 200
    assert [board["name"] for board in boards.json()] == ["My board"]
    assert boards.json()[0]["created_at"]


def test_create_board_seeds_its_own_columns_and_cards(client):
    sign_in(client)
    first_url = board_url(client)

    created = client.post("/api/boards", json={"name": "Roadmap"})

    assert created.status_code == 201
    assert created.json()["name"] == "Roadmap"
    second = client.get(f"/api/boards/{created.json()['id']}")
    assert second.status_code == 200
    assert len(second.json()["columns"]) == 5
    assert len(second.json()["cards"]) == 8
    # The two boards hold distinct records, not shared ones.
    assert set(second.json()["cards"]) & set(client.get(first_url).json()["cards"]) == (
        set()
    )
    assert [board["name"] for board in client.get("/api/boards").json()] == [
        "My board",
        "Roadmap",
    ]


def test_cards_stay_scoped_to_the_board_they_were_added_to(client):
    sign_in(client)
    first_url = board_url(client)
    second_id = client.post("/api/boards", json={"name": "Roadmap"}).json()["id"]
    second_url = f"/api/boards/{second_id}"
    column_id = client.get(second_url).json()["columns"][0]["id"]

    card = client.post(
        "/api/cards", json={"column_id": column_id, "title": "Second board card"}
    )

    assert card.status_code == 201
    assert card.json()["id"] in client.get(second_url).json()["cards"]
    assert card.json()["id"] not in client.get(first_url).json()["cards"]


def test_rename_board(client):
    sign_in(client)

    renamed = client.patch(board_url(client), json={"name": "Quarterly plan"})

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Quarterly plan"
    assert client.get("/api/boards").json()[0]["name"] == "Quarterly plan"


def test_delete_board_cascades_to_its_columns_and_cards(client):
    sign_in(client)
    created = client.post("/api/boards", json={"name": "Scratch"}).json()
    card_ids = set(client.get(f"/api/boards/{created['id']}").json()["cards"])

    assert client.delete(f"/api/boards/{created['id']}").status_code == 204

    assert client.get(f"/api/boards/{created['id']}").status_code == 404
    assert [board["id"] for board in client.get("/api/boards").json()] != [
        created["id"]
    ]
    # Every card is reachable only through a board, so none may survive.
    surviving = client.get(board_url(client)).json()["cards"]
    assert card_ids & set(surviving) == set()


def test_the_last_board_cannot_be_deleted(client):
    sign_in(client)

    response = client.delete(board_url(client))

    assert response.status_code == 409
    assert response.json() == {"detail": "Your last board cannot be deleted"}
    assert len(client.get("/api/boards").json()) == 1


@pytest.mark.parametrize(
    ("method", "body"),
    [
        ("get", None),
        ("put", {"columns": [], "cards": {}}),
        ("patch", {"name": "Stolen"}),
        ("delete", None),
    ],
)
def test_one_account_cannot_reach_another_accounts_board(app, method, body):
    with TestClient(app) as ada, TestClient(app) as grace:
        register(ada, "ada")
        register(grace, "grace")
        # Grace holds two boards so the delete attempt is not refused by the
        # last-board guard before ownership is even checked.
        grace.post("/api/boards", json={"name": "Spare"})
        ada_board_url = board_url(ada)

        request = getattr(grace, method)
        response = (
            request(ada_board_url, json=body)
            if body is not None
            else request(ada_board_url)
        )

        assert response.status_code == 404
        assert ada.get(ada_board_url).json()["columns"]


def test_board_routes_reject_unknown_ids(client):
    sign_in(client)

    assert client.get("/api/boards/board-missing").status_code == 404
    assert (
        client.patch("/api/boards/board-missing", json={"name": "x"}).status_code == 404
    )


@pytest.mark.parametrize("name", ["", "x" * 81])
def test_board_names_are_validated(client, name):
    sign_in(client)

    assert client.post("/api/boards", json={"name": name}).status_code == 422


def test_ai_chat_targets_the_requested_board(client, monkeypatch):
    sign_in(client)
    second_id = client.post("/api/boards", json={"name": "Roadmap"}).json()["id"]
    seen = {}

    def respond(_messages, board):
        seen["board"] = board
        return json.dumps({"message": "Looked.", "board_update": None})

    monkeypatch.setattr("main.chat_with_openrouter", respond)

    response = client.post(
        "/api/ai/chat",
        json={
            "board_id": second_id,
            "messages": [{"role": "user", "content": "What is here?"}],
        },
    )

    assert response.status_code == 200
    assert seen["board"] == client.get(f"/api/boards/{second_id}").json()


def test_ai_chat_rejects_a_board_the_caller_does_not_own(app):
    with TestClient(app) as ada, TestClient(app) as grace:
        register(ada, "ada")
        register(grace, "grace")
        ada_board_id = board_id(ada)

        response = grace.post(
            "/api/ai/chat",
            json={
                "board_id": ada_board_id,
                "messages": [{"role": "user", "content": "Show me"}],
            },
        )

        assert response.status_code == 404
