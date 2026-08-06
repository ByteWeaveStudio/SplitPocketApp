"""Group, shared-expense, settlement, and balance endpoints.

These run over DATABASE_URL (bypasses RLS), so every handler scopes its
queries by the JWT-verified caller and validates membership explicitly.
"""

from typing import Annotated, Any
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import AsyncConnection

from app.core.security import AuthenticatedUser, get_current_user
from app.db.pool import get_pool
from app.schemas.groups import (
    AddMemberRequest,
    GroupBalancesOut,
    GroupCreate,
    GroupExpenseCreate,
    GroupExpenseOut,
    GroupOut,
    MemberBalance,
    MemberOut,
    MyBalancesOut,
    MyGroupBalance,
    SettlementCreate,
    SettlementOut,
    SuggestedSettlement,
)
from app.services.balances import compute_net, simplify_debts
from app.services.splits import ParticipantShare, compute_splits

router = APIRouter()

CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]

_GROUP_COLUMNS = """
    g.id::text, g.name, g.description, g.currency,
    g.created_by::text as created_by, g.created_at, g.archived_at
"""

_EXPENSE_RETURNING = """
    id::text, user_id::text as user_id, group_id::text as group_id,
    category_id::text as category_id, description, amount_minor, currency,
    date, kind, notes, created_at, updated_at
"""

_SPLIT_RETURNING = """
    id::text, expense_id::text as expense_id, user_id::text as user_id,
    owed_minor, share_basis_points, method
"""


async def _fetch_group_for_member(
    conn: AsyncConnection, group_id: UUID, user_id: str
) -> dict[str, Any]:
    cursor = await conn.execute(
        f"""
        select {_GROUP_COLUMNS},
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


async def _fetch_members(conn: AsyncConnection, group_id: UUID | str) -> list[MemberOut]:
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


def _member_role(members: list[MemberOut], user_id: str) -> str | None:
    return next((m.role for m in members if m.user_id == user_id), None)


@router.post("/groups", status_code=status.HTTP_201_CREATED)
async def create_group(payload: GroupCreate, user: CurrentUser) -> GroupOut:
    pool = get_pool()
    async with pool.connection() as conn:
        async with conn.transaction():
            try:
                cursor = await conn.execute(
                    f"""
                    insert into public.groups (name, description, currency, created_by)
                    values (%s, %s, %s, %s)
                    returning {_GROUP_COLUMNS.replace("g.", "")}
                    """,
                    (payload.name.strip(), payload.description, payload.currency, user.id),
                )
            except psycopg.errors.ForeignKeyViolation as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    f"Unsupported currency: {payload.currency}.",
                ) from exc
            group = await cursor.fetchone()
            assert group is not None
            await conn.execute(
                "insert into public.group_members (group_id, user_id, role)"
                " values (%s, %s, 'owner')",
                (group["id"], user.id),
            )
        members = await _fetch_members(conn, group["id"])
    return GroupOut(**group, members=members)


@router.post("/groups/{group_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(group_id: UUID, payload: AddMemberRequest, user: CurrentUser) -> MemberOut:
    email = payload.email.strip().lower()
    pool = get_pool()
    async with pool.connection() as conn:
        group = await _fetch_group_for_member(conn, group_id, user.id)
        if group["archived_at"] is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This group is archived.")
        cursor = await conn.execute(
            "select id::text as id from public.profiles where lower(email) = %s", (email,)
        )
        profile = await cursor.fetchone()
        if profile is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "No SplitPocket account uses that email. Ask them to sign up first.",
            )
        try:
            await conn.execute(
                "insert into public.group_members (group_id, user_id, role)"
                " values (%s, %s, 'member')",
                (group_id, profile["id"]),
            )
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "They're already in this group."
            ) from exc
        members = await _fetch_members(conn, group_id)
    member = next(m for m in members if m.user_id == profile["id"])
    return member


@router.delete("/groups/{group_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(group_id: UUID, member_id: UUID, user: CurrentUser) -> None:
    pool = get_pool()
    async with pool.connection() as conn:
        await _fetch_group_for_member(conn, group_id, user.id)
        members = await _fetch_members(conn, group_id)
        my_role = _member_role(members, user.id)
        target_role = _member_role(members, str(member_id))
        if target_role is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "They're not in this group.")

        leaving_self = str(member_id) == user.id
        if leaving_self:
            other_owners = any(
                m.role == "owner" and m.user_id != user.id for m in members
            )
            if my_role == "owner" and len(members) > 1 and not other_owners:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "You're the only owner — make someone else an owner before leaving.",
                )
        else:
            if my_role != "owner":
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN, "Only owners can remove members."
                )
            if target_role == "owner":
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, "Owners can't remove other owners."
                )

        async with conn.transaction():
            await conn.execute(
                "delete from public.group_members where group_id = %s and user_id = %s",
                (group_id, member_id),
            )
            if leaving_self and len(members) == 1:
                # Last member out — an empty group is just clutter.
                await conn.execute("delete from public.groups where id = %s", (group_id,))


@router.get("/groups/{group_id}/balances")
async def group_balances(group_id: UUID, user: CurrentUser) -> GroupBalancesOut:
    pool = get_pool()
    async with pool.connection() as conn:
        group = await _fetch_group_for_member(conn, group_id, user.id)
        members = await _fetch_members(conn, group_id)
        net = await _compute_group_net(conn, group_id, [m.user_id for m in members])
    return GroupBalancesOut(
        group_id=group["id"],
        currency=group["currency"],
        members=[MemberBalance(user_id=uid, net_minor=value) for uid, value in net.items()],
        suggested_settlements=[
            SuggestedSettlement(
                from_user_id=t.from_user_id, to_user_id=t.to_user_id, amount_minor=t.amount_minor
            )
            for t in simplify_debts(net)
        ],
    )


async def _compute_group_net(
    conn: AsyncConnection, group_id: UUID, member_ids: list[str]
) -> dict[str, int]:
    cursor = await conn.execute(
        "select user_id::text as payer, amount_minor from public.expenses where group_id = %s",
        (group_id,),
    )
    expenses = [(row["payer"], row["amount_minor"]) for row in await cursor.fetchall()]
    cursor = await conn.execute(
        """
        select s.user_id::text as user_id, s.owed_minor
        from public.expense_splits s
        join public.expenses e on e.id = s.expense_id
        where e.group_id = %s
        """,
        (group_id,),
    )
    splits = [(row["user_id"], row["owed_minor"]) for row in await cursor.fetchall()]
    cursor = await conn.execute(
        """
        select from_user_id::text as from_id, to_user_id::text as to_id, amount_minor
        from public.settlements where group_id = %s
        """,
        (group_id,),
    )
    settlements = [
        (row["from_id"], row["to_id"], row["amount_minor"]) for row in await cursor.fetchall()
    ]
    return compute_net(member_ids, expenses, splits, settlements)


async def _validated_splits(
    conn: AsyncConnection,
    group_id: UUID,
    user: CurrentUser,
    payload: GroupExpenseCreate,
) -> list:
    members = await _fetch_members(conn, group_id)
    member_ids = {m.user_id for m in members}
    participant_ids = {str(p.user_id) for p in payload.participants}
    if not participant_ids <= member_ids:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Everyone in the split must be a member of the group.",
        )
    if payload.category_id is not None:
        cursor = await conn.execute(
            "select 1 from public.categories where id = %s and (user_id is null or user_id = %s)",
            (payload.category_id, user.id),
        )
        if await cursor.fetchone() is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown category.")
    try:
        return compute_splits(
            payload.method,
            payload.amount_minor,
            [
                ParticipantShare(str(p.user_id), p.owed_minor, p.share_basis_points)
                for p in payload.participants
            ],
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


async def _insert_splits(
    conn: AsyncConnection, expense_id: str, method: str, computed: list
) -> list[dict[str, Any]]:
    rows = []
    for split in computed:
        cursor = await conn.execute(
            f"""
            insert into public.expense_splits
                (expense_id, user_id, owed_minor, share_basis_points, method)
            values (%s, %s, %s, %s, %s)
            returning {_SPLIT_RETURNING}
            """,
            (expense_id, split.user_id, split.owed_minor, split.share_basis_points, method),
        )
        row = await cursor.fetchone()
        assert row is not None
        rows.append(row)
    return rows


@router.post("/groups/{group_id}/expenses", status_code=status.HTTP_201_CREATED)
async def create_group_expense(
    group_id: UUID, payload: GroupExpenseCreate, user: CurrentUser
) -> GroupExpenseOut:
    pool = get_pool()
    async with pool.connection() as conn:
        group = await _fetch_group_for_member(conn, group_id, user.id)
        if group["archived_at"] is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This group is archived.")
        computed = await _validated_splits(conn, group_id, user, payload)
        async with conn.transaction():
            cursor = await conn.execute(
                f"""
                insert into public.expenses
                    (user_id, group_id, category_id, description, amount_minor,
                     currency, date, kind, notes)
                values (%s, %s, %s, %s, %s, %s, %s, 'expense', %s)
                returning {_EXPENSE_RETURNING}
                """,
                (
                    user.id,
                    group_id,
                    payload.category_id,
                    payload.description.strip(),
                    payload.amount_minor,
                    group["currency"],
                    payload.date,
                    payload.notes,
                ),
            )
            expense = await cursor.fetchone()
            assert expense is not None
            splits = await _insert_splits(conn, expense["id"], payload.method, computed)
    return GroupExpenseOut(**expense, splits=splits)


@router.put("/expenses/{expense_id}")
async def update_group_expense(
    expense_id: UUID, payload: GroupExpenseCreate, user: CurrentUser
) -> GroupExpenseOut:
    pool = get_pool()
    async with pool.connection() as conn:
        cursor = await conn.execute(
            f"""
            select {_EXPENSE_RETURNING}
            from public.expenses where id = %s and group_id is not null
            """,
            (expense_id,),
        )
        existing = await cursor.fetchone()
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found.")
        if existing["user_id"] != user.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Only the person who added an expense can edit it."
            )
        group_id = UUID(existing["group_id"])
        computed = await _validated_splits(conn, group_id, user, payload)
        async with conn.transaction():
            cursor = await conn.execute(
                f"""
                update public.expenses
                set category_id = %s, description = %s, amount_minor = %s,
                    date = %s, notes = %s
                where id = %s
                returning {_EXPENSE_RETURNING}
                """,
                (
                    payload.category_id,
                    payload.description.strip(),
                    payload.amount_minor,
                    payload.date,
                    payload.notes,
                    expense_id,
                ),
            )
            expense = await cursor.fetchone()
            assert expense is not None
            await conn.execute(
                "delete from public.expense_splits where expense_id = %s", (expense_id,)
            )
            splits = await _insert_splits(conn, expense["id"], payload.method, computed)
    return GroupExpenseOut(**expense, splits=splits)


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
        group = await _fetch_group_for_member(conn, group_id, user.id)
        members = await _fetch_members(conn, group_id)
        member_ids = {m.user_id for m in members}
        if not {str(payload.from_user_id), str(payload.to_user_id)} <= member_ids:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Both people must be members of the group.",
            )
        cursor = await conn.execute(
            """
            insert into public.settlements
                (group_id, from_user_id, to_user_id, amount_minor, currency, note, settled_at)
            values (%s, %s, %s, %s, %s, %s, coalesce(%s, now()))
            returning id::text, group_id::text as group_id,
                      from_user_id::text as from_user_id, to_user_id::text as to_user_id,
                      amount_minor, currency, note, settled_at, created_at
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
    return SettlementOut(**settlement)


@router.get("/me/balances")
async def my_balances(user: CurrentUser) -> MyBalancesOut:
    pool = get_pool()
    async with pool.connection() as conn:
        cursor = await conn.execute(
            """
            with my_groups as (
                select g.id, g.name, g.currency
                from public.groups g
                join public.group_members m on m.group_id = g.id
                where m.user_id = %(uid)s and g.archived_at is null
            ),
            paid as (
                select group_id, sum(amount_minor) as total
                from public.expenses
                where user_id = %(uid)s and group_id is not null
                group by group_id
            ),
            owed as (
                select e.group_id, sum(s.owed_minor) as total
                from public.expense_splits s
                join public.expenses e on e.id = s.expense_id
                where s.user_id = %(uid)s and e.group_id is not null
                group by e.group_id
            ),
            sent as (
                select group_id, sum(amount_minor) as total
                from public.settlements where from_user_id = %(uid)s group by group_id
            ),
            received as (
                select group_id, sum(amount_minor) as total
                from public.settlements where to_user_id = %(uid)s group by group_id
            )
            select mg.id::text as group_id, mg.name as group_name, mg.currency,
                   coalesce(paid.total, 0) - coalesce(owed.total, 0)
                   + coalesce(sent.total, 0) - coalesce(received.total, 0) as net_minor
            from my_groups mg
            left join paid on paid.group_id = mg.id
            left join owed on owed.group_id = mg.id
            left join sent on sent.group_id = mg.id
            left join received on received.group_id = mg.id
            order by mg.name
            """,
            {"uid": user.id},
        )
        rows = await cursor.fetchall()
    return MyBalancesOut(balances=[MyGroupBalance(**row) for row in rows])
