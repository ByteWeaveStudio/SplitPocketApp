"""Request/response models for groups, shared expenses, and settlements.

JSON uses camelCase (FastAPI serializes by alias) to match the frontend's
domain types; Python code uses snake_case field names.
"""

from datetime import date, datetime
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# Every text column in the schema is checked as `length(trim(x)) between ...`,
# so a bare min_length would let "   " through Pydantic (three characters) and
# turn a typo into a check-constraint 500 from Postgres. Stripping during
# validation makes the two agree, and hands handlers the text that will
# actually be stored.
def _required_text(min_length: int, max_length: int) -> Any:
    return Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=min_length, max_length=max_length
        ),
    ]


GroupName = _required_text(1, 80)
PresetName = _required_text(1, 40)
ExpenseDescription = _required_text(1, 200)
ItemDescription = _required_text(1, 120)
CommentBody = _required_text(1, 1000)
#: Optional free text. Blank stays blank rather than becoming an error; the
#: columns behind these have no length floor.
OptionalText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None


# Python ints are unbounded and the columns are plain bigint, so without a
# ceiling `amountMinor: 10**30` reaches Postgres and comes back as a 500, while
# a merely enormous value is accepted and — since only the creator can delete
# an expense — leaves every other member staring at a permanent junk balance.
# 10^11 minor units is a billion in a two-decimal currency: far past any real
# split, far short of bigint.
MAX_AMOUNT_MINOR = 10**11

SplitMethod = Literal["equal", "custom", "percentage", "shares", "itemized"]
#: Methods a saved preset can carry. Itemized is excluded on purpose: its
#: participant list is derived from line items that belong to one specific
#: bill, so there is nothing reusable to store.
PresetMethod = Literal["equal", "custom", "percentage", "shares"]


class GroupCreate(CamelModel):
    name: GroupName
    description: OptionalText = None
    currency: str = Field(pattern=r"^[A-Z]{3}$")


# A partial update: every field is optional, and "absent" has to stay
# distinguishable from "explicitly null" so `description: null` can clear the
# text while omitting it leaves the stored value alone. Callers read
# model_fields_set rather than testing for None.
class GroupUpdate(CamelModel):
    name: GroupName | None = None
    description: OptionalText = None
    # currency and created_by are deliberately absent: 20260806120000 revoked
    # them precisely because re-denominating a group retroactively rewrites
    # every amount_minor already stored against it.
    archived: bool | None = None


class MemberOut(CamelModel):
    user_id: str
    role: str
    joined_at: datetime
    email: str
    full_name: str | None
    avatar_url: str | None


class MemberRoleUpdate(CamelModel):
    role: Literal["owner", "member"]


class GroupOut(CamelModel):
    id: str
    name: str
    description: str | None
    currency: str
    created_by: str
    created_at: datetime
    archived_at: datetime | None
    members: list[MemberOut]


class AddMemberRequest(CamelModel):
    email: str = Field(min_length=3, max_length=320)


# ---------------------------------------------------------------------------
# Shared expenses
# ---------------------------------------------------------------------------


class SplitParticipantIn(CamelModel):
    user_id: UUID
    owed_minor: int | None = Field(default=None, ge=0, le=MAX_AMOUNT_MINOR)
    share_basis_points: int | None = Field(default=None, ge=0, le=10_000)
    # Bounded well below the amount ceiling: shares are a ratio, and a weight
    # of 10^9 is not a ratio anyone typed on purpose.
    share_units: int | None = Field(default=None, ge=1, le=10_000)


class LineItemIn(CamelModel):
    description: ItemDescription
    amount_minor: int = Field(gt=0, le=MAX_AMOUNT_MINOR)
    participant_ids: list[UUID] = Field(min_length=1, max_length=100)


class GroupExpenseCreate(CamelModel):
    description: ExpenseDescription
    amount_minor: int = Field(gt=0, le=MAX_AMOUNT_MINOR)
    category_id: UUID | None = None
    date: date
    notes: OptionalText = None
    method: SplitMethod
    # Omitted means "the person recording it paid", which is what v1 assumed.
    paid_by: UUID | None = None
    participants: list[SplitParticipantIn] = Field(default_factory=list, max_length=100)
    items: list[LineItemIn] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def _check_shape(self) -> Self:
        # The two shapes are mutually exclusive rather than merely alternative:
        # accepting both would leave "which one wins?" to the handler, and the
        # loser would be a split the user thought they had entered.
        if self.method == "itemized":
            if not self.items:
                raise ValueError("An itemized split needs at least one item.")
            if self.participants:
                raise ValueError("An itemized split takes items, not participants.")
        else:
            if not self.participants:
                raise ValueError("Pick at least one person to split with.")
            if self.items:
                raise ValueError("Items are only used by an itemized split.")
        return self


class SplitOut(CamelModel):
    id: str
    expense_id: str
    user_id: str
    owed_minor: int
    share_basis_points: int | None
    share_units: int | None = None
    method: str


class ExpenseItemOut(CamelModel):
    id: str
    description: str
    amount_minor: int
    position: int
    participant_ids: list[str]


class GroupExpenseOut(CamelModel):
    id: str
    user_id: str
    group_id: str
    paid_by: str
    category_id: str | None
    description: str
    amount_minor: int
    currency: str
    date: date
    kind: str
    notes: str | None
    created_at: datetime
    updated_at: datetime
    splits: list[SplitOut]
    items: list[ExpenseItemOut] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Split presets
# ---------------------------------------------------------------------------


class SplitPresetCreate(CamelModel):
    name: PresetName
    method: PresetMethod
    participants: list[SplitParticipantIn] = Field(min_length=1, max_length=100)


class SplitPresetOut(CamelModel):
    id: str
    group_id: str
    name: str
    method: str
    participants: list[dict[str, Any]]
    created_by: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Settlements & balances
# ---------------------------------------------------------------------------


class SettlementCreate(CamelModel):
    from_user_id: UUID
    to_user_id: UUID
    amount_minor: int = Field(gt=0, le=MAX_AMOUNT_MINOR)
    note: OptionalText = None
    settled_at: datetime | None = None


class SettlementOut(CamelModel):
    id: str
    group_id: str
    from_user_id: str
    to_user_id: str
    amount_minor: int
    currency: str
    note: str | None
    settled_at: datetime
    created_at: datetime


class MemberBalance(CamelModel):
    user_id: str
    net_minor: int


class SuggestedSettlement(CamelModel):
    from_user_id: str
    to_user_id: str
    amount_minor: int


class GroupBalancesOut(CamelModel):
    group_id: str
    currency: str
    members: list[MemberBalance]
    suggested_settlements: list[SuggestedSettlement]


class MyGroupBalance(CamelModel):
    group_id: str
    group_name: str
    currency: str
    net_minor: int
    member_count: int = 0
    # Null for a group nobody has spent in yet — "no activity" is not the same
    # as "activity at the epoch", and the dashboard orders on this.
    last_activity_at: datetime | None = None
    archived: bool = False


class MyBalancesOut(CamelModel):
    balances: list[MyGroupBalance]


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------


class InviteCreate(CamelModel):
    # Capped at 30 days: an invite link is a bearer credential, and the honest
    # upper bound on "I'll send this to the group chat later" is not a year.
    expires_in_hours: int = Field(default=168, ge=1, le=720)
    max_uses: int | None = Field(default=None, ge=1, le=100)


class InviteTokenIn(CamelModel):
    #: Carried in the body rather than the path: the token is a bearer
    #: credential, and a path lands in every proxy and server access log it
    #: passes through. secrets.token_urlsafe(32) is ~43 characters.
    token: str = Field(min_length=16, max_length=200)


class InviteOut(CamelModel):
    id: str
    group_id: str
    #: Present only in the response that creates the invite — the plaintext
    #: token is never stored, so it can never be shown again.
    token: str | None = None
    expires_at: datetime
    max_uses: int | None
    uses: int
    revoked_at: datetime | None
    created_by: str
    created_at: datetime


class InvitePreviewOut(CamelModel):
    group_id: str
    group_name: str
    currency: str
    member_count: int
    already_member: bool


# ---------------------------------------------------------------------------
# Comments & activity
# ---------------------------------------------------------------------------


class CommentCreate(CamelModel):
    body: CommentBody


class CommentOut(CamelModel):
    id: str
    expense_id: str
    user_id: str
    body: str
    created_at: datetime
    updated_at: datetime


class ActivityOut(CamelModel):
    id: str
    group_id: str
    actor_id: str | None
    kind: str
    detail: dict[str, Any]
    created_at: datetime


class ActivityPageOut(CamelModel):
    entries: list[ActivityOut]
    #: created_at of the oldest entry returned; pass back as `before` to page.
    next_before: datetime | None = None
