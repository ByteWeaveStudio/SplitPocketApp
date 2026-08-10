"""Shared expenses: splits, line items, and the conversation around them.

Like app/api/routes/groups.py these run over DATABASE_URL and therefore
bypass RLS — membership is proved in code, per request.
"""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import AsyncConnection

from app.core.security import AuthenticatedUser, get_current_user
from app.db.pool import get_pool
from app.schemas.groups import (
    CommentCreate,
    CommentOut,
    GroupExpenseCreate,
    GroupExpenseOut,
    MemberOut,
)
from app.services.group_access import (
    EXPENSE_RETURNING,
    SPLIT_RETURNING,
    assert_can_edit_expense,
    display_name,
    expense_detail,
    fetch_expense_items,
    fetch_group_expense,
    fetch_group_for_member,
    fetch_members,
    log_activity,
    member_role,
)
from app.services.splits import (
    ComputedSplit,
    LineItem,
    ParticipantShare,
    compute_itemized_splits,
    compute_splits,
)

router = APIRouter()

CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]


# ---------------------------------------------------------------------------
# Validation and persistence helpers
# ---------------------------------------------------------------------------


def _resolve_payer(payload: GroupExpenseCreate, members: list[MemberOut], fallback: str) -> str:
    payer = str(payload.paid_by) if payload.paid_by is not None else fallback
    if payer not in {m.user_id for m in members}:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "The payer must be a member of the group.",
        )
    return payer


async def _validated_splits(
    conn: AsyncConnection,
    members: list[MemberOut],
    user: CurrentUser,
    payload: GroupExpenseCreate,
) -> list[ComputedSplit]:
    member_ids = {m.user_id for m in members}
    if payload.method == "itemized":
        named = {str(uid) for item in payload.items for uid in item.participant_ids}
    else:
        named = {str(p.user_id) for p in payload.participants}
    if not named <= member_ids:
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
        if payload.method == "itemized":
            return compute_itemized_splits(
                payload.amount_minor,
                [
                    LineItem(
                        item.description.strip(),
                        item.amount_minor,
                        tuple(str(uid) for uid in item.participant_ids),
                    )
                    for item in payload.items
                ],
            )
        return compute_splits(
            payload.method,
            payload.amount_minor,
            [
                ParticipantShare(
                    str(p.user_id), p.owed_minor, p.share_basis_points, p.share_units
                )
                for p in payload.participants
            ],
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


async def _insert_splits(
    conn: AsyncConnection, expense_id: str, method: str, computed: list[ComputedSplit]
) -> list[dict[str, Any]]:
    rows = []
    for split in computed:
        cursor = await conn.execute(
            f"""
            insert into public.expense_splits
                (expense_id, user_id, owed_minor, share_basis_points, share_units, method)
            values (%s, %s, %s, %s, %s, %s)
            returning {SPLIT_RETURNING}
            """,
            (
                expense_id,
                split.user_id,
                split.owed_minor,
                split.share_basis_points,
                split.share_units,
                method,
            ),
        )
        row = await cursor.fetchone()
        assert row is not None
        rows.append(row)
    return rows


async def _insert_items(
    conn: AsyncConnection, expense_id: str, payload: GroupExpenseCreate
) -> None:
    """Store the line items an itemized split was derived from.

    expense_splits stays the ledger; these rows exist so the edit screen can
    show the bill again instead of a flattened list of totals.
    """
    for position, item in enumerate(payload.items):
        cursor = await conn.execute(
            """
            insert into public.expense_items (expense_id, description, amount_minor, position)
            values (%s, %s, %s, %s) returning id::text
            """,
            (expense_id, item.description.strip(), item.amount_minor, position),
        )
        row = await cursor.fetchone()
        assert row is not None
        for user_id in item.participant_ids:
            await conn.execute(
                "insert into public.expense_item_shares (item_id, user_id) values (%s, %s)",
                (row["id"], user_id),
            )


# ---------------------------------------------------------------------------
# Group expenses
# ---------------------------------------------------------------------------


@router.post("/groups/{group_id}/expenses", status_code=status.HTTP_201_CREATED)
async def create_group_expense(
    group_id: UUID, payload: GroupExpenseCreate, user: CurrentUser
) -> GroupExpenseOut:
    pool = get_pool()
    async with pool.connection() as conn:
        group = await fetch_group_for_member(conn, group_id, user.id)
        if group["archived_at"] is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This group is archived.")
        members = await fetch_members(conn, group_id)
        payer = _resolve_payer(payload, members, user.id)
        computed = await _validated_splits(conn, members, user, payload)

        async with conn.transaction():
            cursor = await conn.execute(
                f"""
                insert into public.expenses
                    (user_id, group_id, paid_by, category_id, description, amount_minor,
                     currency, date, kind, notes)
                values (%s, %s, %s, %s, %s, %s, %s, %s, 'expense', %s)
                returning {EXPENSE_RETURNING}
                """,
                (
                    user.id,
                    group_id,
                    payer,
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
            if payload.method == "itemized":
                await _insert_items(conn, expense["id"], payload)
            await log_activity(
                conn, group_id, user.id, "expense.added", expense_detail(expense, members)
            )
        items = await fetch_expense_items(conn, expense["id"])
    return GroupExpenseOut(**expense, splits=splits, items=items)


@router.put("/expenses/{expense_id}")
async def update_group_expense(
    expense_id: UUID, payload: GroupExpenseCreate, user: CurrentUser
) -> GroupExpenseOut:
    pool = get_pool()
    async with pool.connection() as conn:
        existing = await fetch_group_expense(conn, expense_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found.")
        group_id, members = await assert_can_edit_expense(conn, existing, user.id)
        payer = _resolve_payer(payload, members, existing["paid_by"])
        computed = await _validated_splits(conn, members, user, payload)

        async with conn.transaction():
            cursor = await conn.execute(
                f"""
                update public.expenses
                set category_id = %s, description = %s, amount_minor = %s,
                    date = %s, notes = %s, paid_by = %s
                where id = %s
                returning {EXPENSE_RETURNING}
                """,
                (
                    payload.category_id,
                    payload.description.strip(),
                    payload.amount_minor,
                    payload.date,
                    payload.notes,
                    payer,
                    expense_id,
                ),
            )
            expense = await cursor.fetchone()
            assert expense is not None
            await conn.execute(
                "delete from public.expense_splits where expense_id = %s", (expense_id,)
            )
            splits = await _insert_splits(conn, expense["id"], payload.method, computed)
            # Items cascade from their own rows, so a method change away from
            # itemized has to clear them or the edit screen would reopen a bill
            # that no longer describes the split.
            await conn.execute(
                "delete from public.expense_items where expense_id = %s", (expense_id,)
            )
            if payload.method == "itemized":
                await _insert_items(conn, expense["id"], payload)
            await log_activity(
                conn, group_id, user.id, "expense.updated", expense_detail(expense, members)
            )
        items = await fetch_expense_items(conn, expense["id"])
    return GroupExpenseOut(**expense, splits=splits, items=items)


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group_expense(expense_id: UUID, user: CurrentUser) -> None:
    """Delete a shared expense.

    20260807110000 narrowed the client's delete policy to personal rows, so
    this is the only way a group expense goes away — which is what makes the
    "someone deleted the hotel booking" entry in the feed reliable.
    """
    pool = get_pool()
    async with pool.connection() as conn:
        existing = await fetch_group_expense(conn, expense_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found.")
        group_id, members = await assert_can_edit_expense(conn, existing, user.id)
        async with conn.transaction():
            await conn.execute("delete from public.expenses where id = %s", (expense_id,))
            await log_activity(
                conn, group_id, user.id, "expense.deleted", expense_detail(existing, members)
            )


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


async def _expense_for_comment(
    conn: AsyncConnection, expense_id: UUID, user_id: str
) -> dict[str, Any]:
    expense = await fetch_group_expense(conn, expense_id)
    if expense is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found.")
    # Membership, not authorship: anyone sharing the bill can discuss it.
    await fetch_group_for_member(conn, UUID(expense["group_id"]), user_id)
    return expense


@router.get("/expenses/{expense_id}/comments")
async def list_comments(expense_id: UUID, user: CurrentUser) -> list[CommentOut]:
    pool = get_pool()
    async with pool.connection() as conn:
        await _expense_for_comment(conn, expense_id, user.id)
        cursor = await conn.execute(
            """
            select id::text, expense_id::text as expense_id, user_id::text as user_id,
                   body, created_at, updated_at
            from public.expense_comments where expense_id = %s order by created_at
            """,
            (expense_id,),
        )
        rows = await cursor.fetchall()
    return [CommentOut(**row) for row in rows]


@router.post("/expenses/{expense_id}/comments", status_code=status.HTTP_201_CREATED)
async def create_comment(
    expense_id: UUID, payload: CommentCreate, user: CurrentUser
) -> CommentOut:
    pool = get_pool()
    async with pool.connection() as conn:
        expense = await _expense_for_comment(conn, expense_id, user.id)
        group_id = UUID(expense["group_id"])
        members = await fetch_members(conn, group_id)
        async with conn.transaction():
            cursor = await conn.execute(
                """
                insert into public.expense_comments (expense_id, user_id, body)
                values (%s, %s, %s)
                returning id::text, expense_id::text as expense_id, user_id::text as user_id,
                          body, created_at, updated_at
                """,
                (expense_id, user.id, payload.body.strip()),
            )
            comment = await cursor.fetchone()
            assert comment is not None
            await log_activity(
                conn,
                group_id,
                user.id,
                "comment.added",
                {
                    "expenseId": str(expense_id),
                    "description": expense["description"],
                    "authorName": display_name(members, user.id),
                },
            )
    return CommentOut(**comment)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(comment_id: UUID, user: CurrentUser) -> None:
    pool = get_pool()
    async with pool.connection() as conn:
        cursor = await conn.execute(
            """
            select c.user_id::text as author_id, e.group_id::text as group_id
            from public.expense_comments c
            join public.expenses e on e.id = c.expense_id
            where c.id = %s
            """,
            (comment_id,),
        )
        comment = await cursor.fetchone()
        if comment is None or comment["group_id"] is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found.")
        group_id = UUID(comment["group_id"])
        await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
        # Your own words, or an owner clearing something out of the thread.
        if comment["author_id"] != user.id and member_role(members, user.id) != "owner":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Only the author or a group owner can delete this."
            )
        await conn.execute("delete from public.expense_comments where id = %s", (comment_id,))
