import hashlib
import hmac
import secrets

ALGORITHM = "pbkdf2_sha256"
# OWASP's 2023 floor for PBKDF2-HMAC-SHA256.
ITERATIONS = 600_000
SALT_BYTES = 16


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt, ITERATIONS
    )
    return f"{ALGORITHM}${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    parts = encoded.split("$")
    if len(parts) != 4:
        return False
    algorithm, iterations, salt_hex, digest_hex = parts
    if algorithm != ALGORITHM or not iterations.isdigit():
        return False
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt, int(iterations)
    )
    return hmac.compare_digest(digest.hex(), digest_hex)
