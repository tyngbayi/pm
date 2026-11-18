# Backend

The FastAPI application is in `main.py`; SQLite setup and user/board/card
persistence are in `database.py`, with password hashing in `security.py`. Accounts
have an `admin` or `member` role and each owns any number of boards under
`/api/boards`. An owner may share a board through
`GET/POST/DELETE /api/boards/{id}/members`; members get the board's contents while
renaming, deleting, and changing the roster stay owner-only. Cards carry a
priority, due date, labels, and an optional assignee, patched field by field
through `/api/cards/{id}`, and an assignee must be a member of the card's board.
`/api/boards/{id}/members` is the names-only roster behind the assignee picker,
readable by anyone who can open that board, while `/api/users` stays admin-only.
Each card has a comment thread under `GET/POST /api/cards/{id}/comments` and
`DELETE /api/comments/{id}`: anyone who can open the board may read and add,
only the author may delete, and the card payload carries a derived
`commentCount`. `GET /api/assignments` gathers every card assigned to the
signed-in user across all the boards they can open, with the board name and
column title on each, soonest due first and undated cards last. Every board
change is recorded in `board_activity` and read back newest first by
`GET /api/boards/{id}/activity`, which anyone who can open the board may read;
an entry outlives the account that wrote it. The OpenRouter client in `ai.py` reads `OPENROUTER_API_KEY`
from the environment. The authenticated `/api/ai/ping` route verifies the
connection, and `/api/ai/chat` takes a board id and the conversation, reads that
board from SQLite, and validates and persists any board update before returning
it. The app serves the Next.js static export from `static/`, including
extensionless exported pages, and serves the exported `404.html` for unknown
routes. The seeded demo admin is `user` / `password`. The database path defaults
to `data/kanban.db` and can be overridden with `DATABASE_PATH`.

Dependencies are managed with uv using `pyproject.toml` and `uv.lock`. Run the
backend tests from this directory with `uv run pytest`.