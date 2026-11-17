# Code Review

Latest pass: 2026-11-17 at commit `8f680fd` (Parts 1-10 of `docs/PLAN.md`).
First pass: 2026-11-17 at commit `f2b7938`.

## Test results

All suites pass. No fixes were required to get here, and no test was changed to make it pass.

| Suite | Command | Result |
|---|---|---|
| Backend (pytest) | `uv run pytest` (from `backend/`) | 36 passed, 96% coverage (`main.py` 94%, `database.py` 99%) |
| Frontend unit (vitest) | `npm run test:unit` (from `frontend/`) | 14 passed |
| Frontend lint (eslint) | `npm run lint` | clean |
| Frontend e2e (Playwright) | `npx playwright test` against a freshly built `pm-app` container | 9 passed |

The container was rebuilt and started with `./scripts/start.sh` for the e2e run, then stopped
with `./scripts/stop.sh`. The `pm-data` volume persists across both.

Coverage gaps in `main.py`/`database.py` are exception branches (OpenRouter failure paths, 404s,
`StaticFiles` 404 fallthroughs). Per `docs/PLAN.md`'s test policy these are not coverage-gated and
are reasonable to leave untested at MVP scope.

### Manual API probes

Run against the live container, with the board snapshotted before and restored after (verified
byte-identical afterwards):

| Probe | Expected | Actual |
|---|---|---|
| `GET /api/board` unauthenticated | 401 | 401 |
| `PUT /api/board` with one card id in two columns | 422 | 422 |
| `PUT /api/board` with two columns swapped | 422 | 422 |
| `PATCH /api/cards/{unknown}` | 404 | 404 |
| `PATCH /api/cards/{id}/move` with `position: 9999` | clamped, 200 | 200 |
| `GET /x.js` (missing asset) | 404 | 404 |
| `GET /api/bogus` | 404 | 404 |
| `GET /nope` (unknown page route) | 404 | 200 at review time; 404 after the finding 6 fix |

## Findings

No correctness bugs were found in either pass. Findings 1-3 are carried over from the first pass;
findings 4-7 are new in this pass.

All findings except 3 were fixed on 2026-11-17; the headings below record the outcome. Finding 3 is
deliberately deferred because `https_only` would break the current local HTTP deployment.

### 1. Session secret is not pinned, so every restart invalidates all sessions (resolved)
Resolved: `SESSION_SECRET` is now set in `.env`, which the start scripts pass to the container.
`backend/main.py:39`:
```python
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_urlsafe(32)
```
`.env` sets only `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, and `OPENROUTER_API_KEY` — no
`SESSION_SECRET` — and `scripts/start.sh` always rebuilds and recreates the container. Each restart
generates a fresh secret, silently signing out the single demo user. Harmless today, but worth
setting `SESSION_SECRET` in `.env` once persistent sessions matter.

### 2. AI chat has no history cap or `max_tokens` (resolved)
Resolved: `backend/ai.py` now trims the outgoing conversation to the last `MAX_HISTORY_MESSAGES`
(20) turns and sends `max_tokens=MAX_COMPLETION_TOKENS` (4096, enough to echo back a full board).
`chat_with_openrouter` in `backend/ai.py` sends the full `messages` list and the whole board on
every turn with no truncation, and the completion call sets no `max_tokens`. `AiSidebar.tsx` keeps
the conversation in a single unbounded `messages` array. `AiSidebar.tsx` already warns "AI requests
may incur charges" — for a long chat session, cost and latency grow unbounded.

### 3. Session cookie has no `https_only` (open, deferred)
`SessionMiddleware` is configured with `same_site="lax"` but no `https_only`, which is correct for
the current local-HTTP Docker deployment. It must be set before any HTTPS deployment.

### 4. A Playwright artifact is committed to the repository (resolved)
Resolved: `/test-results` and `/playwright-report` are in `frontend/.gitignore` and the tracked
`.last-run.json` was removed from the index.
`frontend/test-results/.last-run.json` is tracked in git. Neither `.gitignore` nor
`frontend/.gitignore` covers `test-results/` or `playwright-report/`, and
`playwright.config.ts` sets `trace: "retain-on-failure"`, so a failing run also drops trace
archives into `test-results/`. Every e2e run rewrites the tracked file, producing spurious diffs,
and a failing run risks committing binary traces. Fix: add `/test-results/` and
`/playwright-report/` to `frontend/.gitignore` and `git rm --cached` the tracked file.

### 5. `POST /api/ai/chat` trusts the client-supplied board (resolved)
Resolved: the request body is now just `messages`. The endpoint reads the board from SQLite,
validates any `board_update` through the shared `board_update_error`, persists it, and returns the
saved board. The client `PUT` round-trip — and with it the lost-update window — is gone. The WAL
note below is unaddressed and still worth considering if concurrency grows.
`ai_chat` passes `payload.board` straight into the system prompt instead of reading the
authoritative board for that user from SQLite, and the returned `board_update` is then written back
wholesale through `PUT /api/board`. There is no optimistic concurrency check, so the write is
last-writer-wins against whatever the client last saw. This is moot with one user and one tab, but
it becomes a real lost-update path under Part 11 (multi-user) or with two tabs open. The same note
applies to SQLite's default rollback-journal mode, where writers block readers; WAL would be worth
considering at the same time.

### 6. Unknown page routes return 200 with the board shell instead of 404 (resolved)
Resolved: `ExportStaticFiles` no longer falls back to `index.html`. It now serves the exported
`404.html` with a 404 status. Verified live: `/nope` returns 404, `/` and `/login` still 200.
Verified live: `GET /nope` returns 200 and the exported `index.html`. `ExportStaticFiles` falls back
to `index.html` for any suffixless path that is not under `api/`, so a mistyped URL renders the
authenticated board shell rather than the `_not-found` page Next.js already exports. Paths with a
file suffix and `api/` paths correctly 404. Low impact, but the exported 404 page is going unused.

### 7. Stale cross-references between `PLAN.md` and this document (resolved)
`docs/PLAN.md` has been edited to remove the old Parts 12-14 (code review agent, Supabase, Vercel)
and renumber the code review follow-ups to Part 12, but the `https_only` item still reads "relevant
for Part 14" and the first pass of this document referred to "Part 14 (Vercel deploy)". Both
references now point at a part that no longer exists. Corrected in this revision.

### 8. Static responses carried no `Cache-Control`, so rebuilds broke the cached page (resolved)
Found while diagnosing a report of being unable to log in except in incognito. `StaticFiles` sets
only `etag`/`last-modified`, so browsers applied heuristic freshness to the exported HTML and
served it without revalidating. Because `_next/static` chunk filenames contain a content hash that
changes on every image rebuild, a cached page requested chunks that now 404 (verified live), so
React never hydrated and the login form was inert. Resolved: `ExportStaticFiles` now sends
`no-cache` for pages and `public, max-age=31536000, immutable` for `_next/static/` assets.

### Checked and cleared
`httpx2` in `backend/pyproject.toml` looks like a typo for `httpx` but is not: it is the real
successor package to `httpx` 2.x and is already a transitive requirement of `openai 3.51.0`
(`uv.lock` lists it under both `openai` and the dev group). No action needed.

## What held up well

- SQL is fully parameterized. The one dynamically built statement, the `UPDATE cards SET ...` in
  `update_card` (`database.py:355-360`), interpolates only names filtered against the literal
  whitelist `("title", "details")`, so there is no injection surface.
- `write_board` rejects any change to column identity or order and validates card/column
  referential integrity before writing (`main.py:231-254`), closing off a class of corrupt-board
  bugs from a misbehaving AI response. Confirmed live against both rejection paths.
- `_rewrite_positions` (`database.py:367-385`) avoids the `UNIQUE (column_id, position)` collision
  correctly by shifting existing rows past the current max before writing final positions — traced
  through both the same-column reorder and the cross-column move in `move_card`, including the
  temporary-position step for the moved card.
- `replace_board` runs its delete-then-reinsert inside the single transaction opened by
  `_connection`, so a partial board write cannot be persisted.
- Auth boundary is consistent: every board/card route resolves through `require_database_user`, and
  every query joins through `boards.user_id`, so no route can read or mutate another user's data.
  Moot today with one user, but the pattern is already correct for Part 11.
- `login` calls `request.session.clear()` before setting the username, so there is no session
  fixation window.
- Frontend only touches the network through `src/lib/api.ts`, and `KanbanBoard.tsx` routes every
  mutation through `runMutation` behind an `isBoardBusy` flag, with the same flag disabling the
  column inputs, card delete buttons, and new-card form.
- The e2e suite is non-destructive: `beforeEach`/`afterEach` snapshot and restore the board through
  the API, so repeated runs against a live container leave no residue.
