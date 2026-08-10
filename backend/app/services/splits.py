"""Split computation — pure functions, raise ValueError with user-facing text.

Every method here answers one question: given a total in minor units and a
description of how people agreed to divide it, who owes exactly how much?
The answers always reconcile to the total to the last minor unit — the
deferred expense_splits_total trigger rejects the write otherwise.
"""

from dataclasses import dataclass

BASIS_POINTS_TOTAL = 10_000

METHODS = ("equal", "custom", "percentage", "shares", "itemized")


@dataclass(frozen=True)
class ParticipantShare:
    user_id: str
    owed_minor: int | None = None
    share_basis_points: int | None = None
    #: Weight for `shares`: 2 units is twice the share of 1.
    share_units: int | None = None


@dataclass(frozen=True)
class ComputedSplit:
    user_id: str
    owed_minor: int
    share_basis_points: int | None
    share_units: int | None = None


@dataclass(frozen=True)
class LineItem:
    """One line of an itemized bill and the people who shared it."""

    description: str
    amount_minor: int
    participant_ids: tuple[str, ...]


def compute_splits(
    method: str, amount_minor: int, participants: list[ParticipantShare]
) -> list[ComputedSplit]:
    if not participants:
        raise ValueError("Pick at least one person to split with.")
    seen = {p.user_id for p in participants}
    if len(seen) != len(participants):
        raise ValueError("Each person can appear in the split only once.")

    if method == "equal":
        return _equal(amount_minor, participants)
    if method == "percentage":
        return _percentage(amount_minor, participants)
    if method == "custom":
        return _custom(amount_minor, participants)
    if method == "shares":
        return _shares(amount_minor, participants)
    raise ValueError(f"Unknown split method: {method}")


def _equal(amount_minor: int, participants: list[ParticipantShare]) -> list[ComputedSplit]:
    count = len(participants)
    base, remainder = divmod(amount_minor, count)
    # The first `remainder` participants absorb the leftover minor units, so
    # totals always reconcile exactly.
    return [
        ComputedSplit(p.user_id, base + (1 if index < remainder else 0), None)
        for index, p in enumerate(participants)
    ]


def _percentage(amount_minor: int, participants: list[ParticipantShare]) -> list[ComputedSplit]:
    if any(p.share_basis_points is None for p in participants):
        raise ValueError("Every person needs a percentage.")
    shares = [p.share_basis_points or 0 for p in participants]
    if any(share < 0 for share in shares):
        raise ValueError("Percentages can't be negative.")
    if sum(shares) != BASIS_POINTS_TOTAL:
        raise ValueError("Percentages must add up to exactly 100%.")

    owed = _proportional(amount_minor, shares)
    return [
        ComputedSplit(p.user_id, owed[index], shares[index])
        for index, p in enumerate(participants)
    ]


def _custom(amount_minor: int, participants: list[ParticipantShare]) -> list[ComputedSplit]:
    if any(p.owed_minor is None for p in participants):
        raise ValueError("Every person needs an amount.")
    amounts = [p.owed_minor or 0 for p in participants]
    if any(value < 0 for value in amounts):
        raise ValueError("Split amounts can't be negative.")
    if sum(amounts) != amount_minor:
        raise ValueError("The split amounts must add up to the total.")
    return [
        ComputedSplit(p.user_id, amounts[index], None) for index, p in enumerate(participants)
    ]


def _shares(amount_minor: int, participants: list[ParticipantShare]) -> list[ComputedSplit]:
    """Weights, not amounts: "two of us, one of them" is 2 : 1.

    Percentages can express the same intent, but only after the user does the
    division — and three equal people cannot be written as percentages at all
    (33.33 x 3 is not 100). Shares let them state the ratio and leave the
    arithmetic here, which is the whole point of the app.
    """
    if any(p.share_units is None for p in participants):
        raise ValueError("Every person needs a share.")
    units = [p.share_units or 0 for p in participants]
    if any(value < 1 for value in units):
        raise ValueError("Each share must be at least 1.")

    owed = _proportional(amount_minor, units)
    return [
        ComputedSplit(p.user_id, owed[index], None, units[index])
        for index, p in enumerate(participants)
    ]


def _proportional(amount_minor: int, weights: list[int]) -> list[int]:
    """Divide `amount_minor` in proportion to `weights`, losing nothing.

    Flooring each share leaves at most len(weights) - 1 minor units unassigned;
    they go one at a time to the largest weights, which is the allocation that
    keeps every share closest to its exact value.
    """
    total = sum(weights)
    if total <= 0:
        raise ValueError("The shares must add up to more than zero.")
    owed = [amount_minor * weight // total for weight in weights]
    leftover = amount_minor - sum(owed)
    order = sorted(range(len(weights)), key=lambda i: weights[i], reverse=True)
    for index in range(leftover):
        owed[order[index % len(order)]] += 1
    return owed


def compute_itemized_splits(
    amount_minor: int, items: list[LineItem]
) -> list[ComputedSplit]:
    """Split a bill line by line, each line among the people who shared it.

    A restaurant bill is not one amount divided one way — it is a list of
    things, each shared by a different subset. Every item is divided equally
    among its own participants and the results are summed per person.
    """
    if not items:
        raise ValueError("Add at least one item.")
    total = sum(item.amount_minor for item in items)
    if total != amount_minor:
        raise ValueError("The items must add up to the total.")

    owed: dict[str, int] = {}
    for position, item in enumerate(items):
        if not item.participant_ids:
            raise ValueError(f'Pick who shared "{item.description}".')
        if len(set(item.participant_ids)) != len(item.participant_ids):
            raise ValueError(f'Each person can appear in "{item.description}" only once.')

        count = len(item.participant_ids)
        base, remainder = divmod(item.amount_minor, count)
        for user_id in item.participant_ids:
            owed.setdefault(user_id, 0)
            owed[user_id] += base
        # Rotate which participant absorbs each item's leftover minor unit.
        # Always starting at index 0 would make the first person on the list
        # pay for the rounding on every line of a long bill.
        for offset in range(remainder):
            owed[item.participant_ids[(position + offset) % count]] += 1

    # dicts preserve insertion order, so splits come back in the order people
    # first appear on the bill — stable across re-saves of the same items.
    return [ComputedSplit(user_id, value, None) for user_id, value in owed.items()]
