# Project Plan

## Global Test Policy

The project must include a layered testing strategy covering unit, integration, and end-to-end flows. The goal is to prevent regressions in authentication, board data persistence, drag-and-drop behavior, and AI-driven updates.

### Required coverage and quality gates

- Unit tests are required for all backend business logic and all frontend stateful components.
- Minimum target coverage is 80% line coverage across the backend and frontend critical code paths.
- Coverage is enforced in CI and must be reported for the project before merge.
- Regression tests are required for all user-facing flows in the Kanban app: login, board load, column rename, card create/edit/delete, drag-and-drop, and AI chat actions.
- Every API contract change must include tests covering both success and failure cases.

### Test layers

- Unit tests
  - Backend: FastAPI route logic, auth/session checks, SQLite persistence logic, AI response parsing.
  - Frontend: component rendering, API call wiring, state transitions, auth redirects, sidebar behavior.
  - Use pytest for backend and Vitest for frontend.
- Integration tests
  - Validate FastAPI + SQLite interactions with real HTTP requests against an in-memory or temporary database.
  - Cover login/logout, board fetch/update routes, card create/move/delete flows, and AI chat endpoint contract validation.
- End-to-end tests
  - Use Playwright to validate real browser flows: unauthenticated redirect, login success/failure, board rendering, drag-and-drop, add/edit/delete card, and AI sidebar interaction.
  - E2E tests must confirm changes persist after reload.

### Definition of done for testing

- All unit, integration, and e2e tests pass before the feature is considered complete.
- When a user-visible flow is added or changed, the associated coverage must be updated in the same change set.
- No new feature should ship without at least one test covering the behavior.
- A feature is not considered complete until the relevant browser and API tests pass under the project’s standard test command.

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
- `http://localhost:8000/` shows the full Kanban board (5 columns, demo cards)
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

- [ ] Draft `docs/DATABASE.md` with:
  - [ ] Entity descriptions: users, boards, columns, cards
  - [ ] Full SQL schema (CREATE TABLE statements)
  - [ ] Notes on relationships and constraints
  - [ ] JSON representation matching the existing frontend `BoardData` type
- [ ] Present `docs/DATABASE.md` to the user for review
- [ ] Incorporate any feedback and get explicit user sign-off

### Success criteria

- `docs/DATABASE.md` exists and covers all entities
- User has reviewed and approved the schema
- No code changes yet

---

## Part 6: Backend API

Implement all CRUD routes for boards, columns, and cards. Database is created automatically on first run.

### Steps

- [ ] Add SQLite setup to FastAPI startup
  - [ ] On startup, create the database file (path from env var, default `data/kanban.db`) and run `CREATE TABLE IF NOT EXISTS` migrations
  - [ ] Seed the hardcoded `user` account if it does not exist
- [ ] Implement API routes
  - [ ] `GET /api/board` — return the authenticated user's board (columns + cards) as JSON
  - [ ] `PUT /api/board` — replace the entire board state for the authenticated user
  - [ ] `PATCH /api/columns/{column_id}` — rename a column
  - [ ] `POST /api/cards` — create a card in a given column
  - [ ] `PATCH /api/cards/{card_id}` — update card title/details
  - [ ] `DELETE /api/cards/{card_id}` — delete a card
  - [ ] `PATCH /api/cards/{card_id}/move` — move card to a different column / position
- [ ] Write backend unit tests for every route (success + error cases)
- [ ] Mount a persistent Docker volume for `data/` so the database survives container restarts

### Success criteria

- All API routes return correct responses and status codes
- Database file is created automatically if absent
- Board state persists across container restarts (volume mounted)
- All backend unit tests pass

---

## Part 7: Frontend + Backend integration

Replace the in-memory Kanban state with live API calls. The board should persist across page reloads.

### Steps

- [ ] Create `src/lib/api.ts` — typed fetch wrappers for all backend routes
- [ ] Update `KanbanBoard.tsx`
  - [ ] On mount, `GET /api/board` to load initial state (replace `initialData`)
  - [ ] On every board mutation (drag, rename, add, delete), call the appropriate API endpoint
  - [ ] Show a loading state while the initial fetch is in flight
  - [ ] Show a toast / inline error if an API call fails
- [ ] Remove `initialData` as the default state source (it can remain as a fallback seed for the backend only)
- [ ] Tests
  - [ ] Unit tests: mock fetch, test that each user action triggers the correct API call
  - [ ] Playwright e2e: add a card, reload the page, confirm the card is still there; move a card, reload, confirm new position

### Success criteria

- Board state loads from the backend on page load
- All mutations (drag, rename, add, delete) are persisted immediately
- Refreshing the browser shows the same board state
- All unit and e2e tests pass

---

## Part 8: AI connectivity

Wire up the backend to OpenRouter and verify a live AI call works.

### Steps

- [ ] Add `openai` or `httpx` client to backend dependencies
- [ ] Read `OPENROUTER_API_KEY` from environment (already in `.env`)
- [ ] Create `backend/ai.py` — a thin wrapper around the OpenRouter API using model `openai/gpt-oss-120b:free`
- [ ] Add `POST /api/ai/ping` test endpoint — sends the message `"What is 2+2?"` to the AI and returns the raw response
- [ ] Write a backend test that calls `/api/ai/ping` and asserts a non-empty response is returned
- [ ] Pass `OPENROUTER_API_KEY` into the Docker container via the start scripts (read from `.env`)

### Success criteria

- `POST /api/ai/ping` returns a non-empty response from the AI
- The response contains the correct answer (`4`) or equivalent
- The API key is not hardcoded anywhere in source

---

## Part 9: Structured AI output for Kanban updates

Extend the AI endpoint so it accepts user messages + conversation history, receives the full board as context, and returns a structured response that may include a board update.

### Steps

- [ ] Define a Pydantic response schema:
  ```python
  class AiResponse(BaseModel):
      message: str
      board_update: BoardData | None = None
  ```
- [ ] Update `backend/ai.py`
  - [ ] System prompt includes the current board JSON
  - [ ] User turn includes conversation history + new message
  - [ ] Use OpenRouter structured outputs / function calling to enforce `AiResponse` shape
- [ ] Add `POST /api/ai/chat` endpoint
  - [ ] Request body: `{ messages: [{role, content}], board: BoardData }`
  - [ ] Response: `AiResponse`
- [ ] Write backend tests
  - [ ] Mock the OpenRouter call; assert the endpoint correctly parses and returns `AiResponse`
  - [ ] Test a case with `board_update: null` and one with a non-null `board_update`

### Success criteria

- `POST /api/ai/chat` returns `{ message, board_update }` on every call
- `board_update` is `null` for general questions and a valid `BoardData` object when the AI decides to update the board
- All backend tests pass

---

## Part 10: AI chat sidebar UI

Add a sidebar to the frontend for full AI chat. If the AI returns a `board_update`, the board refreshes automatically.

### Steps

- [ ] Create `src/components/AiSidebar.tsx`
  - [ ] Toggle open/closed via a button in the board header
  - [ ] Displays conversation history (user messages + AI messages)
  - [ ] Text input + submit button to send a new message
  - [ ] On submit: call `POST /api/ai/chat` with current conversation + board state
  - [ ] Append AI response to conversation history
  - [ ] If `board_update` is present, call `PUT /api/board` then refresh board state in `KanbanBoard`
  - [ ] Show a loading indicator while the AI call is in flight
- [ ] Lift board state or use a shared context so `KanbanBoard` and `AiSidebar` can share the current board and update it
- [ ] Style the sidebar using the existing color palette; it should slide in from the right without obscuring the board
- [ ] Tests
  - [ ] Unit test: mock `POST /api/ai/chat`; assert message appears in history; assert board updates when `board_update` is returned
  - [ ] Playwright e2e: open sidebar, send "Move all cards to Done", confirm board updates in the UI

### Success criteria

- Sidebar opens and closes cleanly
- Sending a message shows the AI reply in the conversation history
- A board-modifying instruction (e.g. "Add a card called X to Backlog") updates the board without a manual refresh
- All unit and e2e tests pass
