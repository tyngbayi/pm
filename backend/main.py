import os
import secrets
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Literal

from fastapi import Depends, FastAPI, Request
from fastapi.staticfiles import StaticFiles
from openai import APIError
from pydantic import BaseModel, Field, ValidationError
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
    BoardRecord,
    create_card,
    delete_card,
    get_board,
    get_user_id,
    initialize_database,
    move_card,
    rename_column,
    replace_board,
    update_card,
)

STATIC_DIR = Path(__file__).parent / "static"
DEMO_USERNAME = "user"
DEMO_PASSWORD = "password"
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_urlsafe(32)


class LoginRequest(BaseModel):
    username: str
    password: str


class CardData(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    details: str


class ColumnData(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    cardIds: list[str]


class BoardData(BaseModel):
    columns: list[ColumnData]
    cards: dict[str, CardData]


class AiChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class AiChatRequest(BaseModel):
    messages: list[AiChatMessage] = Field(min_length=1)


class AiResponse(BaseModel):
    message: str = Field(min_length=1)
    board_update: BoardData | None = None


class RenameColumnRequest(BaseModel):
    title: str = Field(min_length=1)


class CreateCardRequest(BaseModel):
    column_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    details: str = ""


class UpdateCardRequest(BaseModel):
    title: str | None = None
    details: str | None = None


class MoveCardRequest(BaseModel):
    column_id: str = Field(min_length=1)
    position: int = Field(ge=0)


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


def board_update_error(board: BoardData, current: BoardRecord) -> str | None:
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
    if column_ids != [column["id"] for column in current["columns"]]:
        return "Board columns cannot be added, removed, or reordered"
    return None


def require_user(request: Request) -> str:
    if request.session.get("username") != DEMO_USERNAME:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return DEMO_USERNAME


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

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/auth/login")
    def login(credentials: LoginRequest, request: Request) -> dict[str, str]:
        if (
            credentials.username != DEMO_USERNAME
            or credentials.password != DEMO_PASSWORD
        ):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        request.session.clear()
        request.session["username"] = DEMO_USERNAME
        return {"username": DEMO_USERNAME}

    @app.post("/api/auth/logout", status_code=204)
    def logout(request: Request) -> Response:
        request.session.clear()
        return Response(status_code=204)

    @app.get("/api/auth/me")
    def current_user(username: str = Depends(require_user)) -> dict[str, str]:
        return {"username": username}

    @app.post("/api/ai/ping")
    def ai_ping(_: str = Depends(require_user)) -> dict[str, str]:
        try:
            response = ask_openrouter("What is 2+2?")
        except OpenRouterConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except (APIError, OpenRouterResponseError) as exc:
            raise HTTPException(
                status_code=502, detail="OpenRouter request failed"
            ) from exc
        return {"response": response}

    def require_database_user(username: str = Depends(require_user)) -> str:
        user_id = get_user_id(db_path, username)
        if user_id is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user_id

    @app.post("/api/ai/chat", response_model=AiResponse)
    def ai_chat(
        payload: AiChatRequest,
        user_id: str = Depends(require_database_user),
    ) -> AiResponse:
        board = get_board(db_path, user_id)
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

        if board_update_error(response.board_update, board):
            raise HTTPException(
                status_code=502, detail="OpenRouter returned an invalid board update"
            )
        try:
            updated = replace_board(
                db_path, user_id, response.board_update.model_dump()
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=502, detail="OpenRouter returned an invalid board update"
            ) from exc
        return AiResponse(message=response.message, board_update=updated)

    @app.get("/api/board", response_model=BoardData)
    def read_board(user_id: str = Depends(require_database_user)) -> BoardRecord:
        board = get_board(db_path, user_id)
        if board is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return board

    @app.put("/api/board", response_model=BoardData)
    def write_board(
        board: BoardData, user_id: str = Depends(require_database_user)
    ) -> BoardRecord:
        current_board = get_board(db_path, user_id)
        if current_board is None:
            raise HTTPException(status_code=404, detail="Board not found")
        error = board_update_error(board, current_board)
        if error:
            raise HTTPException(status_code=422, detail=error)

        try:
            updated = replace_board(db_path, user_id, board.model_dump())
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=409, detail="Board data conflicts with existing records"
            ) from exc
        if updated is None:
            raise HTTPException(status_code=404, detail="Board not found")
        return updated

    @app.patch("/api/columns/{column_id}")
    def patch_column(
        column_id: str,
        payload: RenameColumnRequest,
        user_id: str = Depends(require_database_user),
    ) -> dict[str, str]:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="Column title cannot be empty")
        if not rename_column(db_path, user_id, column_id, title):
            raise HTTPException(status_code=404, detail="Column not found")
        return {"id": column_id, "title": title}

    @app.post("/api/cards", response_model=CardData, status_code=201)
    def post_card(
        payload: CreateCardRequest,
        user_id: str = Depends(require_database_user),
    ) -> dict[str, str]:
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
    ) -> dict[str, str]:
        changes = payload.model_dump(exclude_unset=True)
        if not changes or any(value is None for value in changes.values()):
            raise HTTPException(
                status_code=422, detail="Provide a title or details to update"
            )
        if "title" in changes:
            changes["title"] = changes["title"].strip()
            if not changes["title"]:
                raise HTTPException(
                    status_code=422, detail="Card title cannot be empty"
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

    app.mount(
        "/",
        ExportStaticFiles(directory=static_dir, html=True),
        name="static",
    )
    return app


app = create_app()
