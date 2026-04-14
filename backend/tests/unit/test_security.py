"""
Unit tests for app.core.security
Covers: password hashing, password verification, JWT creation and decoding.
No database, no network, no external services.
"""
from datetime import datetime, timedelta, timezone

import pytest
from jose import JWTError, jwt

# conftest.py sets SECRET_KEY + DEBUG env vars before this import.
from app.core.config import ALGORITHM, SECRET_KEY
from app.core.security import (
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)


# ===========================================================================
# Password hashing
# ===========================================================================

class TestGetPasswordHash:
    """get_password_hash: output type, format, and uniqueness."""

    def test_returns_string(self):
        assert isinstance(get_password_hash("password"), str)

    def test_result_is_bcrypt_format(self):
        h = get_password_hash("password")
        # bcrypt hashes produced with cost=12 always start with $2b$12$
        assert h.startswith("$2b$12$")

    def test_same_password_produces_different_hashes(self):
        """bcrypt salts each hash — two calls must never collide."""
        h1 = get_password_hash("same")
        h2 = get_password_hash("same")
        assert h1 != h2

    def test_empty_password_produces_valid_hash(self):
        h = get_password_hash("")
        assert h.startswith("$2b$")

    @pytest.mark.parametrize("password", [
        "short",
        "a" * 72,           # bcrypt max meaningful length
        "unicode-ěščřžý",
        "with spaces here",
        "!@#$%^&*()",
        "1234567890",
    ])
    def test_various_passwords_produce_valid_hash(self, password):
        h = get_password_hash(password)
        assert h.startswith("$2b$")


class TestVerifyPassword:
    """verify_password: correct, wrong, empty, and edge inputs."""

    def test_correct_password_returns_true(self):
        pw = "correct-horse-battery-staple"
        assert verify_password(pw, get_password_hash(pw)) is True

    def test_wrong_password_returns_false(self):
        assert verify_password("wrong", get_password_hash("correct")) is False

    def test_similar_password_returns_false(self):
        assert verify_password("password123", get_password_hash("password124")) is False

    def test_empty_password_matches_empty_hash(self):
        assert verify_password("", get_password_hash("")) is True

    def test_empty_password_does_not_match_nonempty_hash(self):
        assert verify_password("", get_password_hash("notempty")) is False

    def test_nonempty_password_does_not_match_empty_hash(self):
        assert verify_password("notempty", get_password_hash("")) is False

    def test_case_sensitive(self):
        assert verify_password("Password", get_password_hash("password")) is False

    @pytest.mark.parametrize("password", [
        "unicode-ěščřžý",
        "with spaces here",
        "!@#$%^&*()",
        "a" * 72,
    ])
    def test_round_trip_various_passwords(self, password):
        assert verify_password(password, get_password_hash(password)) is True


# ===========================================================================
# JWT token creation
# ===========================================================================

class TestCreateAccessToken:
    """create_access_token: structure, claims, expiry, and failure modes."""

    # --- Basic structure ---

    def test_returns_string(self):
        assert isinstance(create_access_token({"sub": "user@example.com"}), str)

    def test_jwt_has_three_dot_separated_parts(self):
        token = create_access_token({"sub": "user@example.com"})
        assert token.count(".") == 2

    # --- Payload round-trip ---

    def test_sub_claim_preserved(self):
        token = create_access_token({"sub": "user@example.com"})
        decoded = decode_access_token(token)
        assert decoded["sub"] == "user@example.com"

    def test_role_claim_preserved(self):
        token = create_access_token({"sub": "x", "role": "admin"})
        decoded = decode_access_token(token)
        assert decoded["role"] == "admin"

    def test_exp_claim_is_present(self):
        token = create_access_token({"sub": "x"})
        decoded = decode_access_token(token)
        assert "exp" in decoded

    def test_original_dict_not_mutated(self):
        """create_access_token copies data — caller's dict must be unchanged."""
        data = {"sub": "user@example.com", "role": "user"}
        original = data.copy()
        create_access_token(data)
        assert data == original

    @pytest.mark.parametrize("extra_claims", [
        {"role": "admin"},
        {"user_id": 42},
        {"custom": "value", "numeric": 99},
    ])
    def test_extra_claims_preserved(self, extra_claims):
        token = create_access_token({"sub": "x", **extra_claims})
        decoded = decode_access_token(token)
        for key, value in extra_claims.items():
            assert decoded[key] == value

    # --- Expiry: default ---

    def test_default_expiry_is_approximately_60_minutes(self):
        before = datetime.now(timezone.utc)
        token = create_access_token({"sub": "x"})
        after = datetime.now(timezone.utc)

        decoded = decode_access_token(token)
        exp = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)

        # Allow ±5 s of test-execution slack
        assert before + timedelta(minutes=60) - timedelta(seconds=5) <= exp
        assert exp <= after + timedelta(minutes=60) + timedelta(seconds=5)

    # --- Expiry: custom delta ---

    def test_custom_expires_delta_is_used(self):
        delta = timedelta(minutes=15)
        before = datetime.now(timezone.utc)
        token = create_access_token({"sub": "x"}, expires_delta=delta)
        after = datetime.now(timezone.utc)

        decoded = decode_access_token(token)
        exp = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)

        assert before + delta - timedelta(seconds=5) <= exp
        assert exp <= after + delta + timedelta(seconds=5)

    def test_very_short_delta(self):
        """1-hour token: payload still decodable immediately after creation."""
        token = create_access_token({"sub": "x"}, expires_delta=timedelta(hours=1))
        decoded = decode_access_token(token)
        assert decoded["sub"] == "x"

    # --- Failure modes ---

    def test_expired_token_raises_jwt_error(self):
        token = create_access_token({"sub": "x"}, expires_delta=timedelta(seconds=-1))
        with pytest.raises(JWTError):
            decode_access_token(token)

    def test_wrong_secret_key_raises_jwt_error(self):
        token = jwt.encode(
            {
                "sub": "x",
                "exp": datetime.now(timezone.utc) + timedelta(minutes=60),
            },
            "completely-wrong-key",
            algorithm=ALGORITHM,
        )
        with pytest.raises(JWTError):
            decode_access_token(token)

    def test_corrupted_signature_raises_jwt_error(self):
        token = create_access_token({"sub": "x"})
        corrupted = token[:-5] + "XXXXX"
        with pytest.raises(JWTError):
            decode_access_token(corrupted)

    def test_garbage_string_raises_jwt_error(self):
        with pytest.raises(JWTError):
            decode_access_token("not.a.valid.jwt.at.all")

    def test_empty_string_raises_jwt_error(self):
        with pytest.raises(JWTError):
            decode_access_token("")

    def test_wrong_algorithm_raises_jwt_error(self):
        token = jwt.encode(
            {
                "sub": "x",
                "exp": datetime.now(timezone.utc) + timedelta(minutes=60),
            },
            SECRET_KEY,
            algorithm="HS512",
        )
        with pytest.raises(JWTError):
            decode_access_token(token)
