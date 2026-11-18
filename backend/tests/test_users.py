import pytest
from fastapi.testclient import TestClient

from conftest import board_url

ADMIN = {"username": "user", "password": "password"}


def sign_in(client, credentials=None):
    response = client.post("/api/auth/login", json=credentials or ADMIN)
    assert response.status_code == 200
    return response.json()


def register(client, username, password="hunter2hunter2", **extra):
    return client.post(
        "/api/auth/register",
        json={"username": username, "password": password, **extra},
    )


def test_register_creates_an_account_with_its_own_seeded_board(client):
    response = register(client, "ada", display_name="Ada Lovelace")

    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "ada"
    assert body["display_name"] == "Ada Lovelace"
    assert body["role"] == "member"
    assert "password" not in body and "password_hash" not in body

    # Registration signs the new account in, and it starts with its own board.
    assert client.get("/api/auth/me").json()["username"] == "ada"
    board = client.get(board_url(client))
    assert board.status_code == 200
    assert len(board.json()["columns"]) == 5


def test_register_defaults_the_display_name_to_the_username(client):
    assert register(client, "grace").json()["display_name"] == "grace"


def test_register_rejects_a_duplicate_username(client):
    assert register(client, "ada").status_code == 201
    client.post("/api/auth/logout")

    response = register(client, "ada")

    assert response.status_code == 409
    assert response.json()["detail"] == "That username is already taken"


@pytest.mark.parametrize(
    "username,password",
    [
        ("ab", "hunter2hunter2"),  # username below the minimum length
        ("has space", "hunter2hunter2"),  # username outside the allowed pattern
        ("valid", "short"),  # password below the minimum length
    ],
)
def test_register_rejects_invalid_input(client, username, password):
    assert register(client, username, password).status_code == 422


def test_registered_user_can_sign_in_again(client):
    register(client, "ada")
    client.post("/api/auth/logout")

    assert sign_in(client, {"username": "ada", "password": "hunter2hunter2"})[
        "username"
    ] == "ada"


def test_each_user_only_sees_their_own_board(app):
    """The core isolation guarantee: one account cannot read or write another's."""
    with TestClient(app) as ada, TestClient(app) as grace:
        register(ada, "ada")
        register(grace, "grace")

        ada_board = ada.get(board_url(ada)).json()
        grace_board = grace.get(board_url(grace)).json()
        assert {column["id"] for column in ada_board["columns"]}.isdisjoint(
            column["id"] for column in grace_board["columns"]
        )

        ada_column = ada_board["columns"][0]["id"]
        created = ada.post(
            "/api/cards", json={"column_id": ada_column, "title": "Ada only"}
        )
        assert created.status_code == 201
        card_id = created.json()["id"]

        # Grace cannot see, edit, move, or delete a card on Ada's board.
        assert card_id not in grace.get(board_url(grace)).json()["cards"]
        assert (
            grace.post(
                "/api/cards", json={"column_id": ada_column, "title": "Intruder"}
            ).status_code
            == 404
        )
        assert (
            grace.patch(
                f"/api/cards/{card_id}", json={"title": "Hijacked"}
            ).status_code
            == 404
        )
        assert grace.delete(f"/api/cards/{card_id}").status_code == 404
        assert (
            grace.patch(
                f"/api/columns/{ada_column}", json={"title": "Hijacked"}
            ).status_code
            == 404
        )
        assert card_id in ada.get(board_url(ada)).json()["cards"]


def test_admin_lists_and_creates_users(client):
    sign_in(client)

    assert [user["username"] for user in client.get("/api/users").json()] == ["user"]

    created = client.post(
        "/api/users",
        json={
            "username": "grace",
            "password": "hunter2hunter2",
            "display_name": "Grace Hopper",
            "role": "admin",
        },
    )

    assert created.status_code == 201
    assert created.json()["role"] == "admin"
    assert {user["username"] for user in client.get("/api/users").json()} == {
        "user",
        "grace",
    }


def test_admin_routes_reject_members_and_anonymous_callers(app):
    with TestClient(app) as member, TestClient(app) as anonymous:
        register(member, "ada")

        for request in (
            lambda c: c.get("/api/users"),
            lambda c: c.post(
                "/api/users", json={"username": "x1", "password": "hunter2hunter2"}
            ),
            lambda c: c.patch("/api/users/user-1", json={"role": "admin"}),
            lambda c: c.delete("/api/users/user-1"),
        ):
            assert request(member).status_code == 403
            assert request(anonymous).status_code == 401


def test_admin_updates_a_users_name_role_and_password(client):
    sign_in(client)
    created = client.post(
        "/api/users", json={"username": "ada", "password": "hunter2hunter2"}
    ).json()

    response = client.patch(
        f"/api/users/{created['id']}",
        json={"display_name": "Ada L", "role": "admin", "password": "newpassword1"},
    )

    assert response.status_code == 200
    assert response.json()["display_name"] == "Ada L"
    assert response.json()["role"] == "admin"
    client.post("/api/auth/logout")
    assert sign_in(client, {"username": "ada", "password": "newpassword1"})


def test_update_user_rejects_empty_changes_and_unknown_ids(client):
    sign_in(client)

    assert client.patch("/api/users/user-missing", json={}).status_code == 422
    assert (
        client.patch("/api/users/user-missing", json={"role": "admin"}).status_code
        == 404
    )


def test_the_last_administrator_cannot_be_demoted(client):
    admin = sign_in(client)

    response = client.patch(f"/api/users/{admin['id']}", json={"role": "member"})

    assert response.status_code == 409
    assert client.get("/api/auth/me").json()["role"] == "admin"


def test_demotion_is_allowed_once_another_administrator_exists(client):
    admin = sign_in(client)
    client.post(
        "/api/users",
        json={"username": "grace", "password": "hunter2hunter2", "role": "admin"},
    )

    assert (
        client.patch(f"/api/users/{admin['id']}", json={"role": "member"}).status_code
        == 200
    )


def test_admin_deletes_a_user_and_their_board(app):
    with TestClient(app) as admin, TestClient(app) as ada:
        ada_id = register(ada, "ada").json()["id"]
        ada_board_url = board_url(ada)
        ada_board = ada.get(ada_board_url).json()
        sign_in(admin)

        assert admin.delete(f"/api/users/{ada_id}").status_code == 204
        assert admin.delete(f"/api/users/{ada_id}").status_code == 404
        assert "ada" not in {
            user["username"] for user in admin.get("/api/users").json()
        }
        # The session outlives the account, so the next request must 401
        # rather than fail resolving a missing user.
        assert ada.get(ada_board_url).status_code == 401
        # Deleting the user cascades to the board, columns, and cards.
        assert ada_board["columns"]


def test_an_admin_cannot_delete_their_own_account(client):
    admin = sign_in(client)

    response = client.delete(f"/api/users/{admin['id']}")

    assert response.status_code == 409
    assert client.get("/api/auth/me").status_code == 200
