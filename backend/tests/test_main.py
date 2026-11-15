from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_endpoint_returns_ok():
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_serves_page_that_displays_health_response():
    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "<h1>Hello, world!</h1>" in response.text
    assert 'fetch("/api/health")' in response.text
    assert "JSON.stringify(data)" in response.text
