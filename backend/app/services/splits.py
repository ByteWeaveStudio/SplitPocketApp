"""Split computation — pure functions, raise ValueError with user-facing text."""

from dataclasses import dataclass

BASIS_POINTS_TOTAL = 10_000


@dataclass(frozen=True)
class ParticipantShare:
    user_id: str
    owed_minor: int | None = None
    share_basis_points: int | None = None


@dataclass(frozen=True)
class ComputedSplit:
    user_id: str
    owed_minor: int
    share_basis_points: int | None


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

    owed = [amount_minor * share // BASIS_POINTS_TOTAL for share in shares]
    # Distribute rounding leftovers one minor unit at a time, largest share first.
    leftover = amount_minor - sum(owed)
    order = sorted(range(len(participants)), key=lambda i: shares[i], reverse=True)
    for i in range(leftover):
        owed[order[i % len(order)]] += 1
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
