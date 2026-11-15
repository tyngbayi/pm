import pytest
from fastapi.testclient import TestClient

from ai import OpenRouterConfigurationError
from main import create_app


@pytest.fixture
def client(tmp_path):
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text(
        "<h1>Exported app</h1>", encoding="utf-8"
    )
    (static_dir / "project.html").write_text("<h1>Project</h1>", encoding="utf-8")
    app = create_app(
        static_dir,
        session_secret="test-session-secret",
        database_path=tmp_path / "kanban.db",
    )
    with TestClient(app) as test_client:
        yield test_client


def sign_in(client):
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )
    assert response.status_code == 200
    return response


def test_health_endpoint_returns_ok(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_serves_static_export_index(client):
    response = client.get("/")

    assert response.status_code == 200
    assert "<h1>Exported app</h1>" in response.text


def test_unknown_client_route_falls_back_to_index(client):
    response = client.get("/client/route")

    assert response.status_code == 200
    assert "<h1>Exported app</h1>" in response.text


def test_next_404_file_does_not_block_client_route_fallback(tmp_path):
    (tmp_path / "index.html").write_text("<h1>Exported app</h1>", encoding="utf-8")
    (tmp_path / "404.html").write_text("<h1>Not found</h1>", encoding="utf-8")
    client = TestClient(create_app(tmp_path))

    route_response = client.get("/client/route")
    api_response = client.get("/api/missing")

    assert route_response.status_code == 200
    assert "<h1>Exported app</h1>" in route_response.text
    assert api_response.status_code == 404
    assert "<h1>Not found</h1>" in api_response.text


def test_extensionless_exported_page_serves_html_file(client):
    response = client.get("/project")

    assert response.status_code == 200
    assert "<h1>Project</h1>" in response.text


def test_missing_asset_and_api_route_return_404(client):
    asset_response = client.get("/_next/static/missing.js")
    api_response = client.get("/api/missing")

    assert asset_response.status_code == 404
    assert api_response.status_code == 404


def test_login_sets_signed_cookie_and_returns_current_user(client):
    response = sign_in(client)

    assert response.status_code == 200
    assert response.json() == {"username": "user"}
    assert "pm_session=" in response.headers["set-cookie"]
    assert "httponly" in response.headers["set-cookie"].lower()
    assert client.get("/api/auth/me").json() == {"username": "user"}


def test_login_rejects_invalid_credentials(client):
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "incorrect"},
    )

    assert response.status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_current_user_rejects_missing_or_invalid_session(client):
    assert client.get("/api/auth/me").status_code == 401

    client.cookies.set("pm_session", "invalid.signature")

    assert client.get("/api/auth/me").status_code == 401


def test_logout_clears_session(client):
    sign_in(client)

    response = client.post("/api/auth/logout")

    assert response.status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_board_is_protected_and_seeded_for_authenticated_user(client):
    sign_in(client)
    response = client.get("/api/board")

    assert response.status_code == 200
    board = response.json()
    assert [column["title"] for column in board["columns"]] == [
        "Backlog",
        "Discovery",
        "In Progress",
        "Review",
        "Done",
    ]
    assert sum(len(column["cardIds"]) for column in board["columns"]) == 8
    assert {
        card_id for column in board["columns"] for card_id in column["cardIds"]
    } == set(board["cards"])


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/api/board", None),
        ("put", "/api/board", {"columns": [], "cards": {}}),
        ("post", "/api/ai/ping", None),
        ("patch", "/api/columns/column-id", {"title": "New title"}),
        ("post", "/api/cards", {"column_id": "column-id", "title": "New card"}),
        ("patch", "/api/cards/card-id", {"title": "New title"}),
        ("delete", "/api/cards/card-id", None),
        (
            "patch",
            "/api/cards/card-id/move",
            {"column_id": "column-id", "position": 0},
        ),
    ],
)
def test_protected_routes_require_sign_in(client, method, path, body):
    request = getattr(client, method)
    response = request(path, json=body) if body is not None else request(path)

    assert response.status_code == 401


def test_ai_ping_returns_non_empty_response(client, monkeypatch):
    sign_in(client)

    def respond(message):
        assert message == "What is 2+2?"
        return "4"

    monkeypatch.setattr("main.ask_openrouter", respond)

    response = client.post("/api/ai/ping")

    assert response.status_code == 200
    assert response.json() == {"response": "4"}


def test_ai_ping_reports_missing_openrouter_configuration(client, monkeypatch):
    sign_in(client)

    def fail(_):
        raise OpenRouterConfigurationError("OPENROUTER_API_KEY is not configured")

    monkeypatch.setattr("main.ask_openrouter", fail)

    response = client.post("/api/ai/ping")

    assert response.status_code == 503
    assert response.json() == {
        "detail": "OPENROUTER_API_KEY is not configured"
    }


def test_put_board_replaces_cards_and_rejects_broken_references(client):
    sign_in(client)
    board = client.get("/api/board").json()
    first_card_id = board["columns"][0]["cardIds"][0]
    board["cards"][first_card_id]["title"] = "Updated through board"

    response = client.put("/api/board", json=board)

    assert response.status_code == 200
    assert response.json()["cards"][first_card_id]["title"] == "Updated through board"

    board["columns"][0]["cardIds"].append("missing-card")
    invalid_response = client.put("/api/board", json=board)

    assert invalid_response.status_code == 422
    assert client.get("/api/board").json()["cards"][first_card_id][
        "title"
    ] == "Updated through board"


def test_put_board_cannot_change_fixed_columns(client):
    sign_in(client)
    board = client.get("/api/board").json()
    board["columns"].pop()

    response = client.put("/api/board", json=board)

    assert response.status_code == 422


def test_column_rename_requires_an_existing_owned_column(client):
    sign_in(client)
    board = client.get("/api/board").json()
    column_id = board["columns"][0]["id"]

    response = client.patch(
        f"/api/columns/{column_id}",
        json={"title": "Queue"},
    )

    assert response.status_code == 200
    assert response.json() == {"id": column_id, "title": "Queue"}
    assert client.get("/api/board").json()["columns"][0]["title"] == "Queue"
    assert client.patch(
        "/api/columns/missing-column", json={"title": "Nope"}
    ).status_code == 404
    blank_title = client.patch(
        f"/api/columns/{column_id}", json={"title": " "}
    )
    assert blank_title.status_code == 422


def test_create_card_appends_to_its_column_and_rejects_unknown_column(client):
    sign_in(client)
    board = client.get("/api/board").json()
    column_id = board["columns"][0]["id"]

    response = client.post(
        "/api/cards",
        json={
            "column_id": column_id,
            "title": "New task",
            "details": "Card details",
        },
    )

    assert response.status_code == 201
    assert response.json()["title"] == "New task"
    updated_board = client.get("/api/board").json()
    assert updated_board["columns"][0]["cardIds"][-1] == response.json()["id"]
    assert client.post(
        "/api/cards",
        json={"column_id": "missing-column", "title": "Invalid"},
    ).status_code == 404
    assert client.post(
        "/api/cards", json={"column_id": column_id, "title": " "}
    ).status_code == 422


def test_update_card_accepts_partial_changes_and_rejects_invalid_requests(client):
    sign_in(client)
    board = client.get("/api/board").json()
    card_id = board["columns"][0]["cardIds"][0]

    response = client.patch(
        f"/api/cards/{card_id}",
        json={"title": "Renamed card"},
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Renamed card"
    assert response.json()["details"] == board["cards"][card_id]["details"]
    details_response = client.patch(
        f"/api/cards/{card_id}",
        json={"details": "Updated details"},
    )
    assert details_response.status_code == 200
    assert details_response.json()["title"] == "Renamed card"
    assert details_response.json()["details"] == "Updated details"
    assert client.patch(f"/api/cards/{card_id}", json={}).status_code == 422
    missing_card = client.patch(
        "/api/cards/missing-card", json={"title": "Nope"}
    )
    assert missing_card.status_code == 404


def test_delete_card_removes_card_and_compacts_column_order(client):
    sign_in(client)
    board = client.get("/api/board").json()
    column = board["columns"][0]
    deleted_id, remaining_id = column["cardIds"]

    response = client.delete(f"/api/cards/{deleted_id}")

    assert response.status_code == 204
    updated_board = client.get("/api/board").json()
    assert updated_board["columns"][0]["cardIds"] == [remaining_id]
    assert deleted_id not in updated_board["cards"]
    assert client.delete("/api/cards/missing-card").status_code == 404


def test_move_card_reorders_and_moves_between_columns(client):
    sign_in(client)
    board = client.get("/api/board").json()
    source = board["columns"][0]
    target = board["columns"][3]
    first_card_id, second_card_id = source["cardIds"]

    same_column = client.patch(
        f"/api/cards/{first_card_id}/move",
        json={"column_id": source["id"], "position": 1},
    )
    assert same_column.status_code == 200
    assert same_column.json()["columns"][0]["cardIds"] == [
        second_card_id,
        first_card_id,
    ]

    cross_column = client.patch(
        f"/api/cards/{first_card_id}/move",
        json={"column_id": target["id"], "position": 0},
    )
    assert cross_column.status_code == 200
    moved_board = cross_column.json()
    assert first_card_id not in moved_board["columns"][0]["cardIds"]
    assert moved_board["columns"][3]["cardIds"][0] == first_card_id
    assert client.patch(
        f"/api/cards/{first_card_id}/move",
        json={"column_id": "missing-column", "position": 0},
    ).status_code == 404
    assert client.patch(
        f"/api/cards/{first_card_id}/move",
        json={"column_id": target["id"], "position": -1},
    ).status_code == 422


def test_board_changes_persist_after_app_restart(tmp_path):
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<h1>App</h1>", encoding="utf-8")
    database_path = tmp_path / "kanban.db"

    with TestClient(
        create_app(
            static_dir,
            session_secret="test-session-secret",
            database_path=database_path,
        )
    ) as first_client:
        assert database_path.is_file()
        sign_in(first_client)
        first_board = first_client.get("/api/board").json()
        column_id = first_board["columns"][0]["id"]
        first_client.patch(
            f"/api/columns/{column_id}",
            json={"title": "Persisted title"},
        )

    with TestClient(
        create_app(
            static_dir,
            session_secret="test-session-secret",
            database_path=database_path,
        )
    ) as second_client:
        sign_in(second_client)
        persisted_board = second_client.get("/api/board").json()

    assert persisted_board["columns"][0]["title"] == "Persisted title"
