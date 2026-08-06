"""Shared fixtures.

Tests never read backend/.env: the `settings` fixture builds an isolated
Settings object (no env file, no DATABASE_URL, HS256 JWT secret) and patches
it into every module that imported `get_settings`, so the suite runs the same
with or without a configured Supabase project.
"""

import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings

TEST_JWT_SECRET = "unit-test-secret-not-a-real-key-0123456789"
TEST_USER_ID = "11111111-1111-4111-8111-111111111111"

# Every module that does `from app.core.config import get_settings` holds its
# own reference; patch each so no test path falls back to the real .env.
_SETTINGS_CONSUMERS = [
    "app.core.config",
    "app.core.security",
    "app.db.pool",
    "app.main",
    "app.api.routes.health",
]


def make_token(
    sub: str = TEST_USER_ID,
    *,
    secret: str = TEST_JWT_SECRET,
    audience: str = "authenticated",
    expires_in: int = 3600,
    email: str = "tester@example.com",
) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "aud": audience,
        "email": email,
        "iat": now,
        "exp": now + expires_in,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    test_settings = Settings(
        _env_file=None,
        environment="test",
        supabase_url=None,
        supabase_secret_key=None,
        supabase_jwt_secret=TEST_JWT_SECRET,
        database_url=None,
    )
    for module in _SETTINGS_CONSUMERS:
        monkeypatch.setattr(f"{module}.get_settings", lambda: test_settings)
    return test_settings


@pytest.fixture
def client(settings: Settings) -> TestClient:
    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token()}"}
