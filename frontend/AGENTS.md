# Frontend

A Next.js 16 / React 19 Kanban app built as a static export. It has a fake user login, but board state remains in memory and there is no persistence or AI yet.

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS v4 (PostCSS plugin)
- @dnd-kit/core + @dnd-kit/sortable for drag-and-drop
- Vitest + @testing-library/react for unit tests
- Playwright for e2e tests

## Technical Decisions
- NextJS frontend
- Python FastAPI backend, including serving the static NextJS site at
- Everything packaged into a Docker container
- Use "uv" as the package manager for python in the Docker container
- Use OpenRouter for the AI calls. An OPENROUTER_API_KEY is in .env in the project root
- Use a local SQLite database, creating a new database if one does not exist
- Start and Stop server scripts for Mac, PC, Linux in scripts/

## Directory layout

```
src/
  app/
    layout.tsx        # Root layout; loads display + body fonts
    page.tsx          # Entry point — guards and renders <KanbanBoard />
    login/page.tsx    # Fake username/password login form
    globals.css       # CSS custom properties (color palette, surfaces, shadow)
  components/
    KanbanBoard.tsx   # Top-level board; owns all state; DndContext provider
    KanbanColumn.tsx  # Single column; droppable target; renders cards + NewCardForm
    KanbanCard.tsx    # Single card; sortable drag handle; Remove button
    KanbanCardPreview.tsx  # Ghost card shown in DragOverlay while dragging
    NewCardForm.tsx   # Inline add-card form (toggle open/closed per column)
    AuthGuard.tsx         # Redirects unauthenticated users to /login
    AuthGuard.test.tsx    # Auth guard unit tests
    KanbanBoard.test.tsx  # Component unit tests
  lib/
    kanban.ts         # Types (Card, Column, BoardData), initialData seed, moveCard logic, createId
    kanban.test.ts    # Unit tests for moveCard and createId
  test/
    setup.ts          # Vitest global setup (@testing-library/jest-dom matchers)
    vitest.d.ts       # Type augmentation for jest-dom matchers
tests/
  kanban.spec.ts      # Playwright auth and board e2e tests
```

## Data model

```ts
type Card   = { id: string; title: string; details: string }
type Column = { id: string; title: string; cardIds: string[] }
type BoardData = { columns: Column[]; cards: Record<string, Card> }
```

`initialData` seeds 5 columns (Backlog, Discovery, In Progress, Review, Done) with 8 demo cards.

## Key behaviors

- **Rename column**: inline `<input>` directly edits `column.title` via `onRename` callback.
- **Drag card**: @dnd-kit moves cards within or across columns; drop target highlights in accent yellow.
- **Add card**: `NewCardForm` collects title (required) + details, calls `onAddCard`; new id via `createId`.
- **Delete card**: "Remove" button on each card calls `onDeleteCard`.

## Color palette (CSS custom properties)

| Variable              | Value     | Usage                          |
|-----------------------|-----------|--------------------------------|
| `--accent-yellow`     | `#ecad0a` | Accent lines, column bar       |
| `--primary-blue`      | `#209dd7` | Links, add-card button         |
| `--secondary-purple`  | `#753991` | Submit buttons                 |
| `--navy-dark`         | `#032147` | Headings, body text            |
| `--gray-text`         | `#888888` | Supporting text, labels        |

## Starting Point

The existing frontend MVP began as a pure client-side demo and was not configured for static export or Docker.

## Final state (target)

- **Static export**: built with `next build` (`output: "export"`), `out/` served by FastAPI
- **Auth**: implemented `/login` page and board guard; calls `POST /api/auth/login` with hardcoded credentials (`user` / `password`); session is a signed cookie; logout clears it and returns to `/login`
- **Persistent board**: on mount the board fetches `GET /api/board`; every mutation (drag, rename, add card, delete card) immediately calls the relevant backend endpoint so state survives page reload
- **AI sidebar**: a panel that slides in from the right without obscuring the board; full conversation history; submits `POST /api/ai/chat` with the current board JSON + message history; if the response includes a `board_update`, the board refreshes automatically without a manual reload

## Coding standards
1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever.
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Working documentation

All documents for planning and executing this project will be in the docs/ directory. Please review the docs/PLAN.md document before proceeding.