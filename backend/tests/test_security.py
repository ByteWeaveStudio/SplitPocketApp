"""Unit tests for Supabase JWT verification (app.core.security), HS256 path."""

import time

import jwt
import pytest

from app.core.security import decode_token
from tests.conftest import TEST_JWT_SECRET, TEST_USER_ID, make_token


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


def _encode(claims: dict, *, algorithm: str = "HS256") -> str:
    return jwt.encode(claims, TEST_JWT_SECRET, algorithm=algorithm)


def _base_claims(**overrides) -> dict:
    now = int(time.time())
    claims = {
        "sub": TEST_USER_ID,
        "aud": "authenticated",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return claims


def test_token_without_exp_rejected(settings):
    """An unexpiring token is a permanent credential; `require` must catch it."""
    claims = _base_claims()
    del claims["exp"]
    with pytest.raises(jwt.MissingRequiredClaimError):
        decode_token(_encode(claims))


def test_token_without_sub_rejected_as_jwt_error(settings):
    """Missing `sub` must fail verification, not KeyError downstream into a 500."""
    claims = _base_claims()
    del claims["sub"]
    with pytest.raises(jwt.MissingRequiredClaimError):
        decode_token(_encode(claims))


def test_alg_none_rejected(settings):
    """The header must not be able to select 'no signature'."""
    token = jwt.encode(_base_claims(), key="", algorithm="none")
    with pytest.raises(jwt.PyJWTError):
        decode_token(token)


def test_wrong_issuer_rejected(settings):
    settings.supabase_url = "https://project.supabase.co"
    claims = _base_claims(iss="https://attacker.example/auth/v1")
    with pytest.raises(jwt.InvalidIssuerError):
        decode_token(_encode(claims))


def test_missing_issuer_rejected_when_url_configured(settings):
    settings.supabase_url = "https://project.supabase.co"
    with pytest.raises(jwt.MissingRequiredClaimError):
        decode_token(_encode(_base_claims()))


def test_matching_issuer_accepted(settings):
    settings.supabase_url = "https://project.supabase.co"
    claims = _base_claims(iss="https://project.supabase.co/auth/v1")
    assert decode_token(_encode(claims))["sub"] == TEST_USER_ID
