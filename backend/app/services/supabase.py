from supabase import AsyncClient, acreate_client

from app.core.config import get_settings

_client: AsyncClient | None = None


async def get_supabase_admin() -> AsyncClient:
    """Async service-role client. Bypasses RLS — server-side use only."""
    global _client
    if _client is None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_secret_key:
            raise RuntimeError(
                "Supabase is not configured. Copy backend/.env.example to backend/.env "
                "and set SUPABASE_URL and SUPABASE_SECRET_KEY."
            )
        _client = await acreate_client(settings.supabase_url, settings.supabase_secret_key)
    return _client
