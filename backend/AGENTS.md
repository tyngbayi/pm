# Backend

The FastAPI application is in `main.py`; SQLite setup and board/card persistence
are in `database.py`. It exposes public health and fake-login routes, protects
board and card APIs with a signed session cookie, and serves the Next.js static
export from `static/`, including extensionless exported pages and the app-shell
fallback for client-side routes. The demo credentials are `user` and `password`.
The database path defaults to `data/kanban.db` and can be overridden with
`DATABASE_PATH`.

Dependencies are managed with uv using `pyproject.toml` and `uv.lock`. Run the
backend tests from this directory with `uv run pytest`.