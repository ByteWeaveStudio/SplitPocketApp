from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.core.security import AuthenticatedUser, get_current_user
from app.services.supabase import get_supabase_admin

router = APIRouter()


class MeResponse(BaseModel):
    id: str
    email: str | None
    full_name: str | None
    avatar_url: str | None
    default_currency: str | None


async def _fetch_profile(user_id: str) -> dict[str, Any] | None:
    client = await get_supabase_admin()
    try:
        result = (
            await client.table("profiles")
            .select("email, full_name, avatar_url, default_currency")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except APIError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Profile lookup failed — is the database schema migrated? "
                "Run: uv run python -m app.db.migrate"
            ),
        ) from exc
    return result.data[0] if result.data else None


@router.get("/me")
async def read_me(user: Annotated[AuthenticatedUser, Depends(get_current_user)]) -> MeResponse:
    """Return the authenticated user's identity and profile."""
    profile = await _fetch_profile(user.id) or {}
    return MeResponse(
        id=user.id,
        email=profile.get("email") or user.email,
        full_name=profile.get("full_name"),
        avatar_url=profile.get("avatar_url"),
        default_currency=profile.get("default_currency"),
    )
