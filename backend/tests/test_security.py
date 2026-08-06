"""Unit tests for Supabase JWT verification (app.core.security), HS256 path."""

import jwt
import pytest

from app.core.security import decode_token
from tests.conftest import TEST_USER_ID, make_token


def test_valid_token_decodes_to_claims(settings):
    claims = decode_token(make_token())
    assert claims["sub"] == TEST_USER_ID
    assert claims["email"] == "tester@example.com"
    assert claims["aud"] == "authenticated"


def test_expired_token_rejected(settings):
    token = make_token(expires_in=-60)
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_token(token)


def test_wrong_audience_rejected(settings):
    token = make_token(audience="anon")
    with pytest.raises(jwt.InvalidAudienceError):
        decode_token(token)


def test_tampered_signature_rejected(settings):
    token = make_token(secret="a-different-secret-padded-to-32-bytes!!")
    with pytest.raises(jwt.InvalidSignatureError):
        decode_token(token)


def test_hs256_without_configured_secret_rejected(settings):
    settings.supabase_jwt_secret = None
    with pytest.raises(jwt.InvalidTokenError, match="SUPABASE_JWT_SECRET"):
        decode_token(make_token())


def test_garbage_token_rejected(settings):
    with pytest.raises(jwt.PyJWTError):
        decode_token("not-a-jwt")
