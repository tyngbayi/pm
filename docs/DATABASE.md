# Database Schema

## Entities

- **User**: an account identified by a unique username, holding a PBKDF2 password hash, a display name, and a role (`admin` or `member`).
- **Board**: belongs to one user, who may own several, and may be shared with any number of other users. Each has an editable name.
- **Column**: belongs to a board and has a stable order, an editable title, and an optional WIP limit.
- **Card**: belongs to one column and has a stable order, title, details, priority, due date, labels, and an optional assignee.
- **Comment**: a line of discussion written by one user on one card, in a thread anyone who can open the board may read and add to.
- **Checklist item**: one subtask of a card, with a body and a done flag, belonging to the card rather than to a person.
- **Activity**: one recorded change to a board, with a rendered summary and the account that made it.

## SQLite schema

Enable foreign-key enforcement on every SQLite connection with `PRAGMA foreign_keys = ON`.

```sql
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY NOT NULL,
    username      TEXT NOT NULL UNIQUE,
    -- Added by migration 1; see "Migrations" below.
    password_hash TEXT NOT NULL DEFAULT '',
    display_name  TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'member',
    created_at    TEXT NOT NULL DEFAULT ''
);

-- Reshaped by migration 2: UNIQUE dropped from user_id, name and created_at
-- added. See "Migrations" below.
CREATE TABLE IF NOT EXISTS boards (
    id         TEXT PRIMARY KEY NOT NULL,
    user_id    TEXT NOT NULL
               REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX boards_by_user ON boards (user_id);

-- Extended by migration 8: wip_limit added. See "Migrations" below.
CREATE TABLE IF NOT EXISTS columns (
    id        TEXT PRIMARY KEY NOT NULL,
    board_id  TEXT NOT NULL
              REFERENCES boards (id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    position  INTEGER NOT NULL CHECK (position >= 0),
    wip_limit INTEGER NOT NULL DEFAULT 0,
    UNIQUE (board_id, position)
);

-- Extended by migration 3: priority, due_date, labels, assignee_id added.
-- See "Migrations" below.
CREATE TABLE IF NOT EXISTS cards (
    id       TEXT PRIMARY KEY NOT NULL,
    column_id TEXT NOT NULL
              REFERENCES columns (id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    details  TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL CHECK (position >= 0),
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TEXT NOT NULL DEFAULT '',
    labels   TEXT NOT NULL DEFAULT '[]',
    assignee_id TEXT
                REFERENCES users (id) ON DELETE SET NULL,
    archived_at TEXT NOT NULL DEFAULT '',
    UNIQUE (column_id, position)
);

-- Added by migration 4. The owner stays in `boards.user_id`; this table only
-- records the extra people a board is shared with.
CREATE TABLE board_members (
    board_id TEXT NOT NULL
             REFERENCES boards (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL
            REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_members_by_user ON board_members (user_id);

-- Added by migration 5.
CREATE TABLE card_comments (
    id         TEXT PRIMARY KEY NOT NULL,
    card_id    TEXT NOT NULL
               REFERENCES cards (id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL
               REFERENCES users (id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX card_comments_by_card ON card_comments (card_id);

-- Added by migration 6. `user_id` is nullable so an entry outlives its author.
CREATE TABLE board_activity (
    id         TEXT PRIMARY KEY NOT NULL,
    board_id   TEXT NOT NULL
               REFERENCES boards (id) ON DELETE CASCADE,
    user_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
    summary    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX board_activity_by_board ON board_activity (board_id);

-- Added by migration 7. No `position`: items are only ever appended.
CREATE TABLE card_checklist_items (
    id      TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NOT NULL
            REFERENCES cards (id) ON DELETE CASCADE,
    body    TEXT NOT NULL,
    done    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX card_checklist_by_card ON card_checklist_items (card_id);
```

## Relationships and constraints

- IDs are text so they map directly to the frontend's string IDs. The application generates stable IDs when creating records.
- A user owns any number of boards, listed in `created_at, name, id` order. Every account is seeded with one board at registration, and the API refuses to delete a user's last board so there is always something to show.
- Each new board is initialized from the frontend seed: five columns and eight cards, with freshly generated ids so no two boards share a column or card. Columns can then be renamed, added, reordered, and deleted; deleting one cascades its cards away.
- A column has ordered cards. `position` is zero-based; card moves and reordering must update affected positions in a transaction.
- `columns.wip_limit` is the number of cards the column should hold at once, with 0 for no limit. It is never enforced: the API accepts a card that puts a column over, and only the UI flags it. A nullable column was rejected because the limit is never unknown, only absent, which zero already says. The API caps it at 99 to keep a typo out of the database.
- `cards.priority` is `low`, `medium`, or `high`, and `cards.due_date` is an ISO `YYYY-MM-DD` string or empty for no deadline. Both are validated by the API, not by a `CHECK`, so the rule lives in one place alongside the rest of the request validation.
- `cards.labels` is a JSON array of strings, since SQLite has no list type. Labels are free text owned by a card and are never queried across cards in SQL, so a join table would add work without buying anything. The API caps a card at 8 labels of 24 characters each.
- `cards.assignee_id` is nullable and `ON DELETE SET NULL`, so deleting a user unassigns their cards on boards they do not own. Cards on their own boards cascade away with the user. The API rejects an assignee who is not a member of that card's board before writing, so the foreign key never fails mid-write.
- A board is reachable by its owner (`boards.user_id`) plus every row in `board_members`. The owner is deliberately not duplicated into `board_members`: a second source of truth would have to be kept in step, and every read unions the two anyway. Removing a membership row also clears `assignee_id` on that board's cards for that user, so no card points at someone who can no longer open it.
- A card moves to another board by repointing `cards.column_id` at a column on that board; nothing else changes, so the card keeps its id and its comments and checklist travel with it. The column it left is renumbered, and an assignee who is not a member of the destination is cleared, the same rule a removed membership applies.
- `cards.archived_at` is empty for a card on the board and an ISO UTC timestamp for one in the archive, so the one column is both the flag and the archive's sort key. An archived card stays in its column and keeps a `position`, but is always renumbered to the tail of it. That invariant is what lets every other reorder ignore the archive entirely: a position counted among the cards on screen is still a valid absolute position, because nothing archived sits in front of them. An archived card cascades away with its column or its board like any other.
- Unique position constraints prevent ambiguous ordering within a board or column. Reordering code must avoid transient collisions while updating positions.
- Deleting a user, board, or column cascades to its dependent rows. SQLite foreign-key enforcement must be enabled for each connection.
- Passwords are stored only as PBKDF2-SHA256 hashes in the form
  `pbkdf2_sha256$<iterations>$<salt_hex>$<digest_hex>`. The iteration count is
  embedded per hash, so raising it later leaves existing hashes verifiable.
  Plaintext passwords are never stored, logged, or returned by the API.
- `users.role` is `admin` or `member`. Only admins may reach `/api/users`. The
  last remaining admin cannot be demoted, and an admin cannot delete their own
  account, so the instance can never be left unadministrable.
- API queries must scope boards and their child records to the authenticated user. Column and card queries match `board_id IN ({ACCESSIBLE_BOARD_IDS})` — the owned-plus-shared union — so they stay correct per board without a board id in the path. Never `=`, which silently picks one of the user's boards. Renaming, deleting, and changing membership check `boards.user_id` directly, since those stay owner-only.
- Deleting a user's last *owned* board is refused; a board shared with them does not count, because it is not theirs to lose.
- A card's comments are readable and writable by anyone who can open its board, but deletable only by their author. Both cascades are deliberate: deleting a card removes its thread, and deleting an account removes what that account wrote. Losing board access does not, since the thread is a record of the conversation.
- Comments are ordered by `rowid`, which is insertion order. `created_at` is only second-resolution and ids are random, so neither breaks a same-second tie.
- The API caps a comment at 2000 characters and refuses an empty one. There is no `CHECK`: the rule lives with the rest of the request validation.
- A user's assigned cards are read across boards by joining `cards` to
  `columns` to `boards` on `cards.assignee_id`, scoped by the same accessible-
  board union. There is no "my work" table: it would be a second source of
  truth for something the existing rows already answer. The ordering puts
  `due_date = ''` last explicitly, since an empty string otherwise sorts first.
- `board_activity.summary` stores a rendered sentence rather than a structured
  diff, written at the moment of the change so it can name the old title a
  later row no longer holds. Entries are read newest first by `rowid`, for the
  same reason comments are read by it, and capped at 50 rows: the panel is
  recent context, not an audit export.
- `board_activity.user_id` is nullable and `ON DELETE SET NULL`, so deleting an
  account leaves its entries in place and the read falls back to "A deleted
  account". The board's history is a record of what happened to the board, so
  cascading it away with the author would rewrite it. Deleting the board itself
  does cascade, since there is then nothing to show it against.
- A checklist item has no `position`. Items are only ever appended, so `rowid`
  is their order, and they avoid the `UNIQUE (parent, position)` rewrite dance
  that columns and cards need. Anyone who can open the board may add, tick, and
  delete one: a checklist is the card's content, not one person's speech, so
  unlike a comment it is not owned by its author and records no author at all.
- A card's comment count is never stored, and neither are its checklist totals. All three are counted from `card_comments` and `card_checklist_items` in every card query, so they cannot drift from the rows they summarize.
- A whole-board rewrite (`PUT /api/boards/{id}` and the AI sidebar) drops every column, so cards cascade and their comments and checklist items with them. `replace_board` holds both child tables aside and reinserts the rows whose card survives. Any future per-card child table must join that list or it will be silently erased on every rewrite. Archived cards need the same treatment for a different reason: they are absent from the payload because the client never saw them, so `replace_board` reads them aside too and puts each one back on the tail of its column, dropping any whose column the rewrite removed.

## Migrations

Schema changes are tracked with SQLite's built-in `PRAGMA user_version`.
`SCHEMA` in `backend/database.py` is frozen at the original v1 shape, and
`MIGRATIONS` is an ordered tuple of `(version, SQL)` pairs applied on startup to
any file below that version. Fresh and long-lived databases therefore follow the
same upgrade path, and the `pm-data` volume upgrades in place without a wipe.

Never edit a released migration; append a new one instead.

| Version | Change |
| ------- | ------ |
| 1 | Add `password_hash`, `display_name`, `role`, `created_at` to `users` |
| 2 | Rebuild `boards` without `UNIQUE (user_id)`, adding `name` and `created_at` |
| 3 | Add `priority`, `due_date`, `labels`, `assignee_id` to `cards` |
| 4 | Add `board_members` for boards shared with users who do not own them |
| 5 | Add `card_comments` for per-card discussion threads |
| 6 | Add `board_activity` for the per-board history of who changed what |
| 7 | Add `card_checklist_items` for per-card subtask checklists |
| 8 | Add `wip_limit` to `columns` for the advisory per-column capacity |
| 9 | Add `archived_at` to `cards` for cards parked off the board |

A database migrated from v0 has no credentials for the seeded `user` account, so
`initialize_database` backfills the demo password and promotes it to `admin`
rather than leaving it locked out.

Migrations run on their own connection with `PRAGMA foreign_keys = OFF`. SQLite
cannot drop a constraint in place, so migration 2 rebuilds `boards` and drops the
old table; with enforcement on, that implicit delete would cascade every column
and card away with it.

`cards.assignee_id` has no explicit default because `ALTER TABLE ADD COLUMN`
cannot attach a `REFERENCES` clause to a non-null default, so migration 3 leaves
it defaulting to NULL. Existing cards therefore arrive unassigned, at medium
priority, with no due date and no labels.

## JSON representation

The board API returns the existing frontend `BoardData` shape. Board and user IDs remain server-side. Columns are ordered by `columns.position`; each `cardIds` array is built from that column's cards ordered by `cards.position`. The `cards` object is keyed by card ID.

```json
{
  "columns": [
    {
      "id": "col-backlog",
      "title": "Backlog",
      "cardIds": ["card-1"]
    },
    {
      "id": "col-discovery",
      "title": "Discovery",
      "cardIds": ["card-2"]
    }
  ],
  "cards": {
    "card-1": {
      "id": "card-1",
      "title": "Align roadmap themes",
      "details": "Draft quarterly themes with impact statements and metrics.",
      "priority": "high",
      "dueDate": "2027-05-06",
      "labels": ["planning"],
      "assigneeId": "user-1",
      "commentCount": 2
    },
    "card-2": {
      "id": "card-2",
      "title": "Gather customer signals",
      "details": "Review support tags, sales notes, and churn feedback.",
      "priority": "medium",
      "dueDate": "",
      "labels": [],
      "assigneeId": null,
      "commentCount": 0
    }
  }
}
```

This schema was approved for implementation in Part 6.
