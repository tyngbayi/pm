import sqlite3

from database import SCHEMA, SCHEMA_VERSION, authenticate_user, initialize_database


def _legacy_database(path):
    """Build a v0 file: the original schema, before users carried credentials."""
    connection = sqlite3.connect(path)
    connection.executescript(SCHEMA)
    connection.execute(
        "INSERT INTO users (id, username) VALUES ('user-legacy', 'user')"
    )
    connection.execute(
        "INSERT INTO boards (id, user_id) VALUES ('board-legacy', 'user-legacy')"
    )
    connection.execute(
        """
        INSERT INTO columns (id, board_id, title, position)
        VALUES ('col-legacy', 'board-legacy', 'Backlog', 0)
        """
    )
    connection.execute(
        """
        INSERT INTO cards (id, column_id, title, details, position)
        VALUES ('card-legacy', 'col-legacy', 'Existing work', 'Keep me', 0)
        """
    )
    connection.commit()
    connection.close()


def test_migration_upgrades_a_legacy_database_without_losing_data(tmp_path):
    database_path = tmp_path / "kanban.db"
    _legacy_database(database_path)

    initialize_database(database_path)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    user = connection.execute(
        "SELECT * FROM users WHERE id = 'user-legacy'"
    ).fetchone()
    card = connection.execute(
        "SELECT title, priority, due_date, labels, assignee_id FROM cards"
        " WHERE id = 'card-legacy'"
    ).fetchone()
    board = connection.execute(
        "SELECT name FROM boards WHERE id = 'board-legacy'"
    ).fetchone()
    connection.close()

    # Rebuilding `boards` in migration 2 drops the parent table, so this proves
    # the rebuild ran with foreign keys off rather than cascading the card away.
    assert card["title"] == "Existing work"
    assert (card["priority"], card["due_date"], card["labels"]) == (
        "medium",
        "",
        "[]",
    )
    assert card["assignee_id"] is None
    assert board["name"] == "My board"
    assert user["role"] == "admin"
    assert user["password_hash"]
    assert authenticate_user(database_path, "user", "password") is not None


def test_initialize_database_is_idempotent(tmp_path):
    database_path = tmp_path / "kanban.db"
    initialize_database(database_path)
    first = authenticate_user(database_path, "user", "password")

    initialize_database(database_path)

    connection = sqlite3.connect(database_path)
    users = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    boards = connection.execute("SELECT COUNT(*) FROM boards").fetchone()[0]
    connection.close()

    assert (users, boards) == (1, 1)
    assert authenticate_user(database_path, "user", "password") == first
