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

## Future extension
## Part 11
- make the login multi-user

## Part 12
- code review agent to clean up the tree

## Part 13
- change db to use supabase

## Part 14
- deploy on vercel