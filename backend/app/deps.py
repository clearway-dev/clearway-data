import time
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.database import get_db
from app.models import User
from app.schemas import TokenData

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login/access-token")

# Cache: email → (User, timestamp). Re-verified against the DB on cache miss.
# User deactivation takes effect with up to TTL-second delay.
_user_cache: dict[str, tuple[User, float]] = {}
_USER_CACHE_TTL = 300


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Decode the JWT and return the matching User row. Raises 401 on any failure."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        email: str | None = payload.get("sub")
        role: str | None = payload.get("role")
        if email is None:
            raise credentials_exception
        token_data = TokenData(email=email, role=role)
    except JWTError:
        raise credentials_exception

    cached = _user_cache.get(token_data.email)
    if cached and time.time() - cached[1] < _USER_CACHE_TTL:
        return cached[0]

    user = db.query(User).filter(User.email == token_data.email).first()
    if user is None:
        raise credentials_exception

    _user_cache[token_data.email] = (user, time.time())
    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Raise 400 if the account is deactivated."""
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user.")
    return current_user


def require_admin(current_user: User = Depends(get_current_active_user)) -> User:
    """Raise 403 if the authenticated user does not have the 'admin' role."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )
    return current_user