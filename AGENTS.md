# The Project Management MVP web app

## Business Requirements

This project is building a Project Management App. Key features:
- A user can sign in
- When signed in, the user sees a Kanban board representing their project
- ~~The Kanban board has fixed columns that can be renamed~~ Columns can also be added, reordered, and deleted
- The cards on the Kanban board can be moved with drag and drop, and edited. Each carries a priority, due date, assignee, and labels, and the board can be searched and filtered by them
- There is an AI chat feature in a sidebar; the AI is able to create / edit / move one or more cards

## Limitations

These framed the original MVP. The first two have since been lifted; see
"Current Implementation" below and `docs/PLAN.md`.

- ~~For the MVP, there will only be a user sign in (hardcoded to 'user' and 'password') but the database will support multiple users for future.~~ Real accounts now exist; `user` / `password` is seeded as the demo admin.
- ~~For the MVP, there will only be 1 Kanban board per signed in user.~~ A user may own any number of boards.

For the MVP, this will run locally (in a docker container)

## Technical Decisions

- NextJS frontend
- Python FastAPI backend, including serving the static NextJS site at /
- Everything packaged into a Docker container
- Use "uv" as the package manager for python in the Docker container
- Use OpenRouter for the AI calls. An OPENROUTER_API_KEY is in .env in the project root
- Use `openai/gpt-oss-120b` on OpenRouter; requests may incur charges
- Use a local SQLite database, creating a new database if one doesn't exist
- Start and Stop server scripts for Mac, PC, Linux in scripts/

## Starting Point (historical)

A working frontend MVP existed before the Docker setup; it was a pure frontend-only demo.

## Current Implementation

- The Next.js frontend is statically exported and served by FastAPI in Docker.
- Real accounts with PBKDF2 password hashes, sign-up, and `admin` / `member` roles. `user` / `password` is seeded as the demo admin. Admins manage the roster at `/admin`.
- Each user owns any number of boards, created, renamed, shared, and deleted from the board switcher in the header. An owner may share a board with other accounts, who can then open and edit it and be assigned its cards, but not rename, delete, or reshare it.
- SQLite persistence and authenticated board/card APIs are implemented; the frontend persists board state through the API.
- Cards carry a priority, due date, labels, and an optional assignee, edited in a detail dialog. The board header searches and filters by text, assignee, and label.
- Every card has a comment thread in its detail dialog, open to anyone who can see the board, with a comment count shown on the card.
- A column can carry a WIP limit. The board shows the count against it and turns the column red once it is over, but never refuses the work.
- Every card has a checklist of subtasks in its detail dialog, tickable by anyone who can see the board, with the done-of-total progress shown on the card.
- A card can be moved to another of the user's boards from its detail dialog, taking its comments and checklist with it and leaving an entry in both boards' histories.
- A card can be archived off the board rather than deleted, keeping its comments and checklist. An "Archive" panel in the header lists what is parked, newest first, and restores a card to the foot of the column it was archived from.
- A card can be blocked by other cards on the same board, set from its detail dialog, which names both what is blocking the card and what the card is blocking. A blocked card carries a "Blocked" badge on the board. A dependency that would close a cycle is refused.
- A "My work" panel in the header gathers every card assigned to the signed-in user across all their boards, soonest due first; selecting one opens that board and card.
- A "Board history" panel in the header lists who changed what on the open board, newest first, so a shared board's members can see each other's edits.
- The authenticated AI endpoints connect to OpenRouter using `OPENROUTER_API_KEY`; the sidebar can chat about the board and persist AI-proposed board updates.

## Color Scheme

- Accent Yellow: `#ecad0a` - accent lines, highlights
- Blue Primary: `#209dd7` - links, key sections
- Purple Secondary: `#753991` - submit buttons, important actions
- Dark Navy: `#032147` - main headings
- Gray Text: `#888888` - supporting text, labels

## Coding standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Working documentation

All documents for planning and executing this project will be in the docs/ directory.
Please review the docs/PLAN.md document before proceeding.