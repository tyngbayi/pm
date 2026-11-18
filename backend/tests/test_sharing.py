"""Boards shared with another user: access, limits, and clean-up."""

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
    """Register and stay signed in as the new account."""
    response = client.post("/api/auth/register", json=credentials)
    assert response.status_code == 201, response.text
    return response.json()


def owned_board_id(client) -> str:
    boards = client.get("/api/boards").json()
    return next(board["id"] for board in boards if board["owned"])


def first_card_id(client, board: str) -> str:
    return client.get(f"/api/boards/{board}").json()["columns"][0]["cardIds"][0]


class Shared(NamedTuple):
    owner: TestClient
    member: TestClient
    board: str
    owner_account: dict
    member_account: dict


@pytest.fixture
def shared(app):
    """An owner and a member, both signed in, sharing the owner's board."""
    with TestClient(app) as owner, TestClient(app) as member:
        member_account = register(member, MEMBER)
        owner_account = sign_in(owner)
        board = owned_board_id(owner)
        response = owner.post(
            f"/api/boards/{board}/members", json={"username": MEMBER["username"]}
        )
        assert response.status_code == 201, response.text
        assert response.json() == {
            "id": member_account["id"],
            "display_name": member_account["display_name"],
        }
        yield Shared(owner, member, board, owner_account, member_account)


def test_a_shared_board_is_listed_for_the_member_as_not_owned(shared):
    boards = shared.member.get("/api/boards").json()

    by_id = {entry["id"]: entry["owned"] for entry in boards}

    assert by_id[shared.board] is False
    assert all(owned for key, owned in by_id.items() if key != shared.board)


def test_a_member_can_read_and_edit_a_shared_board(shared):
    column_id = shared.member.get(f"/api/boards/{shared.board}").json()["columns"][0][
        "id"
    ]

    created = shared.member.post(
        "/api/cards", json={"column_id": column_id, "title": "From the member"}
    )

    assert created.status_code == 201
    cards = shared.owner.get(f"/api/boards/{shared.board}").json()["cards"].values()
    assert "From the member" in {card["title"] for card in cards}


def test_a_member_can_be_assigned_a_card_on_a_shared_board(shared):
    card_id = first_card_id(shared.owner, shared.board)

    response = shared.owner.patch(
        f"/api/cards/{card_id}", json={"assigneeId": shared.member_account["id"]}
    )

    assert response.status_code == 200
    assert response.json()["assigneeId"] == shared.member_account["id"]


def test_the_board_roster_is_the_owner_plus_the_people_it_is_shared_with(shared):
    roster = shared.member.get(f"/api/boards/{shared.board}/members").json()

    assert {entry["id"] for entry in roster} == {
        shared.owner_account["id"],
        shared.member_account["id"],
    }


def test_a_non_member_cannot_reach_the_board(app, shared):
    with TestClient(app) as outsider:
        register(outsider, OUTSIDER)

        assert outsider.get(f"/api/boards/{shared.board}").status_code == 404
        assert outsider.get(f"/api/boards/{shared.board}/members").status_code == 404
        assert (
            outsider.patch(
                f"/api/boards/{shared.board}", json={"name": "Hijacked"}
            ).status_code
            == 404
        )


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("patch", "", {"name": "Renamed by a member"}),
        ("delete", "", None),
        ("post", "/members", {"username": OUTSIDER["username"]}),
    ],
)
def test_only_the_owner_may_rename_delete_or_share_a_board(
    shared, method, suffix, body
):
    """Members get the board's contents; the board itself stays the owner's."""
    call = getattr(shared.member, method)
    url = f"/api/boards/{shared.board}{suffix}"

    response = call(url) if body is None else call(url, json=body)

    assert response.status_code == 404
    assert response.json()["detail"] == "Board not found"


@pytest.mark.parametrize("username", [MEMBER["username"], ADMIN["username"]])
def test_sharing_with_someone_who_already_has_the_board_is_refused(shared, username):
    response = shared.owner.post(
        f"/api/boards/{shared.board}/members", json={"username": username}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "That user already has this board"


def test_sharing_with_an_unknown_username_is_a_404(shared):
    response = shared.owner.post(
        f"/api/boards/{shared.board}/members", json={"username": "nobody"}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


def test_removing_a_member_revokes_access_and_unassigns_their_cards(shared):
    card_id = first_card_id(shared.owner, shared.board)
    shared.owner.patch(
        f"/api/cards/{card_id}", json={"assigneeId": shared.member_account["id"]}
    )

    removed = shared.owner.delete(
        f"/api/boards/{shared.board}/members/{shared.member_account['id']}"
    )

    assert removed.status_code == 204
    assert shared.member.get(f"/api/boards/{shared.board}").status_code == 404
    board = shared.owner.get(f"/api/boards/{shared.board}").json()
    assert board["cards"][card_id]["assigneeId"] is None


def test_removing_the_owner_is_a_404(shared):
    """The owner reaches the board through `boards.user_id`, not a member row."""
    response = shared.owner.delete(
        f"/api/boards/{shared.board}/members/{shared.owner_account['id']}"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Board member not found"


def test_deleting_a_shared_board_takes_it_away_from_the_member(shared):
    shared.owner.post("/api/boards", json={"name": "Spare"})

    assert shared.owner.delete(f"/api/boards/{shared.board}").status_code == 204

    listed = {entry["id"] for entry in shared.member.get("/api/boards").json()}
    assert shared.board not in listed
    assert listed


def test_deleting_the_member_leaves_the_owner_their_board(shared):
    assert (
        shared.owner.delete(
            f"/api/users/{shared.member_account['id']}"
        ).status_code
        == 204
    )

    assert shared.owner.get(f"/api/boards/{shared.board}").status_code == 200
    roster = shared.owner.get(f"/api/boards/{shared.board}/members").json()
    assert [entry["id"] for entry in roster] == [shared.owner_account["id"]]


def test_a_shared_board_is_not_the_members_last_board(shared):
    """Shared boards are not theirs to lose, so deleting their own is refused."""
    own = owned_board_id(shared.member)

    assert shared.member.delete(f"/api/boards/{own}").status_code == 409
