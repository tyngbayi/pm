# Project Management

A Kanban project management app. FastAPI serves a JSON API under `/api` and the
Next.js static export at `/`, both from one Docker container.

Accounts sign in to any number of boards. Columns can be added, renamed,
reordered, and deleted. Cards carry a priority, due date, assignee, and labels,
and the board can be searched and filtered by them. An AI sidebar backed by
OpenRouter answers questions about a board and can update it.

## Run

Put an `OPENROUTER_API_KEY` and a `SESSION_SECRET` in `.env`, then:

```sh
./scripts/start.sh    # scripts/start.bat on Windows
./scripts/stop.sh
```

The app is at `http://localhost:8000`. The seeded demo admin is
`user` / `password`. Data lives in the `pm-data` volume and survives restarts.

The Next.js export is baked into the image, so the start scripts always rebuild.

## Tests

```sh
cd backend  && uv run pytest        # API and persistence
cd frontend && npm run test:unit    # Vitest
cd frontend && npm run test:e2e     # Playwright; the app must be running
```

## Documentation

`AGENTS.md` holds the requirements and technical decisions, `docs/PLAN.md` the
working plan and test policy, and `docs/DATABASE.md` the schema.
