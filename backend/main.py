import os
import secrets
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import Response
from starlette.types import Scope

STATIC_DIR = Path(__file__).parent / "static"
DEMO_USERNAME = "user"
DEMO_PASSWORD = "password"
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_urlsafe(32)


class LoginRequest(BaseModel):
    username: str
    password: str


class ExportStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
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

        return await super().get_response("index.html", scope)


def require_user(request: Request) -> str:
    if request.session.get("username") != DEMO_USERNAME:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return DEMO_USERNAME


def create_app(
    static_dir: Path = STATIC_DIR,
    session_secret: str = SESSION_SECRET,
) -> FastAPI:
    app = FastAPI()
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

    app.mount(
        "/",
        ExportStaticFiles(directory=static_dir, html=True),
        name="static",
    )
    return app


app = create_app()
