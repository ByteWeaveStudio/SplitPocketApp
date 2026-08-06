"""Async Postgres pool for business-logic endpoints.

Connects with DATABASE_URL (the postgres role), which bypasses RLS — every
query MUST scope by the JWT-verified user, exactly like service-key access.
"""

from fastapi import HTTPException, status
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import get_settings

_pool: AsyncConnectionPool | None = None


async def open_pool() -> None:
    """Called from the app lifespan. No-op when DATABASE_URL isn't set."""
    global _pool
    settings = get_settings()
    if _pool is not None or not settings.database_url:
        return
    _pool = AsyncConnectionPool(
        settings.database_url,
        min_size=1,
        max_size=5,
        kwargs={"row_factory": dict_row},
        open=False,
    )
    await _pool.open()


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> AsyncConnectionPool:
    if _pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not configured. Set DATABASE_URL in backend/.env.",
        )
    return _pool
