from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError
from jose import jwt

from app.core.config import ALGORITHM, SECRET_KEY


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Return True if plain_password matches the stored bcrypt hash."""
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


def get_password_hash(password: str) -> str:
    """Return a bcrypt hash (cost=12) for the given password."""
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt(rounds=12),
    ).decode("utf-8")


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """Encode a JWT with an expiry timestamp."""
    payload = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=60)
    )
    payload["exp"] = expire
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Decode and validate a JWT access token.

    Expiry is validated manually with timezone-aware UTC datetimes to avoid
    deprecated utcnow usage inside third-party validation paths.
    """
    payload = jwt.decode(
        token,
        SECRET_KEY,
        algorithms=[ALGORITHM],
        options={"verify_exp": False},
    )

    exp = payload.get("exp")
    if exp is None:
        raise JWTError("Token is missing exp claim")

    try:
        exp_dt = datetime.fromtimestamp(float(exp), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError) as exc:
        raise JWTError("Token has invalid exp claim") from exc

    if exp_dt <= datetime.now(timezone.utc):
        raise JWTError("Token has expired")

    return payload