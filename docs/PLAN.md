# Project Plan

## Global Test Policy

Tests should protect implemented behavior and catch regressions without adding unnecessary cases just to reach a coverage percentage.

### Test expectations

- Add focused tests for new or changed business logic, stateful UI behavior, and user-facing flows.
- API contract changes should test successful behavior and relevant failure cases.
- Use unit tests for isolated logic and components, integration tests for interactions between the API and persistence layer, and Playwright for important browser flows. Add each layer as the corresponding feature is implemented.
- Coverage reports are informative, not a pass/fail target. There is no minimum coverage percentage or CI coverage gate.
- There is currently no CI workflow configured; do not describe tests or coverage as CI-enforced until one is added.

### Running the current tests

- Backend: run `uv run pytest` from `backend/`.
- Frontend unit tests: run `npm run test:unit` from `frontend/`.
- Frontend e2e tests: start the app with `scripts/start.sh` (macOS/Linux) or `scripts/start.bat` (Windows), then run `npm run test:e2e` from `frontend/`. Playwright defaults to `http://127.0.0.1:8000`; `PLAYWRIGHT_BASE_URL` can override it.
- `npm run test:all` runs frontend unit and e2e tests, so the app must already be running.

### Definition of done for testing

- Run and pass the tests relevant to the feature before considering it complete.
- When a user-visible flow changes, update its relevant tests in the same change set.
- No new feature should ship without at least one focused test of its behavior.

## Part 1: Plan (complete)

- [x] Create root AGENTS.md with business requirements, tech decisions, color scheme, coding standards
- [x] Create docs/PLAN.md with high-level parts
- [x] Create frontend/AGENTS.md describing existing frontend code
- [x] Expand PLAN.md with detailed checklists and success criteria
- [x] User reviews and approves plan

---

## Part 2: Scaffolding

Set up Docker infrastructure, FastAPI backend serving static HTML, and start/stop scripts. Goal: confirm the container runs and a "hello world" page + API endpoint are both reachable.

### Steps

- [x] Create `backend/` Python project structure using `uv`
  - [x] `backend/pyproject.toml` — FastAPI + uvicorn dependencies
  - [x] `backend/main.py` — FastAPI app with:
    - `GET /api/health` returning `{"status": "ok"}`
    - Static file mount serving `backend/static/` at `/`
  - [x] `backend/static/index.html` — minimal hello world page that calls `/api/health` and displays the result
- [x] Create `Dockerfile`
  - [x] Base image: `python:3.12-slim`
  - [x] Install `uv`, use it to install dependencies
  - [x] Copy backend source
  - [x] Expose port 8000; CMD runs `uvicorn`
- [x] Create `scripts/start.sh` (Mac/Linux) — builds image if needed, runs container on port 8000
- [x] Create `scripts/stop.sh` (Mac/Linux) — stops and removes container
- [x] Create `scripts/start.bat` (Windows) — equivalent of start.sh
- [x] Create `scripts/stop.bat` (Windows) — equivalent of stop.sh

### Success criteria

- `./scripts/start.sh` builds and starts the container with no errors
- `http://localhost:8000/` shows the hello world HTML page
- The page calls `/api/health` and displays `{"status": "ok"}` in the DOM
- `./scripts/stop.sh` stops the container cleanly

---

## Part 3: Add in Frontend

Build the Next.js frontend as a static export and have FastAPI serve it. The full Kanban demo should be visible at `/`.

### Steps

- [x] Configure Next.js for static export
  - [x] Set `output: "export"` in `next.config.ts`
  - [x] Verify `npm run build` produces an `out/` directory
- [x] Update Dockerfile
  - [x] Add a Node build stage: install deps, run `next build`, output to `out/`
  - [x] Copy `out/` into the Python stage as `backend/static/`
  - [x] Remove the hello world `index.html` (now replaced by Next.js output)
- [x] Verify FastAPI static mount serves exported pages and falls back to `index.html` for client-side routes
- [x] Write / update tests
  - [x] Unit tests: all existing Vitest tests pass (`npm run test:unit` inside `frontend/`)
  - [x] Playwright e2e: board renders with 5 columns; drag a card; rename a column; add and delete a card
- [x] Update `scripts/start.sh` / `start.bat` to rebuild the image (Next.js output is baked in at build time)

### Success criteria

- `./scripts/start.sh` rebuilds and starts the container
- After signing in, `http://localhost:8000/` shows the full Kanban board (5 columns, demo cards)
- Drag-and-drop, rename, add, and delete card all work in the browser
- All unit and e2e tests pass

---

## Part 4: Add fake user sign-in

Gate the Kanban behind a login page. Credentials are hardcoded as `user` / `password`. User can log out.

### Steps

- [x] Backend: add session cookie auth
  - [x] `POST /api/auth/login` — accepts `{ username, password }`, sets a signed session cookie on success, returns `401` on failure
  - [x] `POST /api/auth/logout` — clears the session cookie
  - [x] `GET /api/auth/me` — returns `{ username }` if authenticated, `401` otherwise
  - [x] Protect API routes with a dependency that checks the session cookie
- [x] Frontend: add login page
  - [x] Create `src/app/login/page.tsx` — form with username + password fields, submit calls `POST /api/auth/login`, redirects to `/` on success, shows error on failure
  - [x] Add auth guard: on app load, call `GET /api/auth/me`; redirect to `/login` if unauthenticated
  - [x] Add logout button in the board header; calls `POST /api/auth/logout`, redirects to `/login`
- [x] Tests
  - [x] Backend unit tests: login success, login failure, logout, unauthenticated request blocked
  - [x] Playwright e2e: unauthenticated visit to `/` redirects to `/login`; login with wrong creds shows error; login with correct creds shows board; logout returns to `/login`

### Success criteria

- Visiting `/` without a session redirects to `/login`
- `user` / `password` logs in and shows the Kanban board
- Wrong credentials show an error message, no redirect
- Logout clears the session and returns to `/login`
- All backend and e2e tests pass

---

## Part 5: Database modeling

Design the SQLite schema for the Kanban, document it, and get user approval before building anything.

### Steps

- [x] Draft `docs/DATABASE.md` with:
  - [x] Entity descriptions: users, boards, columns, cards
  - [x] Full SQL schema (CREATE TABLE statements)
  - [x] Notes on relationships and constraints
  - [x] JSON representation matching the existing frontend `BoardData` type
- [x] Present `docs/DATABASE.md` to the user for review
- [x] Incorporate any feedback and get explicit user sign-off

### Success criteria

- [x] `docs/DATABASE.md` exists and covers all entities
- [x] User has reviewed and approved the schema
- [x] No code changes yet at schema approval

---

## Part 6: Backend API

Implement all CRUD routes for boards, columns, and cards. Database is created automatically on first run.

### Steps

- [x] Add SQLite setup to FastAPI startup
  - [x] On startup, create the database file (path from env var, default `data/kanban.db`) and run `CREATE TABLE IF NOT EXISTS` migrations
  - [x] Seed the hardcoded `user` account, its board, and the five columns/eight cards from the frontend seed if they do not exist
- [x] Implement API routes
  - [x] `GET /api/board` — return the authenticated user's board (columns + cards) as JSON
  - [x] `PUT /api/board` — replace the entire board state for the authenticated user
  - [x] `PATCH /api/columns/{column_id}` — rename a column
  - [x] `POST /api/cards` — create a card in a given column
  - [x] `PATCH /api/cards/{card_id}` — update card title/details
  - [x] `DELETE /api/cards/{card_id}` — delete a card
  - [x] `PATCH /api/cards/{card_id}/move` — move card to a different column / position
- [x] Write backend unit tests for every route (success + error cases)
- [x] Mount a persistent Docker volume for `data/` so the database survives container restarts

### Success criteria

- [x] All API routes return correct responses and status codes
- [x] Database file is created automatically if absent
- [x] Board state persists across container restarts (volume mounted)
- [x] All backend unit tests pass

---

## Part 7: Frontend + Backend integration

Replace the in-memory Kanban state with live API calls. The board should persist across page reloads.

### Steps

- [x] Create `src/lib/api.ts` — typed fetch wrappers for all backend routes
- [x] Update `KanbanBoard.tsx`
  - [x] On mount, `GET /api/board` to load initial state (replace `initialData`)
  - [x] On every board mutation (drag, rename, add, delete), call the appropriate API endpoint
  - [x] Show a loading state while the initial fetch is in flight
  - [x] Show a toast / inline error if an API call fails
- [x] Remove `initialData` as the default state source (it can remain as a fallback seed for the backend only)
- [x] Tests
  - [x] Unit tests: mock fetch, test API calls and component mutation behavior
  - [x] Playwright e2e: add a card, reload the page, confirm the card is still there; move a card, reload, confirm new position

### Success criteria

- [x] Board state loads from the backend on page load
- [x] All mutations (drag, rename, add, delete) are persisted immediately
- [x] Refreshing the browser shows the same board state
- [x] All unit and e2e tests pass

---

## Part 8: AI connectivity

Wire up the backend to OpenRouter and verify a live AI call works.

### Steps

- [x] Add `openai` or `httpx` client to backend dependencies
- [x] Read `OPENROUTER_API_KEY` from environment (already in `.env`)
- [x] Create `backend/ai.py` — a thin wrapper around OpenRouter using model `openai/gpt-oss-120b`
- [x] Add `POST /api/ai/ping` test endpoint — sends the message `"What is 2+2?"` to the AI and returns the raw response
- [x] Write a backend test that calls `/api/ai/ping` and asserts a non-empty response is returned
- [x] Pass `OPENROUTER_API_KEY` into the Docker container via the start scripts (read from `.env`)

### Success criteria

- [x] `POST /api/ai/ping` returns a non-empty response from the AI
- [x] The response contains the correct answer (`4`) or equivalent
- [x] The API key is not hardcoded anywhere in source

---

## Part 9: Structured AI output for Kanban updates

Extend the AI endpoint so it accepts user messages + conversation history, receives the full board as context, and returns a structured response that may include a board update.

### Steps

- [x] Define a Pydantic response schema:
  ```python
  class AiResponse(BaseModel):
      message: str
      board_update: BoardData | None = None
  ```
- [x] Update `backend/ai.py`
  - [x] System prompt includes the current board JSON
  - [x] User turn includes conversation history + new message
  - [x] Use JSON mode and Pydantic validation to enforce `AiResponse` shape
- [x] Add `POST /api/ai/chat` endpoint
  - [x] Request body: `{ messages: [{role, content}], board: BoardData }`
  - [x] Response: `AiResponse`
- [x] Write backend tests
  - [x] Mock the OpenRouter call; assert the endpoint correctly parses and returns `AiResponse`
  - [x] Test a case with `board_update: null` and one with a non-null `board_update`

### Success criteria

- [x] `POST /api/ai/chat` returns `{ message, board_update }` on every call
- [x] `board_update` is `null` for general questions and a valid `BoardData` object when the AI decides to update the board
- [x] All backend tests pass

---

## Part 10: AI chat sidebar UI

Add a sidebar to the frontend for full AI chat. If the AI returns a `board_update`, the board refreshes automatically.

### Steps

- [x] Create `src/components/AiSidebar.tsx`
  - [x] Toggle open/closed via a button in the board header
  - [x] Displays conversation history (user messages + AI messages)
  - [x] Text input + submit button to send a new message
  - [x] On submit: call `POST /api/ai/chat` with current conversation + board state
  - [x] Append AI response to conversation history
  - [x] If `board_update` is present, call `PUT /api/board` then refresh board state in `KanbanBoard`
  - [x] Show a loading indicator while the AI call is in flight
- [x] Lift board state or use a shared context so `KanbanBoard` and `AiSidebar` can share the current board and update it
- [x] Style the sidebar using the existing color palette; it should slide in from the right without obscuring the board
- [x] Tests
  - [x] Unit test: mock `POST /api/ai/chat`; assert message appears in history; assert board updates when `board_update` is returned
  - [x] Playwright e2e: open sidebar, send "Move all cards to Done", confirm board updates in the UI

### Success criteria

- [x] Sidebar opens and closes cleanly
- [x] Sending a message shows the AI reply in the conversation history
- [x] A board-modifying instruction (e.g. "Add a card called X to Backlog") updates the board without a manual refresh
- [x] All unit and e2e tests pass

## Part 12
Code review follow-ups (see `docs/CODE_REVIEW.md`, 2026-11-17):
- [x] Pin `SESSION_SECRET` in `.env` so container restarts don't silently sign out the demo user
- [x] Cap AI chat history / set `max_tokens` in `backend/ai.py` so a long sidebar conversation can't grow cost and latency unbounded
- [ ] Set `https_only` on the session cookie in `backend/main.py` before any HTTPS deployment (deferred: it would break the current local HTTP deployment)
- [x] Untrack `frontend/test-results/.last-run.json` and add `/test-results/` and `/playwright-report/` to `frontend/.gitignore` so e2e runs stop dirtying the tree
- [x] Have `POST /api/ai/chat` read the board from SQLite instead of trusting the client-supplied `board`. Resolved by also having the endpoint validate and persist the `board_update` itself, which removes the client `PUT` round-trip and the lost-update window with it
- [x] Serve the exported `404.html` page for unknown page routes; `ExportStaticFiles` previously returned 200 with the board shell for e.g. `/nope`

---

# Project management expansion

Parts 13-18 turn the single-board demo into a multi-user project management app.
Work them in order: each part leaves the app runnable with all tests passing.

## Part 13: Icon affordances

Replace word-labelled controls with icons so cards and columns read as a dense board
rather than a form.

### Steps

- [x] Add `lucide-react` and render card/column/header actions as icon buttons
      (delete card, add/confirm/cancel card, AI assistant, log out, close sidebar)
- [x] Keep an `aria-label` on every icon-only control so tests and screen readers
      still address them by name
- [x] Tests already selected controls by accessible name, so preserving the
      `aria-label` text kept them passing unchanged

### Success criteria

- [x] No icon-only control is missing an accessible name, guarded by a unit test
      that compares `getAllByRole("button")` against the subset with a non-empty
      accessible name
- [x] Unit suite passes (15 tests)

---

## Part 14: Real multi-user management

Replace the hardcoded `user` / `password` pair with real accounts in SQLite.

### Steps

- [x] Add a migration mechanism. Uses the built-in `PRAGMA user_version` rather
      than a `schema_version` table: `SCHEMA` stays frozen at the v1 shape and
      `MIGRATIONS` carries every file forward, so fresh and existing databases
      follow one upgrade path
- [x] Extend `users` with `password_hash`, `display_name`, `role`, `created_at`
- [x] Hash passwords with PBKDF2-SHA256 in `backend/security.py` (stdlib only,
      600k iterations; tests patch `security.ITERATIONS` down to keep the suite fast)
- [x] `POST /api/auth/register`, and admin-only `GET/POST/PATCH/DELETE /api/users`
- [x] Session stores `user_id`; `require_user` resolves it from the database and
      clears the cookie when the account no longer exists
- [x] Registering seeds a starter board for the new account
- [x] Frontend: `/signup` page, login/signup cross-links, header shows the
      signed-in display name
- [x] Admin user-management UI at `/admin` (`UserManagement.tsx`): roster table
      with inline role editing, account creation, and deletion. The header links
      there only for admins, and a member who navigates to the URL directly sees
      the API's 403 message instead of a table

### Success criteria

- [x] Two accounts see strictly separate data, covered by an API-level isolation
      test and a two-browser-context Playwright test
- [x] Passwords are never stored or returned in plaintext
- [x] An existing `kanban.db` upgrades without data loss, verified by a unit test
      against a synthetic v0 file and against the real `pm-data` volume
- [x] Guard rails: the last admin cannot be demoted and an admin cannot delete
      their own account, enforced by the API and surfaced in the admin screen
- [x] Backend 66 tests / 96% coverage, frontend 29 unit tests, 15 Playwright tests

---

## Part 15: Multiple boards per user

### Steps

- [x] Drop `UNIQUE` on `boards.user_id`; add `name` and `created_at`
- [x] `GET/POST/PATCH/DELETE /api/boards`; scope every card/column query by board
- [x] Frontend board switcher and board create/rename/delete

`position` was dropped from this part: boards are ordered by `created_at, name, id`
and no board-reordering UI is planned, so the column would carry no behavior.

### Success criteria

- [x] A user can hold several boards and switch between them
- [x] Deleting a board cascades to its columns and cards

---

## Part 16: Column management

### Steps

- [x] `POST /api/columns`, `DELETE /api/columns/{id}`, `PATCH /api/columns/{id}/move`
- [x] Relax the fixed-column-set rule in `board_update_error` accordingly
- [x] Frontend: add, delete, and reorder columns

Reordering uses left/right buttons rather than drag. The existing `DndContext`
already claims column ids as droppable targets for cards, so making columns
sortable in the same context would have meant reworking card drag-and-drop for
no user-visible gain; buttons are also keyboard-accessible by default.

---

## Part 17: Richer cards

### Steps

- [x] Card fields: `priority`, `due_date`, `assignee_id`, `labels`
- [x] Card detail dialog for editing them
- [x] Filter and search the board by text, assignee, and label

`labels` is a JSON array in a `TEXT` column rather than a join table. Labels are
free text owned by a card, never queried across cards in SQL, and the whole card
is read and written at once, so a table would add joins without buying anything.

The assignee picker is fed by `GET /api/members`, a names-only roster any signed-in
user may read. `GET /api/users` stays admin-only: picking an assignee needs display
names, not usernames and roles.

Drag is disabled while a filter is active. `position` is absolute, so dropping a
card into a filtered column would persist the index among the visible cards rather
than among all of them. The filter bar says so rather than failing silently.
Filtering narrows cards only; every column stays on screen so a match is still
readable in its status context.

`POST /api/cards` still takes only a title and details. The dialog patches the rest,
so widening create would duplicate the patch path for no user-visible gain.

---

## Part 18: Hardening

### Steps

- [x] Playwright coverage for every new flow
- [x] Refresh `docs/DATABASE.md`, `AGENTS.md`, and the READMEs

Specs run in parallel against one shared instance, so anything an account exposes
globally has to be unique per test. `cards.spec.ts` picks an assignee by display
name, and a name shared with another spec let `selectOption` choose that spec's
account, which its cleanup then deleted mid-save; the API correctly answered 422,
so the dialog stayed open and the test failed intermittently. Display names used
for selection are now derived from the unique username.

Assert the filter banner by its text, not `getByRole("status")`: dnd-kit mounts
its own live region with that role, so the locator matches two elements.

### Success criteria

- [x] Every flow added in Parts 13-17 has a browser test: icon controls
      (accessible names), accounts and roles, multiple boards, column add /
      reorder / delete, card detail editing, and board filtering
- [x] Backend 119 tests / 98% coverage, frontend 50 unit tests, 23 Playwright
      tests, green on two consecutive full runs

---

## Part 19: Shared boards

Boards are single-owner, but `GET /api/members` lists every account in the
instance, so a card can be assigned to someone who cannot open the board it is
on. Sharing closes that gap and makes the app genuinely multi-user rather than
several private instances side by side.

### Steps

- [x] Migration 4: a `board_members` join table
- [x] Scope board, column, and card queries to boards a user owns *or* is a
      member of; keep rename, delete, and membership owner-only
- [x] `GET/POST/DELETE /api/boards/{id}/members`, replacing the instance-wide
      `GET /api/members`
- [x] Validate card assignees against the board's members
- [x] Frontend: share controls and a shared-board indicator

### Success criteria

- [x] A member can open, edit, and be assigned cards on a shared board
- [x] A non-member still gets a 404, covered by an API isolation test
- [x] Only the owner can rename, delete, or change the membership of a board
- [x] Removing a member unassigns their cards on that board
- [x] Backend 136 tests / 98% coverage, frontend 54 unit tests, 26 Playwright
      tests, all green

### Decisions

The owner stays in `boards.user_id`; `board_members` records only the extra
people. A duplicate owner row would have to be kept in step with the board and
buys nothing, since every read unions the two anyway.

`ACCESSIBLE_BOARD_IDS` is one SQL constant taking the user id twice, reused by
every board, column, and card query. It keeps the existing `board_id IN
(SELECT ...)` rule rather than reintroducing `JOIN boards`.

Removing a member unassigns their cards on that board. Otherwise they stay
assigned to a board they can no longer open and the card renders a blank name.
Deleting the account outright is already handled by `ON DELETE SET NULL`.

`DELETE /api/boards/{id}` checks ownership *before* the last-board rule. A
member owns a board of their own, so the reverse order answered 409 for a
shared board they were never allowed to delete at all. `count_boards` stays
owner-only for the same reason: a shared board must not stop a user from
deleting their own last one.

The share dialog's submit is labelled "Add member", not "Share board", which
is the switcher's button. Two controls with one accessible name make
`getByRole("button", { name })` ambiguous in both vitest and Playwright.
---

## Part 20: Card comments

Sharing made the app multi-user, but a board was still the only place to say
anything, and a board says nothing about *why* a card moved. A comment thread
per card gives the collaboration added in Part 19 somewhere to happen.

### Steps

- [x] Migration 5: a `card_comments` table
- [x] `GET/POST /api/cards/{id}/comments` and `DELETE /api/comments/{id}`
- [x] `commentCount` on the card payload, derived rather than stored
- [x] Frontend: a thread in the card dialog and a count badge on the card

### Success criteria

- [x] Anyone who can open a board can read and add comments on its cards
- [x] A comment can only be deleted by its author, the board owner included
- [x] Deleting a card, or an account, takes the matching comments with it
- [x] A board rewrite (`PUT`, or an AI board update) keeps the threads
- [x] Backend 152 tests / 98% coverage, frontend 57 unit tests, 28 Playwright
      tests, green on two consecutive full runs

### Decisions

`commentCount` is derived in `CARD_FIELDS` with a correlated subquery, not
stored on the card. A stored counter is a second source of truth that drifts
the moment a comment is deleted or a card cascades away. It is read-only: the
Pydantic model defaults it to 0 so an incoming board update may omit it, and
`replace_board` never writes it back.

`replace_board` holds the board's comments aside and reinserts them. It rebuilds
a board by dropping its columns, so cards cascade away and comments with them.
Without this, every `PUT /api/boards/{id}` -- and so every AI board update --
silently erased the whole board's comment history. Comments on a card the
rewrite drops are not restored, matching the plain card-delete cascade.

Threads are ordered by `rowid`, not `created_at`. `_now()` is only
second-resolution and ids are random uuids, so two comments posted in the same
second sorted at random. The e2e and unit tests caught this immediately.

A comment survives its author losing board access. Removing a member unassigns
their cards (Part 19) but leaves what they said, because the thread is a record
of the conversation rather than a list of current members. Deleting the account
outright does remove them, via `ON DELETE CASCADE`.

Only the author may delete a comment, and the refusal is a 404 rather than a
403, so it does not confirm that someone else's comment exists.

`CardDialog` is a `div` wrapping two sibling forms, not one form. The thread
needs its own submit, and nesting a form inside another is invalid HTML. Its
header is sticky because the thread makes the dialog scroll and the close
button has to stay reachable.
