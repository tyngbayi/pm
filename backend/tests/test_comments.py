"""Card comment threads: who may read, add, and delete them."""

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
    response = client.post("/api/auth/register", json=credentials)
    assert response.status_code == 201, response.text
    return response.json()


def owned_board_id(client) -> str:
    boards = client.get("/api/boards").json()
    return next(board["id"] for board in boards if board["owned"])


def first_card_id(client, board: str) -> str:
    return client.get(f"/api/boards/{board}").json()["columns"][0]["cardIds"][0]


def comment(client, card_id: str, body: str):
    return client.post(f"/api/cards/{card_id}/comments", json={"body": body})


def bodies(client, card_id: str) -> list[str]:
    response = client.get(f"/api/cards/{card_id}/comments")
    assert response.status_code == 200, response.text
    return [entry["body"] for entry in response.json()]


class Thread(NamedTuple):
    owner: TestClient
    member: TestClient
    board: str
    card: str
    owner_account: dict
    member_account: dict


@pytest.fixture
def thread(app):
    """An owner and a member sharing a board, plus one of its cards."""
    with TestClient(app) as owner, TestClient(app) as member:
        member_account = register(member, MEMBER)
        owner_account = sign_in(owner)
        board = owned_board_id(owner)
        shared = owner.post(
            f"/api/boards/{board}/members", json={"username": MEMBER["username"]}
        )
        assert shared.status_code == 201, shared.text
        yield Thread(
            owner,
            member,
            board,
            first_card_id(owner, board),
            owner_account,
            member_account,
        )


def test_a_comment_records_its_author_and_comes_back_in_the_thread(thread):
    response = comment(thread.owner, thread.card, "Blocked on the API review")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["body"] == "Blocked on the API review"
    assert body["author_id"] == thread.owner_account["id"]
    assert body["author_name"] == thread.owner_account["display_name"]
    assert body["created_at"]
    assert thread.owner.get(f"/api/cards/{thread.card}/comments").json() == [body]


def test_comments_are_listed_oldest_first(thread):
    for body in ("first", "second", "third"):
        assert comment(thread.owner, thread.card, body).status_code == 201

    assert bodies(thread.owner, thread.card) == ["first", "second", "third"]


def test_a_shared_board_member_can_read_and_add_comments(thread):
    assert comment(thread.owner, thread.card, "from the owner").status_code == 201

    response = comment(thread.member, thread.card, "from the member")

    assert response.status_code == 201, response.text
    assert response.json()["author_id"] == thread.member_account["id"]
    assert bodies(thread.member, thread.card) == ["from the owner", "from the member"]
    # The thread is one conversation, so the owner sees the member's reply too.
    assert bodies(thread.owner, thread.card) == ["from the owner", "from the member"]


@pytest.mark.parametrize("method", ["get", "post"])
def test_a_non_member_cannot_reach_a_card_thread(app, thread, method):
    with TestClient(app) as outsider:
        register(outsider, OUTSIDER)
        url = f"/api/cards/{thread.card}/comments"
        response = (
            outsider.get(url)
            if method == "get"
            else outsider.post(url, json={"body": "nosy"})
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Card not found"


def test_an_author_can_delete_their_own_comment(thread):
    created = comment(thread.member, thread.card, "never mind").json()

    response = thread.member.delete(f"/api/comments/{created['id']}")

    assert response.status_code == 204
    assert bodies(thread.member, thread.card) == []


def test_someone_elses_comment_cannot_be_deleted(thread):
    created = comment(thread.member, thread.card, "mine to keep").json()

    # Even the board owner may not delete it: the thread is a record of who
    # said what, and editing that is nobody else's call.
    response = thread.owner.delete(f"/api/comments/{created['id']}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Comment not found"
    assert bodies(thread.member, thread.card) == ["mine to keep"]


def test_deleting_a_missing_comment_is_a_404(thread):
    assert thread.owner.delete("/api/comments/comment-ghost").status_code == 404


def test_an_empty_comment_is_refused(thread):
    assert comment(thread.owner, thread.card, "").status_code == 422
    assert comment(thread.owner, thread.card, "x" * 2001).status_code == 422
    assert bodies(thread.owner, thread.card) == []


def test_commenting_on_a_missing_card_is_a_404(thread):
    assert comment(thread.owner, "card-ghost", "hello").status_code == 404


def test_the_board_payload_counts_each_cards_comments(thread):
    assert comment(thread.owner, thread.card, "one").status_code == 201
    assert comment(thread.member, thread.card, "two").status_code == 201

    cards = thread.owner.get(f"/api/boards/{thread.board}").json()["cards"]

    assert cards[thread.card]["commentCount"] == 2
    assert all(
        card["commentCount"] == 0
        for card_id, card in cards.items()
        if card_id != thread.card
    )


def test_the_count_is_read_only_and_survives_a_board_put(thread):
    assert comment(thread.owner, thread.card, "one").status_code == 201
    board = thread.owner.get(f"/api/boards/{thread.board}").json()
    board["cards"][thread.card]["commentCount"] = 99

    response = thread.owner.put(f"/api/boards/{thread.board}", json=board)

    assert response.status_code == 200, response.text
    assert response.json()["cards"][thread.card]["commentCount"] == 1


def test_deleting_a_card_takes_its_comments_with_it(thread):
    created = comment(thread.owner, thread.card, "about to vanish").json()

    assert thread.owner.delete(f"/api/cards/{thread.card}").status_code == 204

    assert thread.owner.get(f"/api/cards/{thread.card}/comments").status_code == 404
    assert thread.owner.delete(f"/api/comments/{created['id']}").status_code == 404


def test_revoking_a_members_access_hides_the_thread_but_keeps_their_comments(thread):
    created = comment(thread.member, thread.card, "said while a member").json()

    removed = thread.owner.delete(
        f"/api/boards/{thread.board}/members/{thread.member_account['id']}"
    )
    assert removed.status_code == 204

    assert thread.member.get(f"/api/cards/{thread.card}/comments").status_code == 404
    # The conversation is a record, so losing access does not erase what they
    # already said; the owner still sees it attributed to them.
    assert thread.owner.get(f"/api/cards/{thread.card}/comments").json() == [created]


def test_deleting_an_account_removes_its_comments(thread):
    assert comment(thread.member, thread.card, "goodbye").status_code == 201
    assert comment(thread.owner, thread.card, "still here").status_code == 201

    deleted = thread.owner.delete(f"/api/users/{thread.member_account['id']}")
    assert deleted.status_code == 204

    assert bodies(thread.owner, thread.card) == ["still here"]


def test_comments_need_a_signed_in_account(app, thread):
    with TestClient(app) as anonymous:
        url = f"/api/cards/{thread.card}/comments"
        assert anonymous.get(url).status_code == 401
        assert anonymous.post(url, json={"body": "hi"}).status_code == 401
        assert anonymous.delete("/api/comments/comment-1").status_code == 401
