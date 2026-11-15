# Backend

The FastAPI application is in `main.py`. It exposes `GET /api/health` and serves
the files in `static/` from `/`.

Dependencies are managed with uv using `pyproject.toml` and `uv.lock`. Run the
backend tests from this directory with `uv run pytest`.