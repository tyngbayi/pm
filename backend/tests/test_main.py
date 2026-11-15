import pytest
from fastapi.testclient import TestClient

from main import create_app


@pytest.fixture
def client(tmp_path):
    (tmp_path / "index.html").write_text("<h1>Exported app</h1>", encoding="utf-8")
    (tmp_path / "project.html").write_text("<h1>Project</h1>", encoding="utf-8")
    return TestClient(create_app(tmp_path, session_secret="test-session-secret"))


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
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )

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
    client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )

    response = client.post("/api/auth/logout")

    assert response.status_code == 204
    assert client.get("/api/auth/me").status_code == 401
