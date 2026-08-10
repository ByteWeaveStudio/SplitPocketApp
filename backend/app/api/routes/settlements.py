"""Cash that changed hands outside the app.

A settlement is the only write that moves a balance without an expense behind
it, so both directions of it — recording and un-recording — leave a trace.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import AuthenticatedUser, get_current_user
from app.db.pool import get_pool
from app.schemas.groups import SettlementCreate, SettlementOut
from app.services.group_access import (
    display_name,
    fetch_group_for_member,
    fetch_members,
    log_activity,
    member_role,
)

router = APIRouter()

CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]

_SETTLEMENT_RETURNING = """
    id::text, group_id::text as group_id,
    from_user_id::text as from_user_id, to_user_id::text as to_user_id,
    amount_minor, currency, note, settled_at, created_at
"""


@router.post("/groups/{group_id}/settlements", status_code=status.HTTP_201_CREATED)
async def record_settlement(
    group_id: UUID, payload: SettlementCreate, user: CurrentUser
) -> SettlementOut:
    if payload.from_user_id == payload.to_user_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Payer and receiver must differ."
        )
    if user.id not in (str(payload.from_user_id), str(payload.to_user_id)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You can only record settlements you're part of."
        )
    pool = get_pool()
    async with pool.connection() as conn:
        group = await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
        member_ids = {m.user_id for m in members}
        if not {str(payload.from_user_id), str(payload.to_user_id)} <= member_ids:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Both people must be members of the group.",
            )
        async with conn.transaction():
            cursor = await conn.execute(
                f"""
                insert into public.settlements
                    (group_id, from_user_id, to_user_id, amount_minor, currency, note, settled_at)
                values (%s, %s, %s, %s, %s, %s, coalesce(%s, now()))
                returning {_SETTLEMENT_RETURNING}
                """,
                (
                    group_id,
                    payload.from_user_id,
                    payload.to_user_id,
                    payload.amount_minor,
                    group["currency"],
                    payload.note,
                    payload.settled_at,
                ),
            )
            settlement = await cursor.fetchone()
            assert settlement is not None
            await log_activity(
                conn,
                group_id,
                user.id,
                "settlement.recorded",
                _detail(settlement, members, group["currency"]),
            )
    return SettlementOut(**settlement)


@router.delete("/settlements/{settlement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_settlement(settlement_id: UUID, user: CurrentUser) -> None:
    """Undo a recorded payment.

    20260807110000 revoked the client's DELETE on this table: deleting a
    settlement puts a debt back on someone else's balance, and doing that
    silently is how a group ends up arguing about the app instead of the money.
    """
    pool = get_pool()
    async with pool.connection() as conn:
        cursor = await conn.execute(
            f"select {_SETTLEMENT_RETURNING} from public.settlements where id = %s",
            (settlement_id,),
        )
        settlement = await cursor.fetchone()
        if settlement is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Settlement not found.")
        group_id = UUID(settlement["group_id"])
        await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
        involved = user.id in (settlement["from_user_id"], settlement["to_user_id"])
        if not involved and member_role(members, user.id) != "owner":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Only the people in a settlement, or a group owner, can delete it.",
            )
        async with conn.transaction():
            await conn.execute(
                "delete from public.settlements where id = %s", (settlement_id,)
            )
            await log_activity(
                conn,
                group_id,
                user.id,
                "settlement.deleted",
                _detail(settlement, members, settlement["currency"]),
            )


def _detail(settlement: dict, members: list, currency: str) -> dict:
    return {
        "fromName": display_name(members, settlement["from_user_id"]),
        "toName": display_name(members, settlement["to_user_id"]),
        "amountMinor": settlement["amount_minor"],
        "currency": currency,
    }
