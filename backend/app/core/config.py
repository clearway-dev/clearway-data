import os

_DEFAULT_SECRET = "dev-secret-key-change-in-production"

# JWT configuration — read from environment variables.
SECRET_KEY: str = os.getenv("SECRET_KEY", _DEFAULT_SECRET)
ALGORITHM: str = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8 hours

# Refuse to start in production with the default insecure key.
_DEBUG = os.getenv("DEBUG", "false").lower() in ("1", "true", "yes")
if SECRET_KEY == _DEFAULT_SECRET and not _DEBUG:
    raise RuntimeError(
        "SECRET_KEY is set to the insecure default. "
        "Set the SECRET_KEY environment variable before running in production."
    )

