# Backend

The FastAPI application is in `main.py`. It exposes public health and fake-login
routes, uses a signed session cookie to authenticate requests, and serves the
Next.js static export from `static/`, including extensionless exported pages and
the app-shell fallback for client-side routes. The demo credentials are `user`
and `password`.

Dependencies are managed with uv using `pyproject.toml` and `uv.lock`. Run the
backend tests from this directory with `uv run pytest`.