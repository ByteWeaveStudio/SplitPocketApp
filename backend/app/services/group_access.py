"""Shared group plumbing for the API routes.

Every handler in app/api/routes/ runs over DATABASE_URL, which bypasses RLS.
That makes membership a thing each handler must prove rather than something
the database enforces, so the checks live here once instead of being restated
(and eventually mis-stated) per endpoint.
"""

from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

from app.schemas.groups import ExpenseItemOut, MemberOut

GROUP_COLUMNS = """
    g.id::text, g.name, g.description, g.currency,
    g.created_by::text as created_by, g.created_at, g.archived_at
"""

EXPENSE_RETURNING = """
    id::text, user_id::text as user_id, group_id::text as group_id,
    paid_by::text as paid_by, category_id::text as category_id, description,
    amount_minor, currency, date, kind, notes, created_at, updated_at
"""

SPLIT_RETURNING = """
    id::text, expense_id::text as expense_id, user_id::text as user_id,
    owed_minor, share_basis_points, share_units, method
"""


async def fetch_group_for_member(
    conn: AsyncConnection, group_id: UUID, user_id: str
) -> dict[str, Any]:
    cursor = await conn.execute(
        f"""
        select {GROUP_COLUMNS},
               exists(select 1 from public.group_members m
                      where m.group_id = g.id and m.user_id = %s) as is_member
        from public.groups g where g.id = %s
        """,
        (user_id, group_id),
    )
    group = await cursor.fetchone()
    # 404 for non-members too: don't leak which group ids exist.
    if group is None or not group.pop("is_member"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    return group


async def fetch_members(conn: AsyncConnection, group_id: UUID | str) -> list[MemberOut]:
    cursor = await conn.execute(
        """
        select m.user_id::text as user_id, m.role, m.joined_at,
               p.email, p.full_name, p.avatar_url
        from public.group_members m
        join public.profiles p on p.id = m.user_id
        where m.group_id = %s
        order by m.joined_at
        """,
        (group_id,),
    )
    return [MemberOut(**row) for row in await cursor.fetchall()]


def member_role(members: list[MemberOut], user_id: str) -> str | None:
    return next((m.role for m in members if m.user_id == user_id), None)


def require_owner(members: list[MemberOut], user_id: str, action: str) -> None:
    if member_role(members, user_id) != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Only owners can {action}.")


def display_name(members: list[MemberOut], user_id: str | None) -> str:
    """A name to freeze into an activity row.

    The feed has to stay readable after the person leaves the group, so the
    label is copied at write time rather than joined at read time.
    """
    if user_id is None:
        return "Someone"
    member = next((m for m in members if m.user_id == user_id), None)
    if member is None:
        return "A former member"
    return (member.full_name or "").strip() or member.email


async def log_activity(
    conn: AsyncConnection,
    group_id: UUID | str,
    actor_id: str | None,
    kind: str,
    detail: dict[str, Any] | None = None,
) -> None:
    """Append one entry to a group's history.

    Called inside the same transaction as the change it describes, so a feed
    entry can never survive a rolled-back write (or go missing after a
    committed one).
    """
    await conn.execute(
        """
        insert into public.group_activity (group_id, actor_id, kind, detail)
        values (%s, %s, %s, %s)
        """,
        (group_id, actor_id, kind, Jsonb(detail or {})),
    )


async def fetch_expense_items(
    conn: AsyncConnection, expense_id: UUID | str
) -> list[ExpenseItemOut]:
    cursor = await conn.execute(
        """
        select i.id::text as id, i.description, i.amount_minor, i.position,
               coalesce(
                 array_agg(s.user_id::text order by s.user_id)
                   filter (where s.user_id is not null),
                 '{}'
               ) as participant_ids
        from public.expense_items i
        left join public.expense_item_shares s on s.item_id = i.id
        where i.expense_id = %s
        group by i.id, i.description, i.amount_minor, i.position, i.created_at
        order by i.position, i.created_at
        """,
        (expense_id,),
    )
    return [ExpenseItemOut(**row) for row in await cursor.fetchall()]


async def fetch_group_expense(
    conn: AsyncConnection, expense_id: UUID
) -> dict[str, Any] | None:
    cursor = await conn.execute(
        f"""
        select {EXPENSE_RETURNING}
        from public.expenses where id = %s and group_id is not null
        """,
        (expense_id,),
    )
    return await cursor.fetchone()


async def assert_can_edit_expense(
    conn: AsyncConnection, expense: dict[str, Any], user_id: str
) -> tuple[UUID, list[MemberOut]]:
    """Membership, archive state and authorship checks for an expense write.

    Re-checked on every edit, not just at creation: leaving (or being removed
    from) a group has to revoke write access to the expenses added while
    inside it, otherwise the id stays a live handle on the group's ledger.
    """
    group_id = UUID(expense["group_id"])
    cursor = await conn.execute(
        """
        select g.archived_at
        from public.groups g
        join public.group_members m on m.group_id = g.id and m.user_id = %s
        where g.id = %s
        """,
        (user_id, group_id),
    )
    group = await cursor.fetchone()
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found.")

    members = await fetch_members(conn, group_id)
    # The person who recorded it, or an owner. v1 was creator-only, which left
    # a group unable to fix a typo made by someone who has since left.
    if expense["user_id"] != user_id and member_role(members, user_id) != "owner":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the person who added an expense, or a group owner, can change it.",
        )
    if group["archived_at"] is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This group is archived.")
    return group_id, members


def expense_detail(expense: dict[str, Any], members: list[MemberOut]) -> dict[str, Any]:
    """The denormalized payload stored on an expense activity entry."""
    return {
        "expenseId": expense["id"],
        "description": expense["description"],
        "amountMinor": expense["amount_minor"],
        "currency": expense["currency"],
        "paidByName": display_name(members, expense.get("paid_by")),
    }
