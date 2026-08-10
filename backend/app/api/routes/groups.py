"""Groups, membership, invites, activity, presets, and balances.

These run over DATABASE_URL (bypasses RLS), so every handler scopes its
queries by the JWT-verified caller and validates membership explicitly.
"""

import hashlib
import secrets
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

from app.core.security import AuthenticatedUser, get_current_user
from app.db.pool import get_pool
from app.schemas.groups import (
    ActivityOut,
    ActivityPageOut,
    AddMemberRequest,
    GroupBalancesOut,
    GroupCreate,
    GroupOut,
    GroupUpdate,
    InviteCreate,
    InviteOut,
    InvitePreviewOut,
    InviteTokenIn,
    MemberBalance,
    MemberOut,
    MemberRoleUpdate,
    MyBalancesOut,
    MyGroupBalance,
    SplitPresetCreate,
    SplitPresetOut,
    SuggestedSettlement,
)
from app.services.balances import compute_net, simplify_debts
from app.services.group_access import (
    GROUP_COLUMNS,
    display_name,
    fetch_group_for_member,
    fetch_members,
    log_activity,
    member_role,
    require_owner,
)

router = APIRouter()

CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------


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
                    returning {GROUP_COLUMNS.replace("g.", "")}
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
            await log_activity(
                conn, group["id"], user.id, "group.created", {"groupName": group["name"]}
            )
        members = await fetch_members(conn, group["id"])
    return GroupOut(**group, members=members)


@router.patch("/groups/{group_id}")
async def update_group(group_id: UUID, payload: GroupUpdate, user: CurrentUser) -> GroupOut:
    """Rename, re-describe, or archive a group. Owners only.

    20260806120000_privilege_hardening.sql revoked UPDATE on public.groups from
    authenticated on the grounds that "group edits belong on the API" -- this is
    that endpoint. It exists so name/description/archived_at stay reachable
    while created_by and currency remain server-owned.
    """
    fields = payload.model_fields_set
    if not fields:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing to update.")

    pool = get_pool()
    async with pool.connection() as conn:
        before = await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
        require_owner(members, user.id, "change a group's details")

        assignments: list[str] = []
        params: list[Any] = []
        if "name" in fields:
            if payload.name is None or not payload.name.strip():
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, "A group needs a name."
                )
            assignments.append("name = %s")
            params.append(payload.name.strip())
        if "description" in fields:
            assignments.append("description = %s")
            params.append(payload.description)
        if "archived" in fields:
            # Boolean in, timestamp out: the column records when, the API takes
            # whether, so clients never have to invent a timestamp.
            assignments.append("archived_at = case when %s then now() else null end")
            params.append(bool(payload.archived))

        params.append(group_id)
        async with conn.transaction():
            cursor = await conn.execute(
                f"""
                update public.groups set {", ".join(assignments)}
                where id = %s
                returning {GROUP_COLUMNS.replace("g.", "")}
                """,
                tuple(params),
            )
            group = await cursor.fetchone()
            assert group is not None

            if "name" in fields and group["name"] != before["name"]:
                await log_activity(
                    conn,
                    group_id,
                    user.id,
                    "group.renamed",
                    {"from": before["name"], "to": group["name"]},
                )
            if "archived" in fields and (group["archived_at"] is not None) != (
                before["archived_at"] is not None
            ):
                await log_activity(
                    conn,
                    group_id,
                    user.id,
                    "group.archived" if payload.archived else "group.unarchived",
                    {"groupName": group["name"]},
                )
        members = await fetch_members(conn, group_id)
    return GroupOut(**group, members=members)


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------


@router.post("/groups/{group_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(group_id: UUID, payload: AddMemberRequest, user: CurrentUser) -> MemberOut:
    email = payload.email.strip().lower()
    pool = get_pool()
    async with pool.connection() as conn:
        group = await fetch_group_for_member(conn, group_id, user.id)
        if group["archived_at"] is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This group is archived.")
        # Resolve against auth.users, not profiles.email: the profiles copy is
        # a mirror the account holder can edit, so matching on it let anyone
        # claim someone else's address and be invited in their place. This
        # assumes email confirmation stays enabled on the Supabase project --
        # an unconfirmed signup is the same spoof one layer down.
        cursor = await conn.execute(
            """
            select p.id::text as id
            from public.profiles p
            join auth.users u on u.id = p.id
            where lower(u.email) = %s
            """,
            (email,),
        )
        profile = await cursor.fetchone()
        if profile is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "No SplitPocket account uses that email. Ask them to sign up first, "
                "or send them an invite link.",
            )
        try:
            async with conn.transaction():
                await conn.execute(
                    "insert into public.group_members (group_id, user_id, role)"
                    " values (%s, %s, 'member')",
                    (group_id, profile["id"]),
                )
                members = await fetch_members(conn, group_id)
                await log_activity(
                    conn,
                    group_id,
                    user.id,
                    "member.added",
                    {"memberName": display_name(members, profile["id"])},
                )
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "They're already in this group."
            ) from exc
    return next(m for m in members if m.user_id == profile["id"])


@router.patch("/groups/{group_id}/members/{member_id}")
async def update_member_role(
    group_id: UUID, member_id: UUID, payload: MemberRoleUpdate, user: CurrentUser
) -> MemberOut:
    """Promote or demote a member. Owners only.

    remove_member refuses to let the last owner walk out; without a way to
    promote someone that rule is a trap rather than a safeguard.
    """
    pool = get_pool()
    async with pool.connection() as conn:
        await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
        require_owner(members, user.id, "change roles")

        target_id = str(member_id)
        current = member_role(members, target_id)
        if current is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "They're not in this group.")
        if current == payload.role:
            return next(m for m in members if m.user_id == target_id)
        # Self-demotion is how a group loses its last owner by accident.
        # Stepping down is fine once someone else can let people in.
        demoting_self = payload.role == "member" and target_id == user.id
        has_another_owner = any(m.role == "owner" and m.user_id != user.id for m in members)
        if demoting_self and not has_another_owner:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "You're the only owner — make someone else an owner first.",
            )

        async with conn.transaction():
            await conn.execute(
                "update public.group_members set role = %s"
                " where group_id = %s and user_id = %s",
                (payload.role, group_id, member_id),
            )
            await log_activity(
                conn,
                group_id,
                user.id,
                "member.role_changed",
                {"memberName": display_name(members, target_id), "role": payload.role},
            )
        members = await fetch_members(conn, group_id)
    return next(m for m in members if m.user_id == target_id)


@router.delete("/groups/{group_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(group_id: UUID, member_id: UUID, user: CurrentUser) -> None:
    pool = get_pool()
    async with pool.connection() as conn:
        await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
        my_role = member_role(members, user.id)
        target_role = member_role(members, str(member_id))
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

        last_member_out = leaving_self and len(members) == 1
        async with conn.transaction():
            await conn.execute(
                "delete from public.group_members where group_id = %s and user_id = %s",
                (group_id, member_id),
            )
            if last_member_out:
                # Last member out — an empty group is just clutter. The
                # activity rows cascade with it, so nothing is logged.
                await conn.execute("delete from public.groups where id = %s", (group_id,))
            else:
                await log_activity(
                    conn,
                    group_id,
                    user.id,
                    "member.removed",
                    {
                        "memberName": display_name(members, str(member_id)),
                        "left": leaving_self,
                    },
                )


# ---------------------------------------------------------------------------
# Invite links
# ---------------------------------------------------------------------------


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/groups/{group_id}/invites", status_code=status.HTTP_201_CREATED)
async def create_invite(group_id: UUID, payload: InviteCreate, user: CurrentUser) -> InviteOut:
    """Mint a share link. Owners only; the plaintext token is returned once."""
    pool = get_pool()
    async with pool.connection() as conn:
        group = await fetch_group_for_member(conn, group_id, user.id)
        if group["archived_at"] is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This group is archived.")
        members = await fetch_members(conn, group_id)
        require_owner(members, user.id, "create invite links")

        # 32 bytes of urandom: not guessable, and URL-safe so it can live in a
        # path segment without escaping.
        token = secrets.token_urlsafe(32)
        # Expiry is computed by Postgres, which is also the clock that later
        # decides whether the link is still live. Deriving it from the API
        # host's clock would make a few seconds of skew a validity question.
        cursor = await conn.execute(
            """
            insert into public.group_invites
                (group_id, token_hash, created_by, expires_at, max_uses)
            values (%s, %s, %s, now() + make_interval(hours => %s), %s)
            returning id::text, group_id::text as group_id, expires_at, max_uses,
                      uses, revoked_at, created_by::text as created_by, created_at
            """,
            (group_id, _hash_token(token), user.id, payload.expires_in_hours, payload.max_uses),
        )
        invite = await cursor.fetchone()
        assert invite is not None
    return InviteOut(**invite, token=token)


@router.get("/groups/{group_id}/invites")
async def list_invites(group_id: UUID, user: CurrentUser) -> list[InviteOut]:
    """Live invite links for a group. Tokens are never included — they are not
    stored, only their hashes, so an existing link can be revoked but not
    re-read."""
    pool = get_pool()
    async with pool.connection() as conn:
        await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
        require_owner(members, user.id, "manage invite links")
        cursor = await conn.execute(
            """
            select id::text, group_id::text as group_id, expires_at, max_uses,
                   uses, revoked_at, created_by::text as created_by, created_at
            from public.group_invites
            where group_id = %s and revoked_at is null and expires_at > now()
            order by created_at desc
            """,
            (group_id,),
        )
        rows = await cursor.fetchall()
    return [InviteOut(**row) for row in rows]


@router.delete(
    "/groups/{group_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def revoke_invite(group_id: UUID, invite_id: UUID, user: CurrentUser) -> None:
    pool = get_pool()
    async with pool.connection() as conn:
        await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
        require_owner(members, user.id, "revoke invite links")
        cursor = await conn.execute(
            """
            update public.group_invites set revoked_at = now()
            where id = %s and group_id = %s and revoked_at is null
            returning id
            """,
            (invite_id, group_id),
        )
        if await cursor.fetchone() is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found.")


async def _usable_invite(conn: AsyncConnection, token: str, *, lock: bool) -> dict[str, Any]:
    cursor = await conn.execute(
        f"""
        select i.id, i.group_id, i.uses, i.max_uses,
               g.name as group_name, g.currency, g.archived_at
        from public.group_invites i
        join public.groups g on g.id = i.group_id
        where i.token_hash = %s
          and i.revoked_at is null
          and i.expires_at > now()
        {"for no key update of i" if lock else ""}
        """,
        (_hash_token(token),),
    )
    invite = await cursor.fetchone()
    # One message for expired, revoked, spent and never-existed: distinguishing
    # them turns the endpoint into an oracle for which tokens are real.
    if invite is None or (
        invite["max_uses"] is not None and invite["uses"] >= invite["max_uses"]
    ):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This invite link is no longer valid."
        )
    if invite["archived_at"] is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This group is archived.")
    return invite


@router.post("/invites/preview")
async def preview_invite(payload: InviteTokenIn, user: CurrentUser) -> InvitePreviewOut:
    """What someone sees before deciding to join.

    A POST that reads nothing on the server, because the alternative is a GET
    with the token in the path — see InviteTokenIn.
    """
    pool = get_pool()
    async with pool.connection() as conn:
        invite = await _usable_invite(conn, payload.token, lock=False)
        cursor = await conn.execute(
            """
            select count(*) as member_count,
                   count(*) filter (where user_id = %s) > 0 as already_member
            from public.group_members where group_id = %s
            """,
            (user.id, invite["group_id"]),
        )
        counts = await cursor.fetchone()
        assert counts is not None
    return InvitePreviewOut(
        group_id=str(invite["group_id"]),
        group_name=invite["group_name"],
        currency=invite["currency"],
        member_count=counts["member_count"],
        already_member=counts["already_member"],
    )


@router.post("/invites/accept")
async def accept_invite(payload: InviteTokenIn, user: CurrentUser) -> GroupOut:
    pool = get_pool()
    async with pool.connection() as conn:
        async with conn.transaction():
            # Locked for the length of the transaction so two people opening
            # the last use of a link cannot both get in.
            invite = await _usable_invite(conn, payload.token, lock=True)
            group_id = invite["group_id"]
            cursor = await conn.execute(
                "select 1 from public.group_members where group_id = %s and user_id = %s",
                (group_id, user.id),
            )
            already_member = await cursor.fetchone() is not None
            if not already_member:
                await conn.execute(
                    "insert into public.group_members (group_id, user_id, role)"
                    " values (%s, %s, 'member')",
                    (group_id, user.id),
                )
                await conn.execute(
                    "update public.group_invites set uses = uses + 1 where id = %s",
                    (invite["id"],),
                )
                members = await fetch_members(conn, group_id)
                await log_activity(
                    conn,
                    group_id,
                    user.id,
                    "member.joined",
                    {"memberName": display_name(members, user.id)},
                )

        cursor = await conn.execute(
            f"select {GROUP_COLUMNS} from public.groups g where g.id = %s", (group_id,)
        )
        group = await cursor.fetchone()
        assert group is not None
        members = await fetch_members(conn, group_id)
    return GroupOut(**group, members=members)


# ---------------------------------------------------------------------------
# Activity feed
# ---------------------------------------------------------------------------


@router.get("/groups/{group_id}/activity")
async def group_activity(
    group_id: UUID,
    user: CurrentUser,
    before: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> ActivityPageOut:
    pool = get_pool()
    async with pool.connection() as conn:
        await fetch_group_for_member(conn, group_id, user.id)
        cursor = await conn.execute(
            """
            select id::text, group_id::text as group_id, actor_id::text as actor_id,
                   kind, detail, created_at
            from public.group_activity
            where group_id = %s and (%s::timestamptz is null or created_at < %s)
            order by created_at desc
            limit %s
            """,
            (group_id, before, before, limit),
        )
        rows = await cursor.fetchall()
    entries = [ActivityOut(**row) for row in rows]
    # Only offer a cursor when the page was full; a short page is the end.
    next_before = entries[-1].created_at if len(entries) == limit else None
    return ActivityPageOut(entries=entries, next_before=next_before)


# ---------------------------------------------------------------------------
# Split presets
# ---------------------------------------------------------------------------


@router.get("/groups/{group_id}/presets")
async def list_presets(group_id: UUID, user: CurrentUser) -> list[SplitPresetOut]:
    pool = get_pool()
    async with pool.connection() as conn:
        await fetch_group_for_member(conn, group_id, user.id)
        cursor = await conn.execute(
            """
            select id::text, group_id::text as group_id, name, method, participants,
                   created_by::text as created_by, created_at
            from public.split_presets where group_id = %s order by lower(name)
            """,
            (group_id,),
        )
        rows = await cursor.fetchall()
    return [SplitPresetOut(**row) for row in rows]


@router.post("/groups/{group_id}/presets", status_code=status.HTTP_201_CREATED)
async def create_preset(
    group_id: UUID, payload: SplitPresetCreate, user: CurrentUser
) -> SplitPresetOut:
    pool = get_pool()
    async with pool.connection() as conn:
        await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
        member_ids = {m.user_id for m in members}
        if not {str(p.user_id) for p in payload.participants} <= member_ids:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Everyone in the preset must be a member of the group.",
            )
        participants = [
            p.model_dump(by_alias=True, exclude_none=True) for p in payload.participants
        ]
        try:
            cursor = await conn.execute(
                """
                insert into public.split_presets
                    (group_id, name, method, participants, created_by)
                values (%s, %s, %s, %s, %s)
                returning id::text, group_id::text as group_id, name, method, participants,
                          created_by::text as created_by, created_at
                """,
                (group_id, payload.name.strip(), payload.method, Jsonb(participants), user.id),
            )
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "This group already has a preset with that name."
            ) from exc
        preset = await cursor.fetchone()
        assert preset is not None
    return SplitPresetOut(**preset)


@router.delete("/presets/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset(preset_id: UUID, user: CurrentUser) -> None:
    pool = get_pool()
    async with pool.connection() as conn:
        cursor = await conn.execute(
            "select group_id::text as group_id from public.split_presets where id = %s",
            (preset_id,),
        )
        preset = await cursor.fetchone()
        if preset is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Preset not found.")
        await fetch_group_for_member(conn, UUID(preset["group_id"]), user.id)
        await conn.execute("delete from public.split_presets where id = %s", (preset_id,))


# ---------------------------------------------------------------------------
# Balances
# ---------------------------------------------------------------------------


@router.get("/groups/{group_id}/balances")
async def group_balances(group_id: UUID, user: CurrentUser) -> GroupBalancesOut:
    pool = get_pool()
    async with pool.connection() as conn:
        group = await fetch_group_for_member(conn, group_id, user.id)
        members = await fetch_members(conn, group_id)
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
    # paid_by, not user_id: since 20260807100000 the person who recorded an
    # expense and the person who paid for it can differ, and it is the payer
    # the group owes.
    cursor = await conn.execute(
        "select paid_by::text as payer, amount_minor from public.expenses where group_id = %s",
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


@router.get("/me/balances")
async def my_balances(user: CurrentUser) -> MyBalancesOut:
    """Every group I'm in: my net, how many of us there are, and when it last
    moved. One query, because the dashboard leads with this and a per-group
    round trip would make the first screen the slowest one."""
    pool = get_pool()
    async with pool.connection() as conn:
        cursor = await conn.execute(
            """
            with my_groups as (
                select g.id, g.name, g.currency, g.archived_at
                from public.groups g
                join public.group_members m on m.group_id = g.id
                where m.user_id = %(uid)s
            ),
            member_counts as (
                select group_id, count(*) as total
                from public.group_members group by group_id
            ),
            paid as (
                select group_id, sum(amount_minor) as total
                from public.expenses
                where paid_by = %(uid)s and group_id is not null
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
            ),
            last_activity as (
                select group_id, max(created_at) as at
                from public.group_activity group by group_id
            )
            select mg.id::text as group_id, mg.name as group_name, mg.currency,
                   coalesce(paid.total, 0) - coalesce(owed.total, 0)
                   + coalesce(sent.total, 0) - coalesce(received.total, 0) as net_minor,
                   coalesce(mc.total, 0) as member_count,
                   la.at as last_activity_at,
                   (mg.archived_at is not null) as archived
            from my_groups mg
            left join member_counts mc on mc.group_id = mg.id
            left join paid on paid.group_id = mg.id
            left join owed on owed.group_id = mg.id
            left join sent on sent.group_id = mg.id
            left join received on received.group_id = mg.id
            left join last_activity la on la.group_id = mg.id
            order by mg.name
            """,
            {"uid": user.id},
        )
        rows = await cursor.fetchall()
    return MyBalancesOut(balances=[MyGroupBalance(**row) for row in rows])
