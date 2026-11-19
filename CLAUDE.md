# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project documentation

`AGENTS.md` (root), `backend/AGENTS.md`, and `frontend/AGENTS.md` hold the business
requirements, technical decisions, and color palette. `docs/PLAN.md` is the working
plan and test policy; read it before starting work. `docs/DATABASE.md` is the
approved SQLite schema. Keep these updated as behavior changes.

## Coding standards (from AGENTS.md)

1. Use latest library versions and idiomatic approaches.
2. Keep it simple. Never over-engineer; no unnecessary defensive programming; no extra features.
3. Be concise. Keep the README minimal. No emojis, ever.
4. When hitting issues, find the root cause with evidence before fixing. Do not guess.

## Commands

Run the app (builds the Docker image, which bakes in the Next.js static export, then
starts it on `http://localhost:8000` with the `pm-data` volume and `.env`):

```sh
./scripts/start.sh    # scripts/start.bat on Windows
./scripts/stop.sh
```

Backend (from `backend/`):

```sh
uv run pytest                                  # all tests, with coverage of main + database
uv run pytest tests/test_main.py::test_health_endpoint_returns_ok
uv run uvicorn main:app --reload               # local dev server without Docker
```

Frontend (from `frontend/`):

```sh
npm run test:unit                              # vitest
npm run test:unit -- src/lib/kanban.test.ts    # single file
npm run test:unit:watch
npm run lint
npm run build                                  # static export to out/
npm run test:e2e                               # Playwright; app must already be running
npm run test:e2e -- --grep "login"
```

Playwright targets `http://127.0.0.1:8000` by default; override with
`PLAYWRIGHT_BASE_URL`. `npm run test:all` assumes the app is running.

Note `next dev` serves the frontend alone, so API calls fail. For full-stack work use
the Docker scripts, or run uvicorn and point the frontend at it.

## Architecture

Single deployable: FastAPI serves both the JSON API under `/api` and the Next.js
static export mounted at `/`.

**Build pipeline.** The Dockerfile has a `node:22-alpine` stage that runs
`next build` (`output: "export"` in `next.config.ts`), then copies `frontend/out`
into the Python stage as `backend/static`. Frontend changes are only visible after an
image rebuild, which is why the start scripts always rebuild. The Python stage copies
backend modules by name, so a new `backend/*.py` file must be added to that `COPY`
line or the container fails to start with `ModuleNotFoundError`.

**Static serving.** `ExportStaticFiles` in `backend/main.py` subclasses `StaticFiles`
to make the export work: on a 404 it retries `<path>.html` (extensionless exported
pages), then serves the exported `404.html` with a real 404 status. Paths under `api/`
or with a file suffix skip the `.html` retry. The export only contains `/`, `/login`,
`/signup`, `/admin`, and `/404`, so there are no client-side routes to fall back
to `index.html` for.
It also sets `Cache-Control`: `no-cache` for pages and `immutable` for
`_next/static/` assets. Pages must revalidate because chunk filenames are
content-hashed, so a cached page would otherwise request chunks that a rebuild
has already removed.

**App construction.** `create_app(static_dir, session_secret, database_path)` in
`backend/main.py` builds the app, so tests inject a `tmp_path` database and static
directory. The module-level `app` uses `DATABASE_PATH` (default `data/kanban.db`).
A lifespan hook runs `initialize_database`, which applies the `CREATE TABLE IF NOT
EXISTS` schema and seeds the `user` account, its board, and five columns with eight
cards when absent.

**Auth.** Starlette `SessionMiddleware` with a signed `pm_session` cookie holding
`user_id`. Accounts live in SQLite with PBKDF2-SHA256 hashes from
`backend/security.py`; `user` / `password` is only a seeded demo admin. `require_user`
resolves the session to a `UserRecord` (clearing the cookie if the account is gone),
`require_admin` gates `/api/users`, and `require_database_user` yields the id. All
database queries join through `boards.user_id` to scope data to that user.
`/admin` renders `UserManagement.tsx`, which is only linked from the board header
for admins; the route itself is protected by the API's 403, not by the client.

**Migrations.** `PRAGMA user_version` plus the `MIGRATIONS` tuple in
`backend/database.py`. `SCHEMA` stays frozen at the v1 shape so fresh and existing
databases share one upgrade path. Append new migrations; never edit a released one.
`_apply_migrations` uses its own connection with `PRAGMA foreign_keys = OFF`:
SQLite cannot drop a constraint in place, so migration 2 rebuilds `boards`, and
dropping a parent table with enforcement on cascade-deletes all of its children.

**Persistence.** `backend/database.py` is plain `sqlite3` with no ORM. Every call
opens its own connection via the `_connection` context manager, which creates parent
dirs, sets `row_factory`, and enables `PRAGMA foreign_keys = ON`. `columns` and
`cards` both have `UNIQUE (parent_id, position)`, so reordering cannot write
positions in place: `_rewrite_positions` first shifts the whole column past the
current maximum, then writes final zero-based positions, avoiding transient
collisions. `_board_data` is the single place that converts rows into the frontend
`BoardData` shape (columns ordered by position, `cardIds` per column, `cards` keyed
by id).

**Board contract.** `BoardData` is mirrored in three places and must stay in sync:
Pydantic models in `backend/main.py`, `TypedDict`s in `backend/database.py`, and TS
types in `frontend/src/lib/kanban.ts`. A card carries `title`, `details`,
`priority`, `dueDate`, `labels`, and `assigneeId` — camelCase like the existing
`cardIds`, with `database.CARD_UPDATES` mapping each to its snake_case column so
the TS types mirror the API exactly. It also carries `commentCount`,
`checklistDone`, and `checklistTotal`, which are read-only: `CARD_FIELDS` counts
each with a correlated subquery, the Pydantic model defaults them to 0 so an
incoming update may omit them, and `replace_board` never writes them back.
`board_update_error(board, member_ids)`
validates referential integrity (each card referenced exactly once, `cards` keys
matching card ids) and that every assignee is a member of that board, which it
needs because `replace_board` would otherwise fail the foreign key mid-write. A
column carries `wipLimit`, which defaults to 0 in the Pydantic model so an AI
reply that echoes an older board shape loses the limits rather than failing
validation and losing the whole update. Columns
may be added, removed, and reordered; `replace_board` rewrites the whole board and
cards under a removed column cascade away. That rewrite drops every column, so the
board's cards cascade and everything hanging off them goes too: `replace_board`
holds every table in `_CARD_CHILDREN` aside and reinserts the rows whose card
survives. Without that, every `PUT` — and so every AI board update — silently
erased the board's threads. A new per-card child table must be added to
`_CARD_CHILDREN` or it will be erased the same way.

**Boards.** A user owns any number of boards, served by `GET/POST /api/boards` and
`GET/PUT/PATCH/DELETE /api/boards/{id}`, each seeded with its own five columns and
eight cards. Deleting a user's last *owned* board is refused with a 409 so there is
always something to render. Card and column routes take no board id: they scope
themselves with `board_id IN ({ACCESSIBLE_BOARD_IDS})`, never `=`, which would
silently pick one of the user's boards.

**Sharing.** `board_members` records the extra people a board is shared with; the
owner stays implicit in `boards.user_id`. `database.ACCESSIBLE_BOARD_IDS` unions
the two and takes the user id twice — it is the single definition of "boards this
user may read and edit", used by every board, column, and card query. Renaming,
deleting, and changing membership stay owner-only through `require_board_owner`,
which checks `boards.user_id` directly and answers 404 so a non-member learns
nothing. `GET/POST/DELETE /api/boards/{id}/members` manage the roster; `POST` takes
a username and `DELETE` a user id, and removing someone also unassigns their cards
on that board so no card is left pointing at a name the board cannot render.
`remove_board` must check ownership *before* the last-board rule, or a member who
owns one board of their own gets a 409 for a shared board they could never delete.

**Columns.** `PATCH /api/columns/{id}` applies `title`, `wipLimit`, or both and
returns just that column's settings. It is one route rather than two so a header
that saves both fields produces one activity entry; `_column_change_summary`
therefore has to describe either change or both. `wipLimit` is the number of
cards the column should hold, 0 for no limit, and is **never enforced** — the
API happily puts a column over, and only `KanbanColumn.tsx` flags it in red.
Blocking the move would strand the card somewhere it is not.
`POST /api/columns` (appends), `DELETE /api/columns/{id}` (cascades its
cards), and `PATCH /api/columns/{id}/move` all reshape the board, so they return the
whole `BoardData` and the frontend replaces its state with the response. Delete and
move renumber the surviving columns through `_rewrite_positions`, which is shared
with cards and takes the table and parent column as module-local literals.

**Cards.** `POST /api/cards` takes only a title and details; the detail dialog
patches everything else through `PATCH /api/cards/{id}`, which applies just the
fields present in the request body. A null is rejected as malformed except for the
fields in `NULLABLE_CARD_FIELDS` (`assigneeId`), where it is the only way to
unassign. An assignee must be a member of the card's board, checked through
`card_board_id` plus `board_member_ids`. `GET /api/boards/{id}/members` is the
names-only roster that feeds the picker, readable by anyone who can open the board;
`GET /api/users` stays admin-only because it exposes usernames and roles.

**Moving a card off its board.** `PATCH /api/cards/{card_id}/board` takes a
`board_id` and sends the card to the end of that board's first column. It returns
the *source* board, since that is the one still on screen. The card keeps its id,
so its comments and checklist travel with it; an assignee who is not a member of
the destination is cleared, matching `remove_board_member`. The route separates
its refusals: 404 for a board the user cannot open or a card they cannot reach,
409 for a destination with no columns (a board may legitimately have zero), and
422 for the board the card is already on. `move_card_to_board` writes to *both*
boards' histories, worded from each side, and reads the roster through
`BOARD_MEMBER_IDS` on the open connection rather than calling `board_member_ids`,
which would nest a second connection inside the transaction.

**Archiving.** `cards.archived_at` is empty for a card on the board and an ISO
UTC timestamp for one in the archive, so one column is both the flag and the
archive's sort key. `PATCH /api/cards/{id}/archived` toggles it and returns the
reshaped board; `GET /api/boards/{id}/archive` lists what is parked. Archived
cards stay in their column but `_reseat_column` always renumbers them behind the
visible ones, which is the invariant that lets `move_card` and `_rewrite_positions`
stay untouched: a drop index counted among the cards on screen is still the right
absolute position. `_board_data` filters on `archived_at = ''`, so an archived card
is simply absent from every board response — which is why `replace_board` must read
the archive aside before its `DELETE FROM columns` and reinsert it on each column's
tail, or every `PUT`, and so every AI board update, would erase it. A stale client
that still shows a card archived since sends it back as visible; the visible copy
wins rather than colliding on the primary key.

**Dependencies.** `card_links` records "blocker must be done before blocked",
served by `GET/POST /api/cards/{id}/links` and `DELETE /api/links/{id}`, with a
derived `blockerCount` counted in `CARD_FIELDS` like the comment and checklist
totals. `UNIQUE (blocked_id, blocker_id)` only catches the two-card cycle, so
`_blocks_transitively` walks forwards from the blocked card with a recursive CTE
(`UNION`, not `UNION ALL`, so a diamond graph terminates) and the insert is
refused with a 422 if the proposed blocker is already downstream. Both cards must
sit on the same board, and `move_card_to_board` deletes the moved card's links in
both directions rather than leaving one pointing at a card the destination's
readers cannot open. An archived blocker still blocks. This is the one child table
that cannot join `_CARD_CHILDREN` — it hangs off two cards, not one — so
`replace_board` reads the board's links aside separately and reinserts only those
whose *both* ends survived the rewrite.

**Comments.** `GET/POST /api/cards/{id}/comments` and `DELETE /api/comments/{id}`.
Anyone who can open the card's board may read and add; only the author may delete,
and the refusal is a 404 so it does not confirm someone else's comment exists.
Reachability goes through `database._REACHABLE_CARD`, the card-level equivalent of
`ACCESSIBLE_BOARD_IDS`. Threads are ordered by `rowid`, not `created_at`: that is
second-resolution and ids are random uuids, so same-second comments sorted at
random. A comment survives its author losing board access — the thread is a record
of the conversation — but `ON DELETE CASCADE` removes it with the card or the
account.

**Checklists.** `GET/POST /api/cards/{id}/checklist` and `PATCH/DELETE
/api/checklist/{id}`, reachable through `_REACHABLE_CARD` like comments. Unlike
comments, anyone who can open the board may tick and delete an item, and the
table records no author: a checklist is the card's content, not one person's
speech. There is no `position` column — items are append-only, so `rowid` is
their order and they skip the `UNIQUE (parent, position)` rewrite that columns
and cards need. `CardChecklist.tsx` owns its own requests and reports absolute
`(done, total)` counts up, not a `+1`/`-1` delta like `CardComments`, because
ticking moves one of the two numbers and the component already holds the list.
Checklist changes are deliberately not recorded in the activity log: ticking is
the most frequent action in the app and would crowd out everything else.

**Assignments.** `GET /api/assignments` lists every card assigned to the
signed-in user across all the boards they can open, carrying the board id/name
and column title so each row can be placed. It needs no table of its own: the
query joins `cards` to `columns` to `boards` and scopes through
`ACCESSIBLE_BOARD_IDS`, so a revoked share drops its cards from the list for
free. Ordered by `cards.due_date = ''` before `cards.due_date`, because an
empty date sorts first as text and would otherwise outrank an overdue card.
`MyWorkDialog.tsx` fetches on open rather than holding the list in
`KanbanBoard` state, and selecting a row opens that card's board first.

**Activity.** `board_activity` records one rendered summary per board change,
read back by `GET /api/boards/{id}/activity` (scoped like any board read, so a
non-member gets a 404) and rendered by `ActivityDialog.tsx` behind a `History`
icon in the header. `database._record` runs inside each mutation's own
connection, so an entry cannot outlive a write that failed; `rename_column` and
`update_card` therefore select the row's current title before overwriting it,
since the summary names what it replaced. `add_board_member`,
`remove_board_member`, and `replace_board` take an explicit `actor_id` rather
than attributing the change to `boards.user_id`, which is only the owner.
`user_id` is nullable with `ON DELETE SET NULL` and the read `COALESCE`s to
"A deleted account", so the history survives its author. Ordered by `rowid
DESC` for the same reason comments use `rowid`, and capped at `ACTIVITY_LIMIT`.

**Frontend state.** `KanbanBoard.tsx` owns all board state; there is no store or
context. Its `openBoard` helper loads the board list and opens one by id, falling
back to the first, and every mutation runs through a `runMutation` helper that
serializes writes behind an `isBoardBusy` flag and surfaces failures inline.
`BoardSwitcher.tsx` is the select plus create/rename/share/delete controls, hiding
the owner-only ones on a shared board and suffixing its name with "(shared)".
`ShareDialog.tsx` manages that board's roster; its submit is labelled "Add member"
because "Share board" already names the switcher's button, and two controls with
one accessible name make `getByRole` ambiguous in both test runners.
`CardDialog.tsx` edits one card's fields. It is a `div` wrapping two sibling forms,
not one form, because `CardComments.tsx` needs its own submit and nesting forms is
invalid HTML; its header is sticky so the close button survives the thread making
the dialog scroll. Its "Move to board" picker sits *outside* that form and acts on
selection: the move is already persisted, so folding it into "Save card" would
make one button do two unrelated writes. The picker is hidden when the user has
only one board. `CardComments.tsx` owns its own requests and reports a `+1`/`-1`
delta up, so the card's badge stays in step without refetching the board.
`CardDependencies.tsx` loads both directions of a card's links and reports the
blocked-by count up, like the two sections above it; its picker offers only cards
that are neither end of an existing dependency nor the card itself, which is
exactly the set the API would refuse.
`ArchiveDialog.tsx` fetches the archive on open and drops a row locally once its
restore resolves — the board behind it is replaced by the same response, so there
is nothing else to reconcile.
Pure reordering and filtering logic lives
in `moveCard` and `filterBoard` in `frontend/src/lib/kanban.ts` and is unit tested
separately from the component. `filterBoard` narrows cards but keeps every column,
so a match stays readable in its status context; drag is disabled while a filter is
active because `position` is absolute and a filtered drop would persist the index
among the visible cards rather than among all of them.
`frontend/src/lib/api.ts` is the only place that calls `fetch`; it throws `ApiError`
carrying the status and the FastAPI `detail` string.

**AI.** `backend/ai.py` talks to OpenRouter through the OpenAI SDK with
`base_url=https://openrouter.ai/api/v1` and model `openai/gpt-oss-120b` (paid calls).
`OPENROUTER_API_KEY` comes from the environment via `.env`, which the start scripts
pass to the container. `chat_with_openrouter` embeds the current board JSON in the
system prompt, requests `response_format: json_object`, caps the outgoing history at
`MAX_HISTORY_MESSAGES` turns, and caps the reply at `MAX_COMPLETION_TOKENS`.

`POST /api/ai/chat` is authoritative over the board: it takes a `board_id` and the
conversation, reads that board from SQLite itself, validates the reply against `AiResponse`
(`message` plus optional `board_update`), then runs any `board_update` through the
shared `board_update_error` check and persists it before returning the saved board.
It returns 503 when the key is missing and 502 on a failed, invalid, or
structurally-invalid response. `AiSidebar.tsx` therefore just renders the returned
board; it never issues a `PUT`. `board_update_error` is shared with
`PUT /api/boards/{id}`, so both paths enforce the same referential-integrity and
fixed-column-set rules.

## Testing

Per `docs/PLAN.md`: add focused tests for new behavior and user-facing flows, test
success and relevant failure cases for API contract changes, and update the tests for
a flow in the same change set. Coverage is informative, not a gate. There is no CI
workflow, so do not describe tests as CI-enforced.

Backend tests use `TestClient` against a real temporary SQLite file. `tests/conftest.py`
provides the `app` and `client` fixtures (take `app` when a test needs two independent
sessions) and an autouse fixture that drops `security.ITERATIONS` to 1,000, since
production PBKDF2 settings make the suite roughly five times slower. Route tests patch
`main.ask_openrouter` / `main.chat_with_openrouter`; `tests/test_ai.py` patches
`ai.OpenAI` to assert the outgoing request shape. Frontend unit tests mock `fetch`.

Playwright specs that create accounts must delete them in `afterEach` (see
`tests/accounts.spec.ts`), because e2e runs share the persistent `pm-data` volume.
Spec files also run in parallel against that one instance, so a test that selects
an account by display name must use a unique one: a shared name lets
`selectOption` pick a parallel spec's account, which its cleanup then deletes
mid-request.

A spec that *reshapes* a board must sign up its own account and work on that
board's fresh seed rather than snapshotting the demo board and restoring it with
a `PUT`. Two workers that snapshot the one shared board before either restores it
lose the first writer, which permanently drifts the seed: renamed columns and
redistributed cards survive the run and then break any test that reads the layout
by position, such as the coordinate-driven drag in `tests/kanban.spec.ts`.

Three selectors are ambiguous in the browser and need naming around: `getByRole
("status")` also matches dnd-kit's live region, `getByRole("alert")` also matches
Next's route announcer (assert the message text instead), and `getByLabel("Board")`
substring-matches every "... board" button, so it needs `{ exact: true }`.

A card's `<article>` is itself a dnd-kit `role="button"` whose accessible name
is built from its contents, so it also matches `getByRole("button", { name:
"Edit <title>" })`. Pass `{ exact: true }` or scope to the card.

Inside the card dialog, a display name appears both as an Assignee `<option>` and
as a comment author, so assertions about an author must be scoped to the thread:
`within(dialog).getByRole("region", { name: "Comments" })`.
