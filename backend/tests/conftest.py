import pytest
from fastapi.testclient import TestClient

import security
from main import create_app


@pytest.fixture(autouse=True)
def fast_password_hashing(monkeypatch):
    """Keep PBKDF2 honest but cheap; production iterations make tests crawl."""
    monkeypatch.setattr(security, "ITERATIONS", 1_000)


@pytest.fixture
def app(tmp_path):
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text(
        "<h1>Exported app</h1>", encoding="utf-8"
    )
    (static_dir / "project.html").write_text("<h1>Project</h1>", encoding="utf-8")
    (static_dir / "404.html").write_text("<h1>Not found</h1>", encoding="utf-8")
    return create_app(
        static_dir,
        session_secret="test-session-secret",
        database_path=tmp_path / "kanban.db",
    )


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


def board_id(client, index: int = 0) -> str:
    """Id of one of the signed-in user's boards, oldest first."""
    boards = client.get("/api/boards")
    assert boards.status_code == 200, boards.text
    return boards.json()[index]["id"]


def board_url(client, index: int = 0) -> str:
    return f"/api/boards/{board_id(client, index)}"
