from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Anchored to backend/.env so settings load regardless of the CWD uvicorn runs from.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    # Defaults to production: a deploy that forgets to set ENVIRONMENT should
    # lose /docs and /openapi.json, not publish them.
    environment: str = "production"
    # An origin is an exact string match, not a host: localhost, 127.0.0.1 and
    # [::1] are three different origins even though they are one machine. Vite
    # binds the IPv6 loopback on macOS and prints http://[::1]:5173/ as the URL
    # to click, so that form has to be listed too or the browser's preflight
    # comes back 400 "Disallowed CORS origin". All of these are loopback — they
    # are unreachable from another host, so listing them costs nothing.
    cors_origins: list[str] = [
        "http://localhost:5173",  # Vite dev server
        "http://127.0.0.1:5173",  # Vite dev server via loopback IP
        "http://[::1]:5173",  # Vite dev server via IPv6 loopback
        "http://localhost:4173",  # Vite preview (production build, PWA testing)
        "http://127.0.0.1:4173",  # Vite preview via loopback IP
        "http://[::1]:4173",  # Vite preview via IPv6 loopback
        "capacitor://localhost",  # iOS app scheme
        "https://localhost",  # Android app scheme (Capacitor defaults to https)
    ]

    supabase_url: str | None = None
    # Secret API key (sb_secret_...); bypasses RLS. Never expose to clients.
    supabase_secret_key: str | None = None
    # Only for legacy projects signing JWTs with a shared HS256 secret;
    # projects on the current API keys verify via JWKS and don't need this.
    supabase_jwt_secret: str | None = None
    # Direct Postgres connection, used for migrations and direct SQL.
    database_url: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
