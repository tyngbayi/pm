# Database Schema

## Entities

- **User**: an account identified by a unique username. The MVP's `user` / `password` credentials remain hardcoded in FastAPI; passwords are not stored in this database.
- **Board**: belongs to one user. The MVP allows one board per user.
- **Column**: belongs to a board and has a stable order and editable title.
- **Card**: belongs to one column and has a stable order, title, and details.

## SQLite schema

Enable foreign-key enforcement on every SQLite connection with `PRAGMA foreign_keys = ON`.

```sql
CREATE TABLE IF NOT EXISTS users (
    id       TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS boards (
    id      TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL UNIQUE
            REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS columns (
    id       TEXT PRIMARY KEY NOT NULL,
    board_id TEXT NOT NULL
             REFERENCES boards (id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (board_id, position)
);

CREATE TABLE IF NOT EXISTS cards (
    id       TEXT PRIMARY KEY NOT NULL,
    column_id TEXT NOT NULL
              REFERENCES columns (id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    details  TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (column_id, position)
);
```

## Relationships and constraints

- IDs are text so they map directly to the frontend's string IDs. The application generates stable IDs when creating records.
- `boards.user_id` is unique, so a user can own at most one board. Board creation logic must ensure each signed-in user has a board.
- A new MVP board is initialized from the existing frontend seed: five columns and eight cards. Columns are renamed, not added or removed, in the MVP.
- A column has ordered cards. `position` is zero-based; card moves and reordering must update affected positions in a transaction.
- Unique position constraints prevent ambiguous ordering within a board or column. Reordering code must avoid transient collisions while updating positions.
- Deleting a user, board, or column cascades to its dependent rows. SQLite foreign-key enforcement must be enabled for each connection.
- The database stores no passwords. Authentication remains the existing hardcoded MVP behavior; database-backed credentials would require a separately approved change and must store password hashes, never plaintext.
- API queries must scope boards and their child records to the authenticated user.
- Timestamps and board titles are omitted because the current MVP model does not use them.

## JSON representation

The board API returns the existing frontend `BoardData` shape. Board and user IDs remain server-side. Columns are ordered by `columns.position`; each `cardIds` array is built from that column's cards ordered by `cards.position`. The `cards` object is keyed by card ID.

```json
{
  "columns": [
    {
      "id": "col-backlog",
      "title": "Backlog",
      "cardIds": ["card-1", "card-2"]
    },
    {
      "id": "col-discovery",
      "title": "Discovery",
      "cardIds": ["card-3"]
    }
  ],
  "cards": {
    "card-1": {
      "id": "card-1",
      "title": "Align roadmap themes",
      "details": "Draft quarterly themes with impact statements and metrics."
    },
    "card-2": {
      "id": "card-2",
      "title": "Gather customer signals",
      "details": "Review support tags, sales notes, and churn feedback."
    },
    "card-3": {
      "id": "card-3",
      "title": "Prototype analytics view",
      "details": "Sketch initial dashboard layout and key drill-downs."
    }
  }
}
```

This draft requires user approval before database implementation begins.
