import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, TypedDict


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

DEFAULT_USERNAME = "user"
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


class CardRecord(TypedDict):
    id: str
    title: str
    details: str


class ColumnRecord(TypedDict):
    id: str
    title: str
    cardIds: list[str]


class BoardRecord(TypedDict):
    columns: list[ColumnRecord]
    cards: dict[str, CardRecord]


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


def initialize_database(database_path: Path) -> None:
    with _connection(database_path) as connection:
        connection.executescript(SCHEMA)
        user = connection.execute(
            "SELECT id FROM users WHERE username = ?", (DEFAULT_USERNAME,)
        ).fetchone()
        if user is None:
            user_id = _new_id("user")
            connection.execute(
                "INSERT INTO users (id, username) VALUES (?, ?)",
                (user_id, DEFAULT_USERNAME),
            )
        else:
            user_id = user["id"]

        board = connection.execute(
            "SELECT id FROM boards WHERE user_id = ?", (user_id,)
        ).fetchone()
        if board is None:
            board_id = _new_id("board")
            connection.execute(
                "INSERT INTO boards (id, user_id) VALUES (?, ?)",
                (board_id, user_id),
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
                        INSERT INTO cards
                            (id, column_id, title, details, position)
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


def get_user_id(database_path: Path, username: str) -> str | None:
    with _connection(database_path) as connection:
        row = connection.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        return row["id"] if row else None


def _board_id(connection: sqlite3.Connection, user_id: str) -> str | None:
    row = connection.execute(
        "SELECT id FROM boards WHERE user_id = ?", (user_id,)
    ).fetchone()
    return row["id"] if row else None


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
            """
            SELECT id, title, details
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
        result["cards"].update(
            {
                card["id"]: {
                    "id": card["id"],
                    "title": card["title"],
                    "details": card["details"],
                }
                for card in cards
            }
        )
    return result


def get_board(database_path: Path, user_id: str) -> BoardRecord | None:
    with _connection(database_path) as connection:
        board_id = _board_id(connection, user_id)
        return _board_data(connection, board_id) if board_id else None


def replace_board(
    database_path: Path, user_id: str, board_data: BoardRecord
) -> BoardRecord | None:
    with _connection(database_path) as connection:
        board_id = _board_id(connection, user_id)
        if board_id is None:
            return None

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
                    INSERT INTO cards (id, column_id, title, details, position)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        card["id"],
                        column["id"],
                        card["title"],
                        card["details"],
                        card_position,
                    ),
                )
        return _board_data(connection, board_id)


def rename_column(
    database_path: Path, user_id: str, column_id: str, title: str
) -> bool:
    with _connection(database_path) as connection:
        cursor = connection.execute(
            """
            UPDATE columns
            SET title = ?
            WHERE id = ?
              AND board_id = (SELECT id FROM boards WHERE user_id = ?)
            """,
            (title, column_id, user_id),
        )
        return cursor.rowcount == 1


def _card_data(row: sqlite3.Row) -> CardRecord:
    return {"id": row["id"], "title": row["title"], "details": row["details"]}


def create_card(
    database_path: Path,
    user_id: str,
    column_id: str,
    title: str,
    details: str,
) -> CardRecord | None:
    with _connection(database_path) as connection:
        column = connection.execute(
            """
            SELECT columns.id
            FROM columns
            JOIN boards ON boards.id = columns.board_id
            WHERE columns.id = ? AND boards.user_id = ?
            """,
            (column_id, user_id),
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
            "SELECT id, title, details FROM cards WHERE id = ?", (card_id,)
        ).fetchone()
        return _card_data(row)


def update_card(
    database_path: Path,
    user_id: str,
    card_id: str,
    changes: dict[str, str],
) -> CardRecord | None:
    with _connection(database_path) as connection:
        row = connection.execute(
            """
            SELECT cards.id, cards.title, cards.details
            FROM cards
            JOIN columns ON columns.id = cards.column_id
            JOIN boards ON boards.id = columns.board_id
            WHERE cards.id = ? AND boards.user_id = ?
            """,
            (card_id, user_id),
        ).fetchone()
        if row is None:
            return None

        fields = [field for field in ("title", "details") if field in changes]
        assignments = ", ".join(f"{field} = ?" for field in fields)
        connection.execute(
            f"UPDATE cards SET {assignments} WHERE id = ?",
            (*(changes[field] for field in fields), card_id),
        )
        updated = connection.execute(
            "SELECT id, title, details FROM cards WHERE id = ?", (card_id,)
        ).fetchone()
        return _card_data(updated)


def _rewrite_positions(
    connection: sqlite3.Connection, column_id: str, card_ids: list[str]
) -> None:
    if not card_ids:
        return
    maximum = connection.execute(
        "SELECT COALESCE(MAX(position), 0) FROM cards WHERE column_id = ?",
        (column_id,),
    ).fetchone()[0]
    offset = maximum + len(card_ids) + 1
    connection.execute(
        "UPDATE cards SET position = position + ? WHERE column_id = ?",
        (offset, column_id),
    )
    for position, card_id in enumerate(card_ids):
        connection.execute(
            "UPDATE cards SET position = ? WHERE id = ? AND column_id = ?",
            (position, card_id, column_id),
        )


def delete_card(database_path: Path, user_id: str, card_id: str) -> bool:
    with _connection(database_path) as connection:
        row = connection.execute(
            """
            SELECT cards.column_id
            FROM cards
            JOIN columns ON columns.id = cards.column_id
            JOIN boards ON boards.id = columns.board_id
            WHERE cards.id = ? AND boards.user_id = ?
            """,
            (card_id, user_id),
        ).fetchone()
        if row is None:
            return False

        column_id = row["column_id"]
        connection.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        remaining_ids = [
            item["id"]
            for item in connection.execute(
                "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
                (column_id,),
            ).fetchall()
        ]
        _rewrite_positions(connection, column_id, remaining_ids)
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
            """
            SELECT cards.column_id
            FROM cards
            JOIN columns ON columns.id = cards.column_id
            JOIN boards ON boards.id = columns.board_id
            WHERE cards.id = ? AND boards.user_id = ?
            """,
            (card_id, user_id),
        ).fetchone()
        target = connection.execute(
            """
            SELECT columns.id, columns.board_id
            FROM columns
            JOIN boards ON boards.id = columns.board_id
            WHERE columns.id = ? AND boards.user_id = ?
            """,
            (target_column_id, user_id),
        ).fetchone()
        if card is None or target is None:
            return None

        source_column_id = card["column_id"]
        source_ids = [
            row["id"]
            for row in connection.execute(
                "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
                (source_column_id,),
            ).fetchall()
        ]
        destination_ids = (
            source_ids
            if source_column_id == target_column_id
            else [
                row["id"]
                for row in connection.execute(
                    "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
                    (target_column_id,),
                ).fetchall()
            ]
        )

        if source_column_id == target_column_id:
            source_ids.remove(card_id)
            source_ids.insert(min(target_position, len(source_ids)), card_id)
            _rewrite_positions(connection, source_column_id, source_ids)
        else:
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
            _rewrite_positions(connection, source_column_id, source_ids)
            _rewrite_positions(connection, target_column_id, destination_ids)

        board_id = target["board_id"]
        return _board_data(connection, board_id)
