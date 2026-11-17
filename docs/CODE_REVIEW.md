# Code Review

Date: 2026-11-17
Scope: full repository at commit `f2b7938` (Parts 1-10 of `docs/PLAN.md`).

## Test results

All suites pass; no fixes were required to get here.

| Suite | Command | Result |
|---|---|---|
| Backend (pytest) | `uv run pytest` (from `backend/`) | 36 passed, 96% coverage (`main.py` 94%, `database.py` 99%) |
| Frontend unit (vitest) | `npm run test:unit` (from `frontend/`) | 14 passed |
| Frontend lint (eslint) | `npm run lint` | clean |
| Frontend build (next build) | `npm run build` | succeeds, static export generates `/`, `/login`, `/_not-found` |
| Frontend e2e (Playwright) | `npx playwright test` against the running `pm-app` container | 9 passed (login redirect, bad credentials, login/logout, board load, AI sidebar move + persistence, add/rename/delete/move card) |

Coverage gaps in `main.py`/`database.py` are exception branches (OpenRouter failure paths, 404s, `StaticFiles` 404 fallthroughs). Per `docs/PLAN.md`'s test policy these are not coverage-gated and are reasonable to leave untested at MVP scope.

## Findings

No correctness bugs were found. The items below are worth tracking but none block the current scope.

### 1. Session secret is not pinned, so every restart invalidates all sessions
`backend/main.py:39`:
```python
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_urlsafe(32)
```
`.env` does not set `SESSION_SECRET`, and `scripts/start.sh` always rebuilds and recreates the container. Each restart generates a fresh secret, silently signing out the single demo user. Harmless today (one hardcoded user, expected to re-login), but worth a one-line note in `AGENTS.md`/`CLAUDE.md` so it isn't mistaken for a bug later, or fixed by setting `SESSION_SECRET` in `.env` once persistent sessions matter.

### 2. AI chat has no history cap or `max_tokens`
`backend/ai.py`'s `chat_with_openrouter` sends the full `messages` list and current board on every turn with no truncation, and the completion call sets no `max_tokens`. `AiSidebar.tsx` already warns "AI requests may incur charges" — for a long chat session, cost and latency grow unbounded. Worth a cap if the sidebar sees real usage.

### 3. Session cookie has no `https_only`
`SessionMiddleware` is configured with `same_site="lax"` but no `https_only`, which is correct for the current local-HTTP Docker deployment. Flag this for Part 14 (Vercel deploy), where it should be set.

## What held up well

- SQL is fully parameterized; no injection surface in `database.py`.
- `write_board` rejects any change to column identity/order and validates card/column referential integrity before writing (`main.py:231-254`), closing off a class of corrupt-board bugs from a misbehaving AI response.
- `_rewrite_positions` (`database.py:367-385`) avoids the `UNIQUE (column_id, position)` collision correctly by shifting existing rows past the current max before writing final positions — verified against both the same-column reorder and cross-column move paths in `move_card`.
- `replace_board` runs its delete-then-reinsert inside the single transaction opened by `_connection`, so a partial board write cannot be persisted.
- Auth boundary is consistent: every board/card route resolves through `require_database_user`, and every query joins through `boards.user_id`, so there's no route that can read or mutate another user's data (moot today with one user, but the pattern is already correct for Part 11's multi-user extension).
- Frontend only touches the network through `src/lib/api.ts`, and `KanbanBoard.tsx` serializes all mutations behind a single `isBoardBusy` flag, so there's no visible path to overlapping writes or lost updates from double-submission.
