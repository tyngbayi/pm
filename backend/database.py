import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, TypedDict

from security import hash_password, verify_password


# The v1 shape the app originally shipped. Fresh and existing databases both
# start here and are then brought forward by MIGRATIONS, so there is only one
# upgrade path to reason about.
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL UNIQUE
            REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS columns (
    id TEXT PRIMARY KEY NOT NULL,
    board_id TEXT NOT NULL
             REFERENCES boards (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (board_id, position)
);

CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY NOT NULL,
    column_id TEXT NOT NULL
              REFERENCES columns (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (column_id, position)
);
"""

# Each entry upgrades the database to its version number. `PRAGMA user_version`
# records how far a file has been brought, so upgrades are applied once and in
# order. Never edit a released migration; append a new one instead.
MIGRATIONS: tuple[tuple[int, str], ...] = (
    (
        1,
        """
        ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
        ALTER TABLE users ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
        """,
    ),
    (
        2,
        # SQLite cannot drop a constraint in place, so lifting UNIQUE (user_id)
        # off `boards` means rebuilding the table.
        """
        CREATE TABLE boards_v2 (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL
                    REFERENCES users (id) ON DELETE CASCADE,
            name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO boards_v2 (id, user_id, name, created_at)
            SELECT id, user_id, 'My board', '' FROM boards;
        DROP TABLE boards;
        ALTER TABLE boards_v2 RENAME TO boards;
        CREATE INDEX boards_by_user ON boards (user_id);
        """,
    ),
    (
        3,
        # `assignee_id` has to default to NULL: ADD COLUMN cannot attach a
        # REFERENCES clause to a non-null default.
        """
        ALTER TABLE cards ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium';
        ALTER TABLE cards ADD COLUMN due_date TEXT NOT NULL DEFAULT '';
        ALTER TABLE cards ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE cards ADD COLUMN assignee_id TEXT
                                    REFERENCES users (id) ON DELETE SET NULL;
        """,
    ),
    (
        4,
        # Board owners stay in `boards.user_id`; this table only records the
        # extra people a board is shared with.
        """
        CREATE TABLE board_members (
            board_id TEXT NOT NULL
                     REFERENCES boards (id) ON DELETE CASCADE,
            user_id TEXT NOT NULL
                    REFERENCES users (id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (board_id, user_id)
        );
        CREATE INDEX board_members_by_user ON board_members (user_id);
        """,
    ),
    (
        5,
        """
        CREATE TABLE card_comments (
            id TEXT PRIMARY KEY NOT NULL,
            card_id TEXT NOT NULL
                    REFERENCES cards (id) ON DELETE CASCADE,
            user_id TEXT NOT NULL
                    REFERENCES users (id) ON DELETE CASCADE,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX card_comments_by_card ON card_comments (card_id);
        """,
    ),
)
SCHEMA_VERSION = MIGRATIONS[-1][0]

ROLES = ("admin", "member")
DEFAULT_USERNAME = "user"
DEFAULT_PASSWORD = "password"
DEFAULT_COLUMNS = (
    (
        "Backlog",
        (
            (
                "Align roadmap themes",
                "Draft quarterly themes with impact statements and metrics.",
            ),
            (
                "Gather customer signals",
                "Review support tags, sales notes, and churn feedback.",
            ),
        ),
    ),
    (
        "Discovery",
        (
            (
                "Prototype analytics view",
                "Sketch initial dashboard layout and key drill-downs.",
            ),
        ),
    ),
    (
        "In Progress",
        (
            (
                "Refine status language",
                "Standardize column labels and tone across the board.",
            ),
            (
                "Design card layout",
                "Add hierarchy and spacing for scanning dense lists.",
            ),
        ),
    ),
    (
        "Review",
        (("QA micro-interactions", "Verify hover, focus, and loading states."),),
    ),
    (
        "Done",
        (
            (
                "Ship marketing page",
                "Final copy approved and asset pack delivered.",
            ),
            (
                "Close onboarding sprint",
                "Document release notes and share internally.",
            ),
        ),
    ),
)


class UserRecord(TypedDict):
    id: str
    username: str
    display_name: str
    role: str
    created_at: str


class CardRecord(TypedDict):
    id: str
    title: str
    details: str
    priority: str
    dueDate: str
    assigneeId: str | None
    labels: list[str]
    # Derived from `card_comments`, so it is read-only: `replace_board` never
    # writes it back.
    commentCount: int


class CommentRecord(TypedDict):
    id: str
    body: str
    author_id: str
    author_name: str
    created_at: str


class AssignmentRecord(TypedDict):
    """One of a user's assigned cards, placed in the board it sits on."""

    card_id: str
    title: str
    priority: str
    dueDate: str
    board_id: str
    board_name: str
    column_title: str


class ColumnRecord(TypedDict):
    id: str
    title: str
    cardIds: list[str]


class BoardRecord(TypedDict):
    columns: list[ColumnRecord]
    cards: dict[str, CardRecord]


class BoardSummary(TypedDict):
    id: str
    name: str
    created_at: str
    owned: bool


@contextmanager
def _connection(database_path: Path) -> Iterator[sqlite3.Connection]:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _seed_board(
    connection: sqlite3.Connection, user_id: str, name: str = "My board"
) -> str:
    board_id = _new_id("board")
    connection.execute(
        "INSERT INTO boards (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
        (board_id, user_id, name, _now()),
    )
    for column_position, (title, cards) in enumerate(DEFAULT_COLUMNS):
        column_id = _new_id("col")
        connection.execute(
            """
            INSERT INTO columns (id, board_id, title, position)
            VALUES (?, ?, ?, ?)
            """,
            (column_id, board_id, title, column_position),
        )
        for card_position, (card_title, details) in enumerate(cards):
            connection.execute(
                """
                INSERT INTO cards (id, column_id, title, details, position)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    _new_id("card"),
                    column_id,
                    card_title,
                    details,
                    card_position,
                ),
            )
    return board_id


def _apply_migrations(database_path: Path) -> None:
    """Bring a database file up to SCHEMA_VERSION.

    Runs on its own connection with foreign keys off: migration 2 rebuilds
    `boards`, and dropping a parent table with enforcement on would cascade
    every column and card away with it.
    """
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("PRAGMA foreign_keys = OFF")
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        for target, statements in MIGRATIONS:
            if version < target:
                connection.executescript(statements)
                # PRAGMA does not accept bound parameters; target is an int
                # literal from MIGRATIONS, never user input.
                connection.execute(f"PRAGMA user_version = {target}")
        connection.commit()
    finally:
        connection.close()


def initialize_database(database_path: Path) -> None:
    with _connection(database_path) as connection:
        connection.executescript(SCHEMA)
    _apply_migrations(database_path)

    with _connection(database_path) as connection:
        user = connection.execute(
            "SELECT id, password_hash FROM users WHERE username = ?",
            (DEFAULT_USERNAME,),
        ).fetchone()
        if user is None:
            user_id = _new_id("user")
            connection.execute(
                """
                INSERT INTO users
                    (id, username, password_hash, display_name, role, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    DEFAULT_USERNAME,
                    hash_password(DEFAULT_PASSWORD),
                    "Demo User",
                    "admin",
                    _now(),
                ),
            )
        else:
            user_id = user["id"]
            # A database migrated from v0 has no credentials for the seeded
            # account, which would otherwise lock the demo user out.
            if not user["password_hash"]:
                connection.execute(
                    """
                    UPDATE users
                    SET password_hash = ?, display_name = ?, role = ?,
                        created_at = ?
                    WHERE id = ?
                    """,
                    (
                        hash_password(DEFAULT_PASSWORD),
                        "Demo User",
                        "admin",
                        _now(),
                        user_id,
                    ),
                )

        board = connection.execute(
            "SELECT id FROM boards WHERE user_id = ?", (user_id,)
        ).fetchone()
        if board is None:
            _seed_board(connection, user_id)


USER_FIELDS = "id, username, display_name, role, created_at"


def _user_data(row: sqlite3.Row) -> UserRecord:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "created_at": row["created_at"],
    }


def get_user(database_path: Path, user_id: str) -> UserRecord | None:
    with _connection(database_path) as connection:
        row = connection.execute(
            f"SELECT {USER_FIELDS} FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        return _user_data(row) if row else None


def list_users(database_path: Path) -> list[UserRecord]:
    with _connection(database_path) as connection:
        rows = connection.execute(
            f"SELECT {USER_FIELDS} FROM users ORDER BY created_at, username"
        ).fetchall()
        return [_user_data(row) for row in rows]


def get_user_by_username(
    database_path: Path, username: str
) -> UserRecord | None:
    with _connection(database_path) as connection:
        row = connection.execute(
            f"SELECT {USER_FIELDS} FROM users WHERE username = ?", (username,)
        ).fetchone()
        return _user_data(row) if row else None


def create_user(
    database_path: Path,
    username: str,
    password: str,
    display_name: str,
    role: str = "member",
) -> UserRecord | None:
    """Create a user with a seeded starter board. Returns None if taken."""
    with _connection(database_path) as connection:
        taken = connection.execute(
            "SELECT 1 FROM users WHERE username = ?", (username,)
        ).fetchone()
        if taken is not None:
            return None

        user_id = _new_id("user")
        connection.execute(
            """
            INSERT INTO users
                (id, username, password_hash, display_name, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                username,
                hash_password(password),
                display_name,
                role,
                _now(),
            ),
        )
        _seed_board(connection, user_id)
        row = connection.execute(
            f"SELECT {USER_FIELDS} FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        return _user_data(row)


def authenticate_user(
    database_path: Path, username: str, password: str
) -> UserRecord | None:
    with _connection(database_path) as connection:
        row = connection.execute(
            f"SELECT {USER_FIELDS}, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if row is None or not verify_password(password, row["password_hash"]):
            return None
        return _user_data(row)


def update_user(
    database_path: Path, user_id: str, changes: dict[str, str]
) -> UserRecord | None:
    with _connection(database_path) as connection:
        row = connection.execute(
            "SELECT id FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            return None

        assignments: list[str] = []
        values: list[str] = []
        for field in ("display_name", "role"):
            if field in changes:
                assignments.append(f"{field} = ?")
                values.append(changes[field])
        if "password" in changes:
            assignments.append("password_hash = ?")
            values.append(hash_password(changes["password"]))
        if assignments:
            connection.execute(
                f"UPDATE users SET {', '.join(assignments)} WHERE id = ?",
                (*values, user_id),
            )
        updated = connection.execute(
            f"SELECT {USER_FIELDS} FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        return _user_data(updated)


def delete_user(database_path: Path, user_id: str) -> bool:
    with _connection(database_path) as connection:
        cursor = connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return cursor.rowcount == 1


def count_admins(database_path: Path) -> int:
    with _connection(database_path) as connection:
        return connection.execute(
            "SELECT COUNT(*) FROM users WHERE role = 'admin'"
        ).fetchone()[0]


BOARD_FIELDS = "boards.id, boards.name, boards.created_at"
BOARD_ORDER = "ORDER BY boards.created_at, boards.name, boards.id"

# Boards a user may read and edit: the ones they own plus the ones shared with
# them. Renaming, deleting, and changing membership stay owner-only and check
# `boards.user_id` directly. Takes the user id twice.
ACCESSIBLE_BOARD_IDS = """
    SELECT id FROM boards WHERE user_id = ?
    UNION
    SELECT board_id FROM board_members WHERE user_id = ?
"""


def _board_summary(row: sqlite3.Row, owned: bool) -> BoardSummary:
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "owned": owned,
    }


def _accessible_board_id(
    connection: sqlite3.Connection, user_id: str, board_id: str
) -> str | None:
    row = connection.execute(
        f"SELECT id FROM boards WHERE id = ? AND id IN ({ACCESSIBLE_BOARD_IDS})",
        (board_id, user_id, user_id),
    ).fetchone()
    return row["id"] if row else None


def list_boards(database_path: Path, user_id: str) -> list[BoardSummary]:
    with _connection(database_path) as connection:
        rows = connection.execute(
            f"""
            SELECT {BOARD_FIELDS}, boards.user_id
            FROM boards
            WHERE boards.id IN ({ACCESSIBLE_BOARD_IDS})
            {BOARD_ORDER}
            """,
            (user_id, user_id),
        ).fetchall()
        return [
            _board_summary(row, row["user_id"] == user_id) for row in rows
        ]


def create_board(
    database_path: Path, user_id: str, name: str
) -> BoardSummary:
    with _connection(database_path) as connection:
        board_id = _seed_board(connection, user_id, name)
        row = connection.execute(
            f"SELECT {BOARD_FIELDS} FROM boards WHERE boards.id = ?", (board_id,)
        ).fetchone()
        return _board_summary(row, owned=True)


def rename_board(
    database_path: Path, user_id: str, board_id: str, name: str
) -> BoardSummary | None:
    with _connection(database_path) as connection:
        cursor = connection.execute(
            "UPDATE boards SET name = ? WHERE id = ? AND user_id = ?",
            (name, board_id, user_id),
        )
        if cursor.rowcount != 1:
            return None
        row = connection.execute(
            f"SELECT {BOARD_FIELDS} FROM boards WHERE boards.id = ?", (board_id,)
        ).fetchone()
        return _board_summary(row, owned=True)


def delete_board(database_path: Path, user_id: str, board_id: str) -> bool:
    with _connection(database_path) as connection:
        cursor = connection.execute(
            "DELETE FROM boards WHERE id = ? AND user_id = ?",
            (board_id, user_id),
        )
        return cursor.rowcount == 1


def count_boards(database_path: Path, user_id: str) -> int:
    """Count the boards a user owns. Shared boards are not theirs to lose."""
    with _connection(database_path) as connection:
        return connection.execute(
            "SELECT COUNT(*) FROM boards WHERE user_id = ?", (user_id,)
        ).fetchone()[0]


# Everyone who can see a board: its owner plus the people it is shared with.
BOARD_MEMBER_IDS = """
    SELECT user_id FROM boards WHERE id = ?
    UNION
    SELECT user_id FROM board_members WHERE board_id = ?
"""


def board_owner_id(database_path: Path, board_id: str) -> str | None:
    with _connection(database_path) as connection:
        row = connection.execute(
            "SELECT user_id FROM boards WHERE id = ?", (board_id,)
        ).fetchone()
        return row["user_id"] if row else None


def list_board_members(
    database_path: Path, user_id: str, board_id: str
) -> list[UserRecord] | None:
    """The board's roster, or None when the user cannot see the board."""
    with _connection(database_path) as connection:
        if _accessible_board_id(connection, user_id, board_id) is None:
            return None
        rows = connection.execute(
            f"""
            SELECT {USER_FIELDS} FROM users
            WHERE id IN ({BOARD_MEMBER_IDS})
            ORDER BY display_name, username
            """,
            (board_id, board_id),
        ).fetchall()
        return [_user_data(row) for row in rows]


def board_member_ids(database_path: Path, board_id: str) -> set[str]:
    with _connection(database_path) as connection:
        return {
            row["user_id"]
            for row in connection.execute(BOARD_MEMBER_IDS, (board_id, board_id))
        }


def add_board_member(database_path: Path, board_id: str, user_id: str) -> bool:
    """Share a board. False when the user already reaches it."""
    with _connection(database_path) as connection:
        if user_id in {
            row["user_id"]
            for row in connection.execute(BOARD_MEMBER_IDS, (board_id, board_id))
        }:
            return False
        connection.execute(
            """
            INSERT INTO board_members (board_id, user_id, created_at)
            VALUES (?, ?, ?)
            """,
            (board_id, user_id, _now()),
        )
        return True


def remove_board_member(
    database_path: Path, board_id: str, user_id: str
) -> bool:
    with _connection(database_path) as connection:
        cursor = connection.execute(
            "DELETE FROM board_members WHERE board_id = ? AND user_id = ?",
            (board_id, user_id),
        )
        if cursor.rowcount != 1:
            return False
        # Otherwise they stay assigned to cards on a board they can no longer
        # open, and the assignee would render as a blank name.
        connection.execute(
            """
            UPDATE cards SET assignee_id = NULL
            WHERE assignee_id = ?
              AND column_id IN (SELECT id FROM columns WHERE board_id = ?)
            """,
            (user_id, board_id),
        )
        return True


CARD_FIELDS = (
    "cards.id, cards.title, cards.details, cards.priority, cards.due_date, "
    "cards.labels, cards.assignee_id, "
    "(SELECT COUNT(*) FROM card_comments WHERE card_id = cards.id)"
    " AS comment_count"
)

# JSON card fields mapped to their database column. `labels` is stored as a
# JSON array because SQLite has no list type.
CARD_UPDATES = {
    "title": "title",
    "details": "details",
    "priority": "priority",
    "dueDate": "due_date",
    "labels": "labels",
    "assigneeId": "assignee_id",
}


def _card_data(row: sqlite3.Row) -> CardRecord:
    return {
        "id": row["id"],
        "title": row["title"],
        "details": row["details"],
        "priority": row["priority"],
        "dueDate": row["due_date"],
        "labels": json.loads(row["labels"]),
        "assigneeId": row["assignee_id"],
        "commentCount": row["comment_count"],
    }


def _board_data(
    connection: sqlite3.Connection, board_id: str
) -> BoardRecord:
    result: BoardRecord = {"columns": [], "cards": {}}
    columns = connection.execute(
        "SELECT id, title FROM columns WHERE board_id = ? ORDER BY position",
        (board_id,),
    ).fetchall()
    for column in columns:
        cards = connection.execute(
            f"""
            SELECT {CARD_FIELDS}
            FROM cards
            WHERE column_id = ?
            ORDER BY position
            """,
            (column["id"],),
        ).fetchall()
        result["columns"].append(
            {
                "id": column["id"],
                "title": column["title"],
                "cardIds": [card["id"] for card in cards],
            }
        )
        result["cards"].update({card["id"]: _card_data(card) for card in cards})
    return result


def get_board(
    database_path: Path, user_id: str, board_id: str
) -> BoardRecord | None:
    with _connection(database_path) as connection:
        if _accessible_board_id(connection, user_id, board_id) is None:
            return None
        return _board_data(connection, board_id)


def replace_board(
    database_path: Path, board_id: str, board_data: BoardRecord
) -> BoardRecord:
    """Overwrite a board's contents. Callers must have checked ownership."""
    with _connection(database_path) as connection:
        # The rewrite below drops every column, so the board's cards cascade
        # away and their comments with them. A card that survives the rewrite
        # keeps its thread, so the comments are held aside and put back.
        saved = connection.execute(
            """
            SELECT card_comments.id, card_comments.card_id,
                   card_comments.user_id, card_comments.body,
                   card_comments.created_at
            FROM card_comments
            JOIN cards ON cards.id = card_comments.card_id
            JOIN columns ON columns.id = cards.column_id
            WHERE columns.board_id = ?
            ORDER BY card_comments.rowid
            """,
            (board_id,),
        ).fetchall()
        connection.execute("DELETE FROM columns WHERE board_id = ?", (board_id,))
        columns = board_data["columns"]
        cards = board_data["cards"]
        for column_position, column in enumerate(columns):
            connection.execute(
                """
                INSERT INTO columns (id, board_id, title, position)
                VALUES (?, ?, ?, ?)
                """,
                (column["id"], board_id, column["title"], column_position),
            )
            for card_position, card_id in enumerate(column["cardIds"]):
                card = cards[card_id]
                connection.execute(
                    """
                    INSERT INTO cards (id, column_id, title, details, position,
                                       priority, due_date, labels, assignee_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        card["id"],
                        column["id"],
                        card["title"],
                        card["details"],
                        card_position,
                        card["priority"],
                        card["dueDate"],
                        json.dumps(card["labels"]),
                        card["assigneeId"],
                    ),
                )
        connection.executemany(
            """
            INSERT INTO card_comments (id, card_id, user_id, body, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [tuple(row) for row in saved if row["card_id"] in cards],
        )
        return _board_data(connection, board_id)


def rename_column(
    database_path: Path, user_id: str, column_id: str, title: str
) -> bool:
    with _connection(database_path) as connection:
        cursor = connection.execute(
            f"""
            UPDATE columns
            SET title = ?
            WHERE id = ?
              AND board_id IN ({ACCESSIBLE_BOARD_IDS})
            """,
            (title, column_id, user_id, user_id),
        )
        return cursor.rowcount == 1


def _accessible_column_board_id(
    connection: sqlite3.Connection, user_id: str, column_id: str
) -> str | None:
    row = connection.execute(
        f"""
        SELECT columns.board_id
        FROM columns
        WHERE columns.id = ?
          AND columns.board_id IN ({ACCESSIBLE_BOARD_IDS})
        """,
        (column_id, user_id, user_id),
    ).fetchone()
    return None if row is None else row["board_id"]


def create_column(
    database_path: Path, user_id: str, board_id: str, title: str
) -> BoardRecord | None:
    with _connection(database_path) as connection:
        if _accessible_board_id(connection, user_id, board_id) is None:
            return None
        position = connection.execute(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM columns WHERE board_id = ?",
            (board_id,),
        ).fetchone()[0]
        connection.execute(
            """
            INSERT INTO columns (id, board_id, title, position)
            VALUES (?, ?, ?, ?)
            """,
            (_new_id("col"), board_id, title, position),
        )
        return _board_data(connection, board_id)


def delete_column(
    database_path: Path, user_id: str, column_id: str
) -> BoardRecord | None:
    """Delete a column; its cards cascade away with it."""
    with _connection(database_path) as connection:
        board_id = _accessible_column_board_id(connection, user_id, column_id)
        if board_id is None:
            return None
        connection.execute("DELETE FROM columns WHERE id = ?", (column_id,))
        _rewrite_positions(
            connection,
            "columns",
            "board_id",
            board_id,
            _ordered_ids(connection, "columns", "board_id", board_id),
        )
        return _board_data(connection, board_id)


def move_column(
    database_path: Path, user_id: str, column_id: str, target_position: int
) -> BoardRecord | None:
    with _connection(database_path) as connection:
        board_id = _accessible_column_board_id(connection, user_id, column_id)
        if board_id is None:
            return None
        column_ids = _ordered_ids(connection, "columns", "board_id", board_id)
        column_ids.remove(column_id)
        column_ids.insert(min(target_position, len(column_ids)), column_id)
        _rewrite_positions(connection, "columns", "board_id", board_id, column_ids)
        return _board_data(connection, board_id)


def create_card(
    database_path: Path,
    user_id: str,
    column_id: str,
    title: str,
    details: str,
) -> CardRecord | None:
    with _connection(database_path) as connection:
        column = connection.execute(
            f"""
            SELECT columns.id
            FROM columns
            WHERE columns.id = ?
              AND columns.board_id IN ({ACCESSIBLE_BOARD_IDS})
            """,
            (column_id, user_id, user_id),
        ).fetchone()
        if column is None:
            return None

        position = connection.execute(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE column_id = ?",
            (column_id,),
        ).fetchone()[0]
        card_id = _new_id("card")
        connection.execute(
            """
            INSERT INTO cards (id, column_id, title, details, position)
            VALUES (?, ?, ?, ?, ?)
            """,
            (card_id, column_id, title, details, position),
        )
        row = connection.execute(
            f"SELECT {CARD_FIELDS} FROM cards WHERE id = ?", (card_id,)
        ).fetchone()
        return _card_data(row)


def card_board_id(database_path: Path, user_id: str, card_id: str) -> str | None:
    """The board a card sits on, or None when the user cannot reach it."""
    with _connection(database_path) as connection:
        row = connection.execute(
            f"""
            SELECT columns.board_id
            FROM cards
            JOIN columns ON columns.id = cards.column_id
            WHERE cards.id = ?
              AND columns.board_id IN ({ACCESSIBLE_BOARD_IDS})
            """,
            (card_id, user_id, user_id),
        ).fetchone()
        return None if row is None else row["board_id"]


def update_card(
    database_path: Path,
    user_id: str,
    card_id: str,
    changes: dict[str, object],
) -> CardRecord | None:
    with _connection(database_path) as connection:
        row = connection.execute(
            f"""
            SELECT cards.id
            FROM cards
            JOIN columns ON columns.id = cards.column_id
            WHERE cards.id = ?
              AND columns.board_id IN ({ACCESSIBLE_BOARD_IDS})
            """,
            (card_id, user_id, user_id),
        ).fetchone()
        if row is None:
            return None

        fields = [field for field in CARD_UPDATES if field in changes]
        assignments = ", ".join(f"{CARD_UPDATES[field]} = ?" for field in fields)
        values = [
            json.dumps(changes[field]) if field == "labels" else changes[field]
            for field in fields
        ]
        connection.execute(
            f"UPDATE cards SET {assignments} WHERE id = ?", (*values, card_id)
        )
        updated = connection.execute(
            f"SELECT {CARD_FIELDS} FROM cards WHERE id = ?", (card_id,)
        ).fetchone()
        return _card_data(updated)


def _rewrite_positions(
    connection: sqlite3.Connection,
    table: str,
    parent_field: str,
    parent_id: str,
    row_ids: list[str],
) -> None:
    """Renumber `row_ids` to 0..n-1 within one parent, in the order given.

    `UNIQUE (parent, position)` rules out writing the final positions directly,
    so the whole group is first shifted past the current maximum. `table` and
    `parent_field` are module-local literals, never caller input.
    """
    if not row_ids:
        return
    maximum = connection.execute(
        f"SELECT COALESCE(MAX(position), 0) FROM {table} WHERE {parent_field} = ?",
        (parent_id,),
    ).fetchone()[0]
    offset = maximum + len(row_ids) + 1
    connection.execute(
        f"UPDATE {table} SET position = position + ? WHERE {parent_field} = ?",
        (offset, parent_id),
    )
    for position, row_id in enumerate(row_ids):
        connection.execute(
            f"UPDATE {table} SET position = ? WHERE id = ? AND {parent_field} = ?",
            (position, row_id, parent_id),
        )


def _ordered_ids(
    connection: sqlite3.Connection, table: str, parent_field: str, parent_id: str
) -> list[str]:
    return [
        row["id"]
        for row in connection.execute(
            f"SELECT id FROM {table} WHERE {parent_field} = ? ORDER BY position",
            (parent_id,),
        ).fetchall()
    ]


def delete_card(database_path: Path, user_id: str, card_id: str) -> bool:
    with _connection(database_path) as connection:
        row = connection.execute(
            f"""
            SELECT cards.column_id
            FROM cards
            JOIN columns ON columns.id = cards.column_id
            WHERE cards.id = ?
              AND columns.board_id IN ({ACCESSIBLE_BOARD_IDS})
            """,
            (card_id, user_id, user_id),
        ).fetchone()
        if row is None:
            return False

        column_id = row["column_id"]
        connection.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        _rewrite_positions(
            connection,
            "cards",
            "column_id",
            column_id,
            _ordered_ids(connection, "cards", "column_id", column_id),
        )
        return True


def move_card(
    database_path: Path,
    user_id: str,
    card_id: str,
    target_column_id: str,
    target_position: int,
) -> BoardRecord | None:
    with _connection(database_path) as connection:
        card = connection.execute(
            f"""
            SELECT cards.column_id
            FROM cards
            JOIN columns ON columns.id = cards.column_id
            WHERE cards.id = ?
              AND columns.board_id IN ({ACCESSIBLE_BOARD_IDS})
            """,
            (card_id, user_id, user_id),
        ).fetchone()
        target = connection.execute(
            f"""
            SELECT columns.id, columns.board_id
            FROM columns
            WHERE columns.id = ?
              AND columns.board_id IN ({ACCESSIBLE_BOARD_IDS})
            """,
            (target_column_id, user_id, user_id),
        ).fetchone()
        if card is None or target is None:
            return None

        source_column_id = card["column_id"]
        source_ids = _ordered_ids(connection, "cards", "column_id", source_column_id)

        if source_column_id == target_column_id:
            source_ids.remove(card_id)
            source_ids.insert(min(target_position, len(source_ids)), card_id)
            _rewrite_positions(
                connection, "cards", "column_id", source_column_id, source_ids
            )
        else:
            destination_ids = _ordered_ids(
                connection, "cards", "column_id", target_column_id
            )
            source_ids.remove(card_id)
            destination_ids.insert(
                min(target_position, len(destination_ids)), card_id
            )
            maximum = connection.execute(
                "SELECT COALESCE(MAX(position), 0) FROM cards WHERE column_id = ?",
                (target_column_id,),
            ).fetchone()[0]
            temporary_position = maximum + len(destination_ids) + 1
            connection.execute(
                "UPDATE cards SET column_id = ?, position = ? WHERE id = ?",
                (target_column_id, temporary_position, card_id),
            )
            _rewrite_positions(
                connection, "cards", "column_id", source_column_id, source_ids
            )
            _rewrite_positions(
                connection, "cards", "column_id", target_column_id, destination_ids
            )

        board_id = target["board_id"]
        return _board_data(connection, board_id)


COMMENT_FIELDS = """
    card_comments.id,
    card_comments.body,
    card_comments.user_id AS author_id,
    users.display_name AS author_name,
    card_comments.created_at
"""

# A comment is reachable exactly when its card's board is. Takes the user id
# twice, for the two halves of ACCESSIBLE_BOARD_IDS.
_REACHABLE_CARD = f"""
    SELECT cards.id
    FROM cards
    JOIN columns ON columns.id = cards.column_id
    WHERE columns.board_id IN ({ACCESSIBLE_BOARD_IDS})
"""


def _comment_data(row: sqlite3.Row) -> CommentRecord:
    return {
        "id": row["id"],
        "body": row["body"],
        "author_id": row["author_id"],
        "author_name": row["author_name"],
        "created_at": row["created_at"],
    }


def list_card_comments(
    database_path: Path, user_id: str, card_id: str
) -> list[CommentRecord] | None:
    """A card's comments oldest first, or None when the card is out of reach.

    Ordered by rowid, not `created_at`: that is only second-resolution and ids
    are random, so two comments posted in the same second would sort at random.
    """
    with _connection(database_path) as connection:
        if not _card_is_reachable(connection, user_id, card_id):
            return None
        rows = connection.execute(
            f"""
            SELECT {COMMENT_FIELDS}
            FROM card_comments
            JOIN users ON users.id = card_comments.user_id
            WHERE card_comments.card_id = ?
            ORDER BY card_comments.rowid
            """,
            (card_id,),
        ).fetchall()
        return [_comment_data(row) for row in rows]


def create_card_comment(
    database_path: Path, user_id: str, card_id: str, body: str
) -> CommentRecord | None:
    with _connection(database_path) as connection:
        if not _card_is_reachable(connection, user_id, card_id):
            return None
        comment_id = _new_id("comment")
        connection.execute(
            """
            INSERT INTO card_comments (id, card_id, user_id, body, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (comment_id, card_id, user_id, body, _now()),
        )
        row = connection.execute(
            f"""
            SELECT {COMMENT_FIELDS}
            FROM card_comments
            JOIN users ON users.id = card_comments.user_id
            WHERE card_comments.id = ?
            """,
            (comment_id,),
        ).fetchone()
        return _comment_data(row)


def delete_card_comment(
    database_path: Path, user_id: str, comment_id: str
) -> bool:
    """Delete one's own comment. Someone else's is left alone, as is unreachable."""
    with _connection(database_path) as connection:
        cursor = connection.execute(
            f"""
            DELETE FROM card_comments
            WHERE id = ?
              AND user_id = ?
              AND card_id IN ({_REACHABLE_CARD})
            """,
            (comment_id, user_id, user_id, user_id),
        )
        return cursor.rowcount == 1


def _card_is_reachable(
    connection: sqlite3.Connection, user_id: str, card_id: str
) -> bool:
    return (
        connection.execute(
            f"SELECT 1 FROM ({_REACHABLE_CARD}) WHERE id = ?",
            (user_id, user_id, card_id),
        ).fetchone()
        is not None
    )


def list_assignments(database_path: Path, user_id: str) -> list[AssignmentRecord]:
    """Every card assigned to a user, across all the boards they can open.

    Soonest due first. `due_date = ''` sorts first as text, so it is ordered on
    separately to put undated cards last.
    """
    with _connection(database_path) as connection:
        rows = connection.execute(
            f"""
            SELECT cards.id AS card_id, cards.title, cards.priority,
                   cards.due_date, boards.id AS board_id,
                   boards.name AS board_name,
                   columns.title AS column_title
            FROM cards
            JOIN columns ON columns.id = cards.column_id
            JOIN boards ON boards.id = columns.board_id
            WHERE cards.assignee_id = ?
              AND columns.board_id IN ({ACCESSIBLE_BOARD_IDS})
            ORDER BY cards.due_date = '', cards.due_date,
                     boards.created_at, columns.position, cards.position
            """,
            (user_id, user_id, user_id),
        ).fetchall()
        return [
            {
                "card_id": row["card_id"],
                "title": row["title"],
                "priority": row["priority"],
                "dueDate": row["due_date"],
                "board_id": row["board_id"],
                "board_name": row["board_name"],
                "column_title": row["column_title"],
            }
            for row in rows
        ]
