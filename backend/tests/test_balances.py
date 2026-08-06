"""Unit tests for balance aggregation and debt simplification (app.services.balances)."""

from app.services.balances import Transfer, compute_net, simplify_debts

A, B, C, D = "user-a", "user-b", "user-c", "user-d"


class TestComputeNet:
    def test_members_start_at_zero(self):
        assert compute_net([A, B], [], [], []) == {A: 0, B: 0}

    def test_payer_gains_owers_lose(self):
        # A pays 100, split equally between A and B.
        net = compute_net([A, B], [(A, 100)], [(A, 50), (B, 50)], [])
        assert net == {A: 50, B: -50}

    def test_nets_sum_to_zero_when_splits_cover_expenses(self):
        net = compute_net(
            [A, B, C],
            [(A, 9001), (B, 300)],
            [(A, 3001), (B, 3000), (C, 3000), (A, 100), (B, 100), (C, 100)],
            [],
        )
        assert sum(net.values()) == 0

    def test_settlement_moves_money_from_payer_to_receiver(self):
        # B owes A 50, then B pays A 50 in cash: everyone is square.
        net = compute_net([A, B], [(A, 100)], [(A, 50), (B, 50)], [(B, A, 50)])
        assert net == {A: 0, B: 0}

    def test_partial_settlement(self):
        net = compute_net([A, B], [(A, 100)], [(A, 50), (B, 50)], [(B, A, 20)])
        assert net == {A: 30, B: -30}

    def test_overpaid_settlement_flips_the_debt(self):
        net = compute_net([A, B], [(A, 100)], [(A, 50), (B, 50)], [(B, A, 80)])
        assert net == {A: -30, B: 30}

    def test_unknown_ids_are_tolerated(self):
        # A payer who has left the member list still accumulates a balance.
        net = compute_net([A], [(B, 100)], [(A, 100)], [])
        assert net == {A: -100, B: 100}


class TestSimplifyDebts:
    def test_empty_and_settled_nets_produce_no_transfers(self):
        assert simplify_debts({}) == []
        assert simplify_debts({A: 0, B: 0}) == []

    def test_single_debt(self):
        assert simplify_debts({A: 50, B: -50}) == [Transfer(B, A, 50)]

    def test_chain_collapses_to_minimal_transfers(self):
        # B owes 30, C owes 20, A is owed 50 — two transfers, not three.
        transfers = simplify_debts({A: 50, B: -30, C: -20})
        assert transfers == [Transfer(B, A, 30), Transfer(C, A, 20)]

    def test_at_most_n_minus_1_transfers(self):
        net = {A: 70, B: -10, C: -25, D: -35}
        assert len(simplify_debts(net)) <= 3

    def test_transfers_settle_everyone(self):
        net = {A: 137, B: -47, C: -90, D: 0}
        settled = dict(net)
        for t in simplify_debts(net):
            settled[t.from_user_id] += t.amount_minor
            settled[t.to_user_id] -= t.amount_minor
        assert all(value == 0 for value in settled.values())

    def test_largest_debtor_pays_largest_creditor_first(self):
        transfers = simplify_debts({A: 60, B: 40, C: -70, D: -30})
        assert transfers[0] == Transfer(C, A, 60)

    def test_ties_break_by_user_id_for_determinism(self):
        # Two identical debtors and creditors: order must be stable by id.
        transfers = simplify_debts({A: 50, B: 50, C: -50, D: -50})
        assert transfers == [Transfer(C, A, 50), Transfer(D, B, 50)]

    def test_no_zero_amount_transfers(self):
        transfers = simplify_debts({A: 25, B: -25, C: 0, D: 0})
        assert all(t.amount_minor > 0 for t in transfers)

    def test_roundtrip_with_compute_net(self):
        # Full pipeline: expenses -> nets -> suggested settlements -> all square.
        expenses = [(A, 9000), (B, 4500), (C, 1500)]
        splits = [(uid, 5000) for uid in (A, B, C)]
        net = compute_net([A, B, C], expenses, splits, [])
        settlements = [
            (t.from_user_id, t.to_user_id, t.amount_minor) for t in simplify_debts(net)
        ]
        final = compute_net([A, B, C], expenses, splits, settlements)
        assert final == {A: 0, B: 0, C: 0}
