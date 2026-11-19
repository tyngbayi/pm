import pytest

from conftest import board_url

ADMIN = {"username": "user", "password": "password"}
DEFAULTS = {"priority": "medium", "dueDate": "", "labels": [], "assigneeId": None}


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


def first_card_id(client) -> str:
    board = client.get(board_url(client)).json()
    return board["columns"][0]["cardIds"][0]


def patch_card(client, card_id, changes):
    return client.patch(f"/api/cards/{card_id}", json=changes)


def share(client, url, username):
    response = client.post(f"{url}/members", json={"username": username})
    assert response.status_code == 201
    return response.json()


def test_seeded_cards_carry_the_new_field_defaults(client):
    sign_in(client)
    board = client.get(board_url(client)).json()

    for card in board["cards"].values():
        assert {field: card[field] for field in DEFAULTS} == DEFAULTS


def test_created_cards_carry_the_new_field_defaults(client):
    sign_in(client)
    board = client.get(board_url(client)).json()

    response = client.post(
        "/api/cards",
        json={"column_id": board["columns"][0]["id"], "title": "Fresh"},
    )

    assert response.status_code == 201
    assert {field: response.json()[field] for field in DEFAULTS} == DEFAULTS


def test_update_card_persists_every_new_field(client):
    user = sign_in(client)
    card_id = first_card_id(client)

    response = patch_card(
        client,
        card_id,
        {
            "priority": "high",
            "dueDate": "2026-12-01",
            "labels": ["design", "urgent"],
            "assigneeId": user["id"],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": card_id,
        "title": response.json()["title"],
        "details": response.json()["details"],
        "priority": "high",
        "dueDate": "2026-12-01",
        "labels": ["design", "urgent"],
        "assigneeId": user["id"],
        "commentCount": 0,
        "checklistDone": 0,
        "checklistTotal": 0,
        "blockerCount": 0,
    }
    board = client.get(board_url(client)).json()
    assert board["cards"][card_id]["labels"] == ["design", "urgent"]
    assert board["cards"][card_id]["assigneeId"] == user["id"]


def test_assignee_can_be_cleared_with_an_explicit_null(client):
    user = sign_in(client)
    card_id = first_card_id(client)
    assert patch_card(client, card_id, {"assigneeId": user["id"]}).status_code == 200

    response = patch_card(client, card_id, {"assigneeId": None})

    assert response.status_code == 200
    assert response.json()["assigneeId"] is None


def test_update_card_rejects_a_null_in_a_non_nullable_field(client):
    sign_in(client)

    response = patch_card(client, first_card_id(client), {"priority": None})

    assert response.status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"priority": "urgent"},
        {"dueDate": "2026-13-01"},
        {"dueDate": "next tuesday"},
        {"labels": [""]},
        {"labels": ["x" * 25]},
        {"labels": [f"label-{index}" for index in range(9)]},
    ],
)
def test_update_card_rejects_invalid_field_values(client, changes):
    sign_in(client)

    assert patch_card(client, first_card_id(client), changes).status_code == 422


@pytest.mark.parametrize("assignee", ["user-ghost", "outsider"])
def test_update_card_rejects_a_non_member_assignee(client, assignee):
    """A real user who is not on this board is as unassignable as a ghost."""
    sign_in(client)
    if assignee == "outsider":
        assignee = register(client, "outsider")["id"]
        sign_in(client)

    response = patch_card(client, first_card_id(client), {"assigneeId": assignee})

    assert response.status_code == 422
    assert (
        response.json()["detail"] == "Cards must be assigned to a member of this board"
    )


def test_an_empty_due_date_clears_the_deadline(client):
    sign_in(client)
    card_id = first_card_id(client)
    assert patch_card(client, card_id, {"dueDate": "2026-01-05"}).status_code == 200

    response = patch_card(client, card_id, {"dueDate": ""})

    assert response.status_code == 200
    assert response.json()["dueDate"] == ""


def test_deleting_the_assignee_unassigns_their_cards(client):
    sign_in(client)
    member = register(client, "assignee")
    sign_in(client)
    url = board_url(client)
    share(client, url, "assignee")
    card_id = first_card_id(client)
    assert patch_card(client, card_id, {"assigneeId": member["id"]}).status_code == 200

    assert client.delete(f"/api/users/{member['id']}").status_code == 204

    assert client.get(url).json()["cards"][card_id]["assigneeId"] is None


def test_board_members_are_listed_for_anyone_who_can_open_the_board(client):
    owner = sign_in(client)
    member = register(client, "teammate")
    sign_in(client)
    url = board_url(client)
    share(client, url, "teammate")
    sign_in(client, {"username": "teammate", "password": "hunter2hunter2"})

    assert client.get("/api/users").status_code == 403
    response = client.get(f"{url}/members")

    assert response.status_code == 200
    assert {entry["id"] for entry in response.json()} == {owner["id"], member["id"]}
    assert set(response.json()[0]) == {"id", "display_name"}


def test_board_members_require_a_session(client):
    sign_in(client)
    url = board_url(client)
    client.post("/api/auth/logout")

    assert client.get(f"{url}/members").status_code == 401


def test_replace_board_keeps_the_new_card_fields(client):
    user = sign_in(client)
    url = board_url(client)
    board = client.get(url).json()
    card_id = board["columns"][0]["cardIds"][0]
    board["cards"][card_id] |= {
        "priority": "low",
        "dueDate": "2027-03-04",
        "labels": ["carried"],
        "assigneeId": user["id"],
    }

    response = client.put(url, json=board)

    assert response.status_code == 200
    assert response.json()["cards"][card_id]["labels"] == ["carried"]
    assert client.get(url).json()["cards"][card_id]["dueDate"] == "2027-03-04"


def test_replace_board_rejects_a_non_member_assignee(client):
    sign_in(client)
    outsider = register(client, "outsider")
    sign_in(client)
    url = board_url(client)
    board = client.get(url).json()
    card_id = board["columns"][0]["cardIds"][0]
    board["cards"][card_id]["assigneeId"] = outsider["id"]

    response = client.put(url, json=board)

    assert response.status_code == 422
    assert (
        response.json()["detail"]
        == "Board cards must be assigned to a member of this board"
    )
    assert client.get(url).json()["cards"][card_id]["assigneeId"] is None


def test_moving_a_card_preserves_its_fields(client):
    sign_in(client)
    url = board_url(client)
    board = client.get(url).json()
    card_id = board["columns"][0]["cardIds"][0]
    target = board["columns"][1]["id"]
    patch_card(client, card_id, {"priority": "high", "labels": ["kept"]})

    response = client.patch(
        f"/api/cards/{card_id}/move", json={"column_id": target, "position": 0}
    )

    assert response.status_code == 200
    assert response.json()["cards"][card_id]["priority"] == "high"
    assert response.json()["cards"][card_id]["labels"] == ["kept"]
