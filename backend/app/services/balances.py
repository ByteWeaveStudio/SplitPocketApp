"""Balance aggregation and debt simplification — pure functions.

Sign convention: positive net = the group owes you (you're owed);
negative net = you owe the group.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Transfer:
    from_user_id: str
    to_user_id: str
    amount_minor: int


def compute_net(
    member_ids: list[str],
    expenses: list[tuple[str, int]],  # (payer_id, amount_minor)
    splits: list[tuple[str, int]],  # (user_id, owed_minor)
    settlements: list[tuple[str, str, int]],  # (from_id, to_id, amount_minor)
) -> dict[str, int]:
    net: dict[str, int] = dict.fromkeys(member_ids, 0)
    for payer_id, amount_minor in expenses:
        net[payer_id] = net.get(payer_id, 0) + amount_minor
    for user_id, owed_minor in splits:
        net[user_id] = net.get(user_id, 0) - owed_minor
    for from_id, to_id, amount_minor in settlements:
        # Paying cash toward a debt raises the payer's net, lowers the receiver's.
        net[from_id] = net.get(from_id, 0) + amount_minor
        net[to_id] = net.get(to_id, 0) - amount_minor
    return net


def simplify_debts(net: dict[str, int]) -> list[Transfer]:
    """Greedy min-cash-flow: repeatedly settle the largest debtor with the
    largest creditor. At most n-1 transfers; ties broken by user id so the
    result is deterministic."""
    creditors = sorted(
        ((uid, value) for uid, value in net.items() if value > 0),
        key=lambda item: (-item[1], item[0]),
    )
    debtors = sorted(
        ((uid, -value) for uid, value in net.items() if value < 0),
        key=lambda item: (-item[1], item[0]),
    )
    transfers: list[Transfer] = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        debtor_id, debt = debtors[i]
        creditor_id, credit = creditors[j]
        amount = min(debt, credit)
        transfers.append(Transfer(debtor_id, creditor_id, amount))
        debt -= amount
        credit -= amount
        if debt == 0:
            i += 1
        else:
            debtors[i] = (debtor_id, debt)
        if credit == 0:
            j += 1
        else:
            creditors[j] = (creditor_id, credit)
    return transfers
