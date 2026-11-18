import pytest

from security import ALGORITHM, hash_password, verify_password


def test_hash_is_salted_and_verifies_the_original_password():
    first = hash_password("hunter2hunter2")
    second = hash_password("hunter2hunter2")

    # A fresh salt per call means the same password never hashes identically.
    assert first != second
    assert first.startswith(f"{ALGORITHM}$")
    assert "hunter2hunter2" not in first
    assert verify_password("hunter2hunter2", first)
    assert verify_password("hunter2hunter2", second)


def test_verify_rejects_the_wrong_password():
    assert not verify_password("wrong", hash_password("hunter2hunter2"))
    assert not verify_password("", hash_password("hunter2hunter2"))


def test_verify_reads_the_iteration_count_recorded_in_the_hash(monkeypatch):
    """An old hash stays verifiable after the iteration count is raised."""
    import security

    monkeypatch.setattr(security, "ITERATIONS", 1_000)
    encoded = security.hash_password("hunter2hunter2")
    assert encoded.split("$")[1] == "1000"

    monkeypatch.setattr(security, "ITERATIONS", 2_000)
    assert security.verify_password("hunter2hunter2", encoded)


@pytest.mark.parametrize(
    "encoded",
    [
        "",
        "not-a-hash",
        "pbkdf2_sha256$1000$onlythreeparts",
        "bcrypt$1000$abcd$efgh",  # unsupported algorithm
        "pbkdf2_sha256$notanumber$abcd$efgh",
        "pbkdf2_sha256$1000$nothex!$efgh",
    ],
)
def test_verify_rejects_malformed_hashes_without_raising(encoded):
    assert not verify_password("hunter2hunter2", encoded)
