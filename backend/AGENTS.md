# Backend

The FastAPI application is in `main.py`; SQLite setup and user/board/card
persistence are in `database.py`, with password hashing in `security.py`. Accounts
have an `admin` or `member` role and each owns any number of boards under
`/api/boards`. An owner may share a board through
`GET/POST/DELETE /api/boards/{id}/members`; members get the board's contents while
renaming, deleting, and changing the roster stay owner-only. A column carries an optional
WIP limit, set through `PATCH /api/columns/{id}` alongside its title and never
enforced: the API lets a column go over and only the UI flags it. Cards carry a
priority, due date, labels, and an optional assignee, patched field by field
through `/api/cards/{id}`, and an assignee must be a member of the card's board.
`/api/boards/{id}/members` is the names-only roster behind the assignee picker,
readable by anyone who can open that board, while `/api/users` stays admin-only.
Each card has a comment thread under `GET/POST /api/cards/{id}/comments` and
`DELETE /api/comments/{id}`: anyone who can open the board may read and add,
only the author may delete, and the card payload carries a derived
`commentCount`. A card also has a checklist under
`GET/POST /api/cards/{id}/checklist` and `PATCH/DELETE /api/checklist/{id}`,
which anyone who can open the board may add to, tick, and delete because the
checklist belongs to the card rather than to one person; the card payload
carries derived `checklistDone` and `checklistTotal`.
`PATCH /api/cards/{id}/board` sends a card to the end of another accessible
board's first column and answers with the board it left, since that is the one
still on screen. The card keeps its id, so its comments and checklist travel
with it, and an assignee who cannot open the destination is cleared. A board
the user cannot open is a 404, a destination with no columns a 409, and the
card's own board a 422; both boards record the move in their history.
`PATCH /api/cards/{id}/archived` parks a card off the board or puts it back at
the foot of the column it left, answering with the reshaped board, and
`GET /api/boards/{id}/archive` lists what is parked, newest first. An archived
card keeps everything hanging off it and is simply absent from every board
response; `replace_board` preserves it across a whole-board rewrite, so an AI
update cannot erase the archive.
`GET /api/assignments` gathers every card assigned to the
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