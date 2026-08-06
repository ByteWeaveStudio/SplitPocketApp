"""Request/response models for groups, shared expenses, and settlements.

JSON uses camelCase (FastAPI serializes by alias) to match the frontend's
domain types; Python code uses snake_case field names.
"""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class GroupCreate(CamelModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = None
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class MemberOut(CamelModel):
    user_id: str
    role: str
    joined_at: datetime
    email: str
    full_name: str | None
    avatar_url: str | None


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


class SplitParticipantIn(CamelModel):
    user_id: UUID
    owed_minor: int | None = Field(default=None, ge=0)
    share_basis_points: int | None = Field(default=None, ge=0, le=10_000)


class GroupExpenseCreate(CamelModel):
    description: str = Field(min_length=1, max_length=200)
    amount_minor: int = Field(gt=0)
    category_id: UUID | None = None
    date: date
    notes: str | None = Field(default=None, max_length=500)
    method: Literal["equal", "custom", "percentage"]
    participants: list[SplitParticipantIn] = Field(min_length=1, max_length=100)


class SplitOut(CamelModel):
    id: str
    expense_id: str
    user_id: str
    owed_minor: int
    share_basis_points: int | None
    method: str


class GroupExpenseOut(CamelModel):
    id: str
    user_id: str
    group_id: str
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


class SettlementCreate(CamelModel):
    from_user_id: UUID
    to_user_id: UUID
    amount_minor: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=500)
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


class MyBalancesOut(CamelModel):
    balances: list[MyGroupBalance]
