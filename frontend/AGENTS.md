# Frontend

A Next.js 16 / React 19 Kanban app built as a static export. Users sign up and sign in, own any number of boards persisted through FastAPI, and get an AI chat sidebar for board questions and updates. Admins manage accounts at `/admin`.

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
    login/page.tsx    # Username/password sign-in form
    signup/page.tsx   # Account registration form
    admin/page.tsx    # Guards and renders <UserManagement /> (admins only)
    globals.css       # CSS custom properties (color palette, surfaces, shadow)
  components/
    KanbanBoard.tsx   # Loads and persists board state; owns state; DndContext provider
    BoardSwitcher.tsx # Board select plus create, rename, share, and delete controls
    ShareDialog.tsx   # Modal for a board's roster: add and remove members
    KanbanColumn.tsx  # Single column; droppable target; renders cards + NewCardForm
    KanbanCard.tsx    # Single card; sortable drag handle; badges; edit/delete icons
    KanbanCardPreview.tsx  # Ghost card shown in DragOverlay while dragging
    CardDialog.tsx    # Modal for editing one card's fields plus its thread
    CardComments.tsx  # One card's comment thread: list, add, delete own
    BoardFilters.tsx  # Search box plus assignee and label filters
    AiSidebar.tsx     # AI conversation UI and optional board update handling
    MyWorkDialog.tsx  # Cross-board list of the signed-in user's assigned cards
    ActivityDialog.tsx     # The open board's history of who changed what
    NewCardForm.tsx   # Inline add-card form (toggle open/closed per column)
    NewColumnForm.tsx # Inline add-column form at the end of the board
    AuthGuard.tsx     # Redirects unauthenticated users to /login
    UserManagement.tsx     # Admin roster: create, change role, delete accounts
    AuthGuard.test.tsx     # Auth guard unit tests
    KanbanBoard.test.tsx   # Component unit tests
    UserManagement.test.tsx  # Admin roster unit tests
  lib/
    api.ts            # Typed fetch wrappers for the backend API
    api.test.ts       # API request and error handling tests
    kanban.ts         # Types (Card, Column, BoardData) plus moveCard and filterBoard
    kanban.test.ts    # Unit tests for moveCard and filterBoard logic
  test/
    setup.ts          # Vitest global setup (@testing-library/jest-dom matchers)
    vitest.d.ts       # Type augmentation for jest-dom matchers
tests/
  helpers.ts          # Shared Playwright sign-up and account-cleanup helpers
  kanban.spec.ts      # Playwright auth and board e2e tests
  accounts.spec.ts    # Sign-up, isolation, and admin roster e2e tests
  boards.spec.ts      # Multi-board create, switch, rename, delete e2e tests
  columns.spec.ts     # Column add, reorder, and delete e2e tests
  cards.spec.ts       # Card detail editing and board filtering e2e tests
  sharing.spec.ts     # Board sharing, access, and revocation e2e tests
  comments.spec.ts    # Card comment thread and shared-board discussion e2e tests
  mywork.spec.ts      # Cross-board assigned-card panel e2e tests
  activity.spec.ts    # Board history panel e2e tests
```

## Data model

```ts
type Priority = "low" | "medium" | "high"
type Card   = {
  id: string
  title: string
  details: string
  priority: Priority
  dueDate: string          // ISO YYYY-MM-DD, or "" for no deadline
  labels: string[]
  assigneeId: string | null
  commentCount: number     // derived by the API; never sent back
}
type Column = { id: string; title: string; cardIds: string[] }
type BoardData = { columns: Column[]; cards: Record<string, Card> }
type Member = { id: string; display_name: string }
type Assignment = {
  card_id: string
  title: string
  priority: Priority
  dueDate: string
  board_id: string
  board_name: string
  column_title: string
}
type Activity = {
  id: string
  summary: string
  author_name: string
  created_at: string
}
type Comment = {
  id: string
  body: string
  author_id: string
  author_name: string
  created_at: string
}
```

The backend seeds the initial board; the frontend loads persisted board data from the API.

## Key behaviors

- **Rename column**: inline `<input>` saves the new title on Enter or blur.
- **Manage columns**: `NewColumnForm` appends a column; per-column icon buttons move it left or right and delete it, which also removes its cards. Each of these returns the whole reshaped board, which replaces local state.
- **Drag card**: @dnd-kit moves cards within or across columns; drop target highlights in accent yellow.
- **Add card**: `NewCardForm` collects title (required) + details and sends them to the backend.
- **Delete card**: an icon button on each card deletes it through the backend. Icon-only controls carry an `aria-label` and hide the SVG with `aria-hidden`, so they stay reachable by accessible name.
- **Edit card**: a pencil icon opens `CardDialog`, which edits title, details, priority, due date, assignee, and comma-separated labels in one `PATCH`. The card shows a priority pill, the due date (red once overdue), the assignee name, and a label pill each. The assignee picker is filled from `GET /api/boards/{id}/members`, reloaded with the board and failing quietly so a missing roster cannot break it.
- **Comment on a card**: the detail dialog carries a thread under the fields. Anyone who can open the board may read and add; the delete icon only appears on one's own comments. The card shows a count badge once the thread is non-empty. `CardComments` loads and writes its own comments and reports a `+1`/`-1` delta up, so the badge stays in step without refetching the board. The dialog is a `div` around two sibling forms, since nesting forms is invalid HTML, and its header is sticky so the close button stays reachable once the thread makes it scroll.
- **Filter board**: `BoardFilters` narrows the board by free text (title, details, labels), assignee, and label. `filterBoard` keeps every column on screen so a match stays readable in context, and drag is paused while filtering because card positions are absolute.
- **Switch board**: `BoardSwitcher` lists the boards a user can open and creates, renames, shares, or deletes them. Deletion is disabled while only one owned board remains.
- **Share board**: a share icon opens `ShareDialog`, which adds a member by username and removes one by icon. A board owned by someone else is suffixed "(shared)" and hides the rename, share, and delete controls, matching the API, which answers 404 for all three.
- **Persistence**: the board loads on page entry; successful add, rename, delete, and move operations persist across reloads. Loading and API errors are shown inline.
- **My work**: a header icon opens `MyWorkDialog`, which fetches `GET /api/assignments` on open and lists every card assigned to the user across all their boards, soonest due first with undated cards last. Each row shows the board, column, priority, and due date (red once overdue); selecting one switches to that board and opens the card's dialog.
- **Board history**: a header icon opens `ActivityDialog`, which fetches `GET /api/boards/{id}/activity` on open and lists the board's recent changes newest first, each with its author and timestamp. Everyone who can open the board sees the same history, so a shared board's members can follow each other's edits.
- **AI assistant**: the sidebar sends the active board id and the conversation to `/api/ai/chat`; the backend reads, validates, and persists the board itself, so the sidebar just renders the board it gets back.

## Color palette (CSS custom properties)

| Variable              | Value     | Usage                          |
|-----------------------|-----------|--------------------------------|
| `--accent-yellow`     | `#ecad0a` | Accent lines, column bar       |
| `--primary-blue`      | `#209dd7` | Links, add-card button         |
| `--secondary-purple`  | `#753991` | Submit buttons                 |
| `--navy-dark`         | `#032147` | Headings, body text            |
| `--gray-text`         | `#888888` | Supporting text, labels        |

## Current state

- **Static export**: built with `next build` (`output: "export"`), `out/` served by FastAPI
- **Auth**: `/login` and `/signup` pages behind an `AuthGuard`; sessions are a signed cookie; logout clears it and returns to `/login`. `user` / `password` is the seeded demo admin.
- **Accounts**: `/admin` lists every account and lets admins create them, change roles, and delete them. The route relies on the API's 403, not on client-side gating.
- **Persistent board**: on mount the app fetches `GET /api/boards` and then the active board; every mutation (drag, rename, add card, delete card) immediately calls the relevant backend endpoint so state survives page reload
- **Comments**: every card has a persisted thread, shared by everyone who can open the board, with a count badge on the card.
- **My work**: one cross-board view of the signed-in user's assigned cards, reachable from the board header.
- **Board history**: the open board's recorded changes, with who made each one, reachable from the board header.
- **AI chat**: authenticated sidebar conversation uses OpenRouter; structured responses can update and persist the board. Requests use the configured paid model.

## Coding standards
1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever.
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Working documentation

All documents for planning and executing this project will be in the docs/ directory. Please review the docs/PLAN.md document before proceeding.