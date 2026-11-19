import os
import secrets
import sqlite3
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, AsyncIterator, Literal

from fastapi import Depends, FastAPI, Request
from fastapi.staticfiles import StaticFiles
from openai import APIError
from pydantic import AfterValidator, BaseModel, Field, ValidationError
from starlette.exceptions import HTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import Response
from starlette.types import Scope

from ai import (
    OpenRouterConfigurationError,
    OpenRouterResponseError,
    ask_openrouter,
    chat_with_openrouter,
)
from database import (
    ActivityRecord,
    ArchivedCard,
    AssignmentRecord,
    BoardRecord,
    BoardSummary,
    CardLinkRecord,
    CardLinksRecord,
    CardRecord,
    ChecklistItemRecord,
    ColumnSummary,
    CommentRecord,
    UserRecord,
    add_board_member,
    authenticate_user,
    board_member_ids,
    board_owner_id,
    card_board_id,
    count_admins,
    count_boards,
    create_board,
    create_card,
    create_card_comment,
    create_card_link,
    create_checklist_item,
    create_column,
    create_user,
    delete_board,
    delete_card,
    delete_card_comment,
    delete_card_link,
    delete_checklist_item,
    delete_column,
    delete_user,
    get_board,
    get_user,
    get_user_by_username,
    initialize_database,
    list_archived_cards,
    list_assignments,
    list_board_activity,
    list_board_members,
    list_boards,
    list_card_comments,
    list_card_links,
    list_checklist_items,
    list_users,
    move_card,
    move_card_to_board,
    move_column,
    remove_board_member,
    rename_board,
    replace_board,
    set_card_archived,
    set_checklist_item_done,
    update_card,
    update_column,
    update_user,
)

STATIC_DIR = Path(__file__).parent / "static"
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_urlsafe(32)
USERNAME_PATTERN = r"^[A-Za-z0-9_.-]+$"
# A column limit is a working agreement, not a quota, so the cap is only here
# to keep a typo out of the database.
MAX_WIP_LIMIT = 99


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=USERNAME_PATTERN)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=80)


class CreateUserRequest(RegisterRequest):
    role: Literal["admin", "member"] = "member"


class UpdateUserRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=80)
    role: Literal["admin", "member"] | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserData(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    created_at: str


class MemberData(BaseModel):
    id: str
    display_name: str


Priority = Literal["low", "medium", "high"]
Labels = Annotated[
    list[Annotated[str, Field(min_length=1, max_length=24)]], Field(max_length=8)
]


def validate_due_date(value: str) -> str:
    """Accept an ISO `YYYY-MM-DD` date, or an empty string for no due date."""
    if value:
        date.fromisoformat(value)
    return value


DueDate = Annotated[
    str, AfterValidator(validate_due_date), Field(json_schema_extra={"format": "date"})
]


class CardData(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    details: str
    priority: Priority = "medium"
    dueDate: DueDate = ""
    labels: Labels = []
    assigneeId: str | None = None
    # Counted from the card's child tables rather than stored on it, so an
    # incoming board update may omit these and never writes them back.
    commentCount: int = 0
    checklistDone: int = 0
    checklistTotal: int = 0
    blockerCount: int = 0


class ColumnData(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    cardIds: list[str]
    # 0 is no limit. Defaulted so a board update written before limits existed,
    # or by an AI reply that ignores them, keeps working.
    wipLimit: int = Field(default=0, ge=0, le=MAX_WIP_LIMIT)


class BoardData(BaseModel):
    columns: list[ColumnData]
    cards: dict[str, CardData]


class BoardSummaryData(BaseModel):
    id: str
    name: str
    created_at: str
    owned: bool


class BoardNameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class AddBoardMemberRequest(BaseModel):
    username: str = Field(min_length=1, max_length=40)


class AiChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class AiChatRequest(BaseModel):
    board_id: str = Field(min_length=1)
    messages: list[AiChatMessage] = Field(min_length=1)


class AiResponse(BaseModel):
    message: str = Field(min_length=1)
    board_update: BoardData | None = None


class UpdateColumnRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    wipLimit: int | None = Field(default=None, ge=0, le=MAX_WIP_LIMIT)


class ColumnSettings(BaseModel):
    id: str
    title: str
    wipLimit: int


class CreateColumnRequest(BaseModel):
    board_id: str = Field(min_length=1)
    title: str = Field(min_length=1)


class MoveColumnRequest(BaseModel):
    position: int = Field(ge=0)


class CreateCardRequest(BaseModel):
    column_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    details: str = ""


class UpdateCardRequest(BaseModel):
    title: str | None = None
    details: str | None = None
    priority: Priority | None = None
    dueDate: DueDate | None = None
    labels: Labels | None = None
    assigneeId: str | None = None


# Clearing an assignee is a real update, so a null here is meaningful; a null
# in any other field is a malformed request.
NULLABLE_CARD_FIELDS = {"assigneeId"}


class MoveCardRequest(BaseModel):
    column_id: str = Field(min_length=1)
    position: int = Field(ge=0)


class MoveCardToBoardRequest(BaseModel):
    board_id: str = Field(min_length=1)


class ArchiveCardRequest(BaseModel):
    archived: bool


class ArchivedCardData(BaseModel):
    id: str
    title: str
    column_title: str
    archived_at: str


class CommentData(BaseModel):
    id: str
    body: str
    author_id: str
    author_name: str
    created_at: str


class CreateCommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ChecklistItemData(BaseModel):
    id: str
    body: str
    done: bool


class CreateChecklistItemRequest(BaseModel):
    body: str = Field(min_length=1, max_length=200)


class SetChecklistItemRequest(BaseModel):
    done: bool


class CardLinkData(BaseModel):
    """One dependency, named from the far side: `card_id` is the other card."""

    id: str
    card_id: str
    title: str
    column_title: str


class CardLinksData(BaseModel):
    blocked_by: list[CardLinkData]
    blocks: list[CardLinkData]


class CreateCardLinkRequest(BaseModel):
    blocker_id: str = Field(min_length=1)


class ActivityData(BaseModel):
    id: str
    summary: str
    author_name: str
    created_at: str


class AssignmentData(BaseModel):
    card_id: str
    title: str
    priority: Priority
    dueDate: str
    board_id: str
    board_name: str
    column_title: str


HASHED_ASSET_PREFIX = "_next/static/"


class ExportStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await self._resolve_response(path, scope)
        # Build assets carry a content hash, so they can be cached forever.
        # Everything else must revalidate: without this a browser heuristically
        # caches the HTML and, after a rebuild, asks for chunk hashes that no
        # longer exist, leaving the page unable to hydrate.
        if path.startswith(HASHED_ASSET_PREFIX):
            response.headers["cache-control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["cache-control"] = "no-cache"
        return response

    async def _resolve_response(self, path: str, scope: Scope) -> Response:
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            response = None

        if response is not None and response.status_code != 404:
            return response

        if path == "api" or path.startswith("api/") or Path(path).suffix:
            if response is not None:
                return response
            raise HTTPException(status_code=404)

        if path:
            try:
                response = await super().get_response(
                    f"{path.rstrip('/')}.html", scope
                )
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
                response = None

            if response is not None and response.status_code != 404:
                return response

            not_found = await super().get_response("404.html", scope)
            not_found.status_code = 404
            return not_found

        return await super().get_response("index.html", scope)


def board_update_error(board: BoardData, member_ids: set[str]) -> str | None:
    """Reject a board whose columns and cards do not line up.

    Columns may be added, removed, and reordered; `replace_board` rewrites the
    whole board, and cards under a removed column cascade away. Assignees are
    checked against the board's members here because `replace_board` would
    otherwise fail the foreign key mid-write.
    """
    if any(
        card.assigneeId is not None and card.assigneeId not in member_ids
        for card in board.cards.values()
    ):
        return "Board cards must be assigned to a member of this board"
    column_ids = [column.id for column in board.columns]
    card_references = [
        card_id for column in board.columns for card_id in column.cardIds
    ]
    if (
        len(column_ids) != len(set(column_ids))
        or len(card_references) != len(set(card_references))
        or set(card_references) != set(board.cards)
        or any(card_id != card.id for card_id, card in board.cards.items())
    ):
        return "Board columns and cards must reference each other exactly once"
    return None


def create_app(
    static_dir: Path = STATIC_DIR,
    session_secret: str = SESSION_SECRET,
    database_path: Path | None = None,
) -> FastAPI:
    db_path = database_path or Path(
        os.environ.get("DATABASE_PATH", "data/kanban.db")
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        initialize_database(db_path)
        yield

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(
        SessionMiddleware,
        secret_key=session_secret,
        session_cookie="pm_session",
        same_site="lax",
    )

    def require_user(request: Request) -> UserRecord:
        user_id = request.session.get("user_id")
        user = get_user(db_path, user_id) if user_id else None
        if user is None:
            # Covers a session pointing at an account that has since been
            # deleted, which would otherwise 500 further down.
            request.session.clear()
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user

    def require_admin(user: UserRecord = Depends(require_user)) -> UserRecord:
        if user["role"] != "admin":
            raise HTTPException(
                status_code=403, detail="Administrator access required"
            )
        return user

    def require_database_user(user: UserRecord = Depends(require_user)) -> str:
        return user["id"]

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/auth/login", response_model=UserData)
    def login(credentials: LoginRequest, request: Request) -> UserRecord:
        user = authenticate_user(
            db_path, credentials.username, credentials.password
        )
        if user is None:
            raise HTTPException(
                status_code=401, detail="Invalid username or password"
            )
        request.session.clear()
        request.session["user_id"] = user["id"]
        return user

    @app.post("/api/auth/register", response_model=UserData, status_code=201)
    def register(payload: RegisterRequest, request: Request) -> UserRecord:
        user = create_user(
            db_path,
            payload.username,
            payload.password,
            payload.display_name.strip() or payload.username,
        )
        if user is None:
            raise HTTPException(
                status_code=409, detail="That username is already taken"
            )
        request.session.clear()
        request.session["user_id"] = user["id"]
        return user

    @app.post("/api/auth/logout", status_code=204)
    def logout(request: Request) -> Response:
        request.session.clear()
        return Response(status_code=204)

    @app.get("/api/auth/me", response_model=UserData)
    def current_user(user: UserRecord = Depends(require_user)) -> UserRecord:
        return user

    @app.get("/api/users", response_model=list[UserData])
    def get_users(_: UserRecord = Depends(require_admin)) -> list[UserRecord]:
        return list_users(db_path)

    @app.post("/api/users", response_model=UserData, status_code=201)
    def post_user(
        payload: CreateUserRequest, _: UserRecord = Depends(require_admin)
    ) -> UserRecord:
        user = create_user(
            db_path,
            payload.username,
            payload.password,
            payload.display_name.strip() or payload.username,
            payload.role,
        )
        if user is None:
            raise HTTPException(
                status_code=409, detail="That username is already taken"
            )
        return user

    @app.patch("/api/users/{user_id}", response_model=UserData)
    def patch_user(
        user_id: str,
        payload: UpdateUserRequest,
        _: UserRecord = Depends(require_admin),
    ) -> UserRecord:
        changes = payload.model_dump(exclude_unset=True, exclude_none=True)
        if not changes:
            raise HTTPException(status_code=422, detail="No changes supplied")
        target = get_user(db_path, user_id)
        if target is None:
            raise HTTPException(status_code=404, detail="User not found")
        if (
            changes.get("role") == "member"
            and target["role"] == "admin"
            and count_admins(db_path) == 1
        ):
            raise HTTPException(
                status_code=409, detail="The last administrator cannot be demoted"
            )
        updated = update_user(db_path, user_id, changes)
        if updated is None:
            raise HTTPException(status_code=404, detail="User not found")
        return updated

    @app.delete("/api/users/{user_id}", status_code=204)
    def remove_user(
        user_id: str, admin: UserRecord = Depends(require_admin)
    ) -> Response:
        if user_id == admin["id"]:
            raise HTTPException(
                status_code=409, detail="You cannot delete your own account"
            )
        if not delete_user(db_path, user_id):
            raise HTTPException(status_code=404, detail="User not found")
        return Response(status_code=204)

    @app.post("/api/ai/ping")
    def ai_ping(_: UserRecord = Depends(require_user)) -> dict[str, str]:
        try:
            response = ask_openrouter("What is 2+2?")
        except OpenRouterConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except (APIError, OpenRouterResponseError) as exc:
            raise HTTPException(
                status_code=502, detail="OpenRouter request failed"
            ) from exc
        return {"response": response}

    @app.post("/api/ai/chat", response_model=AiResponse)
    def ai_chat(
        payload: AiChatRequest,
        user_id: str = Depends(require_database_user),
    ) -> AiResponse:
        board = get_board(db_path, user_id, payload.board_id)
        if board is None:
            raise HTTPException(status_code=404, detail="Board not found")

        try:
            response_json = chat_with_openrouter(
                [message.model_dump() for message in payload.messages],
                board,
            )
            response = AiResponse.model_validate_json(response_json)
        except OpenRouterConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except (APIError, OpenRouterResponseError, ValidationError) as exc:
            raise HTTPException(
                status_code=502, detail="OpenRouter returned an invalid response"
            ) from exc

        if response.board_update is None:
            return response

        if board_update_error(
            response.board_update, board_member_ids(db_path, payload.board_id)
        ):
            raise HTTPException(
                status_code=502, detail="OpenRouter returned an invalid board update"
            )
        try:
            updated = replace_board(
                db_path,
                user_id,
                payload.board_id,
                response.board_update.model_dump(),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=502, detail="OpenRouter returned an invalid board update"
            ) from exc
        return AiResponse(message=response.message, board_update=updated)

    def require_board_owner(board_id: str, user_id: str) -> None:
        """Renaming, deleting, and sharing are the owner's call alone."""
        if board_owner_id(db_path, board_id) != user_id:
            raise HTTPException(status_code=404, detail="Board not found")

    @app.get("/api/boards", response_model=list[BoardSummaryData])
    def read_boards(
        user_id: str = Depends(require_database_user),
    ) -> list[BoardSummary]:
        return list_boards(db_path, user_id)

    @app.post("/api/boards", response_model=BoardSummaryData, status_code=201)
    def post_board(
        payload: BoardNameRequest,
        user_id: str = Depends(require_database_user),
    ) -> BoardSummary:
        return create_board(db_path, user_id, payload.name.strip())

    @app.patch("/api/boards/{board_id}", response_model=BoardSummaryData)
    def patch_board(
        board_id: str,
        payload: BoardNameRequest,
        user_id: str = Depends(require_database_user),
    ) -> BoardSummary:
        board = rename_board(db_path, user_id, board_id, payload.name.strip())
        if board is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return board

    @app.delete("/api/boards/{board_id}", status_code=204)
    def remove_board(
        board_id: str, user_id: str = Depends(require_database_user)
    ) -> Response:
        # Ownership first: a shared board is never the member's to lose, so
        # answering 409 before this check would hide that they cannot delete it.
        require_board_owner(board_id, user_id)
        if count_boards(db_path, user_id) == 1:
            raise HTTPException(
                status_code=409, detail="Your last board cannot be deleted"
            )
        delete_board(db_path, user_id, board_id)
        return Response(status_code=204)

    # The assignee picker needs display names for everyone who can open this
    # board. `/api/users` stays admin-only because it exposes usernames and roles.
    @app.get("/api/boards/{board_id}/members", response_model=list[MemberData])
    def read_board_members(
        board_id: str, user_id: str = Depends(require_database_user)
    ) -> list[UserRecord]:
        members = list_board_members(db_path, user_id, board_id)
        if members is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return members

    @app.post(
        "/api/boards/{board_id}/members",
        response_model=MemberData,
        status_code=201,
    )
    def post_board_member(
        board_id: str,
        payload: AddBoardMemberRequest,
        user_id: str = Depends(require_database_user),
    ) -> UserRecord:
        require_board_owner(board_id, user_id)
        member = get_user_by_username(db_path, payload.username.strip())
        if member is None:
            raise HTTPException(status_code=404, detail="User not found")
        if not add_board_member(db_path, board_id, member["id"], user_id):
            raise HTTPException(
                status_code=409, detail="That user already has this board"
            )
        return member

    @app.delete("/api/boards/{board_id}/members/{member_id}", status_code=204)
    def remove_board_member_route(
        board_id: str,
        member_id: str,
        user_id: str = Depends(require_database_user),
    ) -> Response:
        require_board_owner(board_id, user_id)
        if not remove_board_member(db_path, board_id, member_id, user_id):
            raise HTTPException(status_code=404, detail="Board member not found")
        return Response(status_code=204)

    @app.get("/api/boards/{board_id}", response_model=BoardData)
    def read_board(
        board_id: str, user_id: str = Depends(require_database_user)
    ) -> BoardRecord:
        board = get_board(db_path, user_id, board_id)
        if board is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return board

    @app.put("/api/boards/{board_id}", response_model=BoardData)
    def write_board(
        board_id: str,
        board: BoardData,
        user_id: str = Depends(require_database_user),
    ) -> BoardRecord:
        current_board = get_board(db_path, user_id, board_id)
        if current_board is None:
            raise HTTPException(status_code=404, detail="Board not found")
        error = board_update_error(board, board_member_ids(db_path, board_id))
        if error:
            raise HTTPException(status_code=422, detail=error)

        try:
            updated = replace_board(
                db_path, user_id, board_id, board.model_dump()
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=409, detail="Board data conflicts with existing records"
            ) from exc
        return updated

    @app.patch("/api/columns/{column_id}", response_model=ColumnSettings)
    def patch_column(
        column_id: str,
        payload: UpdateColumnRequest,
        user_id: str = Depends(require_database_user),
    ) -> ColumnSummary:
        changes = payload.model_dump(exclude_unset=True)
        if not changes or any(value is None for value in changes.values()):
            raise HTTPException(
                status_code=422, detail="Provide column fields to update"
            )
        if "title" in changes:
            changes["title"] = changes["title"].strip()
            if not changes["title"]:
                raise HTTPException(
                    status_code=422, detail="Column title cannot be empty"
                )
        column = update_column(db_path, user_id, column_id, changes)
        if column is None:
            raise HTTPException(status_code=404, detail="Column not found")
        return column

    @app.post("/api/columns", response_model=BoardData, status_code=201)
    def post_column(
        payload: CreateColumnRequest,
        user_id: str = Depends(require_database_user),
    ) -> BoardRecord:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="Column title cannot be empty")
        board = create_column(db_path, user_id, payload.board_id, title)
        if board is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return board

    @app.delete("/api/columns/{column_id}", response_model=BoardData)
    def remove_column(
        column_id: str,
        user_id: str = Depends(require_database_user),
    ) -> BoardRecord:
        board = delete_column(db_path, user_id, column_id)
        if board is None:
            raise HTTPException(status_code=404, detail="Column not found")
        return board

    @app.patch("/api/columns/{column_id}/move", response_model=BoardData)
    def patch_column_move(
        column_id: str,
        payload: MoveColumnRequest,
        user_id: str = Depends(require_database_user),
    ) -> BoardRecord:
        board = move_column(db_path, user_id, column_id, payload.position)
        if board is None:
            raise HTTPException(status_code=404, detail="Column not found")
        return board

    @app.post("/api/cards", response_model=CardData, status_code=201)
    def post_card(
        payload: CreateCardRequest,
        user_id: str = Depends(require_database_user),
    ) -> CardRecord:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="Card title cannot be empty")
        card = create_card(
            db_path, user_id, payload.column_id, title, payload.details
        )
        if card is None:
            raise HTTPException(status_code=404, detail="Column not found")
        return card

    @app.patch("/api/cards/{card_id}", response_model=CardData)
    def patch_card(
        card_id: str,
        payload: UpdateCardRequest,
        user_id: str = Depends(require_database_user),
    ) -> CardRecord:
        changes = payload.model_dump(exclude_unset=True)
        if not changes or any(
            value is None and field not in NULLABLE_CARD_FIELDS
            for field, value in changes.items()
        ):
            raise HTTPException(status_code=422, detail="Provide card fields to update")
        if "title" in changes:
            changes["title"] = changes["title"].strip()
            if not changes["title"]:
                raise HTTPException(
                    status_code=422, detail="Card title cannot be empty"
                )
        assignee = changes.get("assigneeId")
        if assignee is not None:
            board_id = card_board_id(db_path, user_id, card_id)
            if board_id is None:
                raise HTTPException(status_code=404, detail="Card not found")
            if assignee not in board_member_ids(db_path, board_id):
                raise HTTPException(
                    status_code=422,
                    detail="Cards must be assigned to a member of this board",
                )
        card = update_card(db_path, user_id, card_id, changes)
        if card is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return card

    @app.delete("/api/cards/{card_id}", status_code=204)
    def remove_card(
        card_id: str,
        user_id: str = Depends(require_database_user),
    ) -> Response:
        if not delete_card(db_path, user_id, card_id):
            raise HTTPException(status_code=404, detail="Card not found")
        return Response(status_code=204)

    @app.patch("/api/cards/{card_id}/move", response_model=BoardData)
    def patch_card_move(
        card_id: str,
        payload: MoveCardRequest,
        user_id: str = Depends(require_database_user),
    ) -> BoardRecord:
        board = move_card(
            db_path,
            user_id,
            card_id,
            payload.column_id,
            payload.position,
        )
        if board is None:
            raise HTTPException(
                status_code=404, detail="Card or destination column not found"
            )
        return board

    @app.patch("/api/cards/{card_id}/board", response_model=BoardData)
    def patch_card_board(
        card_id: str,
        payload: MoveCardToBoardRequest,
        user_id: str = Depends(require_database_user),
    ) -> BoardRecord:
        destination = get_board(db_path, user_id, payload.board_id)
        if destination is None:
            raise HTTPException(status_code=404, detail="Board not found")
        if not destination["columns"]:
            raise HTTPException(
                status_code=409,
                detail="That board has no columns to hold the card",
            )
        if card_board_id(db_path, user_id, card_id) == payload.board_id:
            raise HTTPException(
                status_code=422, detail="The card is already on that board"
            )
        board = move_card_to_board(db_path, user_id, card_id, payload.board_id)
        if board is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return board

    @app.patch("/api/cards/{card_id}/archived", response_model=BoardData)
    def patch_card_archived(
        card_id: str,
        payload: ArchiveCardRequest,
        user_id: str = Depends(require_database_user),
    ) -> BoardRecord:
        board = set_card_archived(db_path, user_id, card_id, payload.archived)
        if board is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return board

    @app.get(
        "/api/cards/{card_id}/comments", response_model=list[CommentData]
    )
    def read_card_comments(
        card_id: str,
        user_id: str = Depends(require_database_user),
    ) -> list[CommentRecord]:
        comments = list_card_comments(db_path, user_id, card_id)
        if comments is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return comments

    @app.post(
        "/api/cards/{card_id}/comments",
        response_model=CommentData,
        status_code=201,
    )
    def add_card_comment(
        card_id: str,
        payload: CreateCommentRequest,
        user_id: str = Depends(require_database_user),
    ) -> CommentRecord:
        comment = create_card_comment(db_path, user_id, card_id, payload.body)
        if comment is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return comment

    @app.delete("/api/comments/{comment_id}", status_code=204)
    def remove_card_comment(
        comment_id: str,
        user_id: str = Depends(require_database_user),
    ) -> Response:
        # Someone else's comment is not theirs to delete, and saying so would
        # confirm it exists, so it reads the same as a missing one.
        if not delete_card_comment(db_path, user_id, comment_id):
            raise HTTPException(status_code=404, detail="Comment not found")
        return Response(status_code=204)

    @app.get(
        "/api/cards/{card_id}/checklist",
        response_model=list[ChecklistItemData],
    )
    def read_checklist(
        card_id: str,
        user_id: str = Depends(require_database_user),
    ) -> list[ChecklistItemRecord]:
        items = list_checklist_items(db_path, user_id, card_id)
        if items is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return items

    @app.post(
        "/api/cards/{card_id}/checklist",
        response_model=ChecklistItemData,
        status_code=201,
    )
    def add_checklist_item(
        card_id: str,
        payload: CreateChecklistItemRequest,
        user_id: str = Depends(require_database_user),
    ) -> ChecklistItemRecord:
        item = create_checklist_item(db_path, user_id, card_id, payload.body)
        if item is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return item

    @app.patch(
        "/api/checklist/{item_id}", response_model=ChecklistItemData
    )
    def update_checklist_item(
        item_id: str,
        payload: SetChecklistItemRequest,
        user_id: str = Depends(require_database_user),
    ) -> ChecklistItemRecord:
        item = set_checklist_item_done(db_path, user_id, item_id, payload.done)
        if item is None:
            raise HTTPException(status_code=404, detail="Item not found")
        return item

    @app.delete("/api/checklist/{item_id}", status_code=204)
    def remove_checklist_item(
        item_id: str,
        user_id: str = Depends(require_database_user),
    ) -> Response:
        if not delete_checklist_item(db_path, user_id, item_id):
            raise HTTPException(status_code=404, detail="Item not found")
        return Response(status_code=204)

    @app.get("/api/cards/{card_id}/links", response_model=CardLinksData)
    def read_card_links(
        card_id: str,
        user_id: str = Depends(require_database_user),
    ) -> CardLinksRecord:
        links = list_card_links(db_path, user_id, card_id)
        if links is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return links

    @app.post(
        "/api/cards/{card_id}/links",
        response_model=CardLinkData,
        status_code=201,
    )
    def add_card_link(
        card_id: str,
        payload: CreateCardLinkRequest,
        user_id: str = Depends(require_database_user),
    ) -> CardLinkRecord:
        result = create_card_link(db_path, user_id, card_id, payload.blocker_id)
        if "status" in result:
            raise HTTPException(
                status_code=result["status"], detail=result["detail"]
            )
        return result

    @app.delete("/api/links/{link_id}", status_code=204)
    def remove_card_link(
        link_id: str,
        user_id: str = Depends(require_database_user),
    ) -> Response:
        if not delete_card_link(db_path, user_id, link_id):
            raise HTTPException(status_code=404, detail="Link not found")
        return Response(status_code=204)

    @app.get(
        "/api/boards/{board_id}/activity", response_model=list[ActivityData]
    )
    def read_board_activity(
        board_id: str, user_id: str = Depends(require_database_user)
    ) -> list[ActivityRecord]:
        activity = list_board_activity(db_path, user_id, board_id)
        if activity is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return activity

    @app.get(
        "/api/boards/{board_id}/archive", response_model=list[ArchivedCardData]
    )
    def read_board_archive(
        board_id: str, user_id: str = Depends(require_database_user)
    ) -> list[ArchivedCard]:
        archived = list_archived_cards(db_path, user_id, board_id)
        if archived is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return archived

    @app.get("/api/assignments", response_model=list[AssignmentData])
    def read_assignments(
        user_id: str = Depends(require_database_user),
    ) -> list[AssignmentRecord]:
        return list_assignments(db_path, user_id)

    app.mount(
        "/",
        ExportStaticFiles(directory=static_dir, html=True),
        name="static",
    )
    return app


app = create_app()
