"""Unit tests for split computation (app.services.splits)."""

import pytest

from app.services.splits import (
    LineItem,
    ParticipantShare,
    compute_itemized_splits,
    compute_splits,
)

A, B, C = "user-a", "user-b", "user-c"


def owed(splits):
    return {s.user_id: s.owed_minor for s in splits}


class TestEqual:
    def test_divides_evenly(self):
        splits = compute_splits("equal", 9000, [ParticipantShare(A), ParticipantShare(B)])
        assert owed(splits) == {A: 4500, B: 4500}

    def test_remainder_goes_to_first_participants(self):
        # ₹90.01 between two: totals must reconcile exactly.
        splits = compute_splits("equal", 9001, [ParticipantShare(A), ParticipantShare(B)])
        assert owed(splits) == {A: 4501, B: 4500}

    def test_three_way_remainder(self):
        splits = compute_splits(
            "equal", 100, [ParticipantShare(A), ParticipantShare(B), ParticipantShare(C)]
        )
        assert owed(splits) == {A: 34, B: 33, C: 33}
        assert sum(owed(splits).values()) == 100

    def test_single_participant_takes_all(self):
        splits = compute_splits("equal", 777, [ParticipantShare(A)])
        assert owed(splits) == {A: 777}

    def test_amount_smaller_than_group(self):
        splits = compute_splits(
            "equal", 2, [ParticipantShare(A), ParticipantShare(B), ParticipantShare(C)]
        )
        assert owed(splits) == {A: 1, B: 1, C: 0}

    def test_equal_splits_have_no_basis_points(self):
        splits = compute_splits("equal", 1000, [ParticipantShare(A), ParticipantShare(B)])
        assert all(s.share_basis_points is None for s in splits)


class TestPercentage:
    def test_simple_percentages(self):
        splits = compute_splits(
            "percentage",
            10_000,
            [
                ParticipantShare(A, share_basis_points=2_500),
                ParticipantShare(B, share_basis_points=7_500),
            ],
        )
        assert owed(splits) == {A: 2500, B: 7500}
        assert {s.user_id: s.share_basis_points for s in splits} == {A: 2_500, B: 7_500}

    def test_rounding_leftover_goes_to_largest_share_first(self):
        # 33.33% / 33.33% / 33.34% of 100 units: floor gives 33+33+33, the
        # leftover unit goes to the largest share.
        splits = compute_splits(
            "percentage",
            100,
            [
                ParticipantShare(A, share_basis_points=3_333),
                ParticipantShare(B, share_basis_points=3_333),
                ParticipantShare(C, share_basis_points=3_334),
            ],
        )
        assert sum(owed(splits).values()) == 100
        assert owed(splits) == {A: 33, B: 33, C: 34}

    @pytest.mark.parametrize("amount", [1, 99, 101, 12_345, 999_999_999])
    def test_always_reconciles(self, amount):
        splits = compute_splits(
            "percentage",
            amount,
            [
                ParticipantShare(A, share_basis_points=1_234),
                ParticipantShare(B, share_basis_points=8_000),
                ParticipantShare(C, share_basis_points=766),
            ],
        )
        assert sum(owed(splits).values()) == amount

    def test_zero_percent_participant_owes_nothing(self):
        splits = compute_splits(
            "percentage",
            5_000,
            [
                ParticipantShare(A, share_basis_points=0),
                ParticipantShare(B, share_basis_points=10_000),
            ],
        )
        assert owed(splits) == {A: 0, B: 5_000}

    def test_missing_percentage_rejected(self):
        with pytest.raises(ValueError, match="needs a percentage"):
            compute_splits(
                "percentage",
                100,
                [ParticipantShare(A, share_basis_points=10_000), ParticipantShare(B)],
            )

    def test_negative_percentage_rejected(self):
        with pytest.raises(ValueError, match="negative"):
            compute_splits(
                "percentage",
                100,
                [
                    ParticipantShare(A, share_basis_points=-100),
                    ParticipantShare(B, share_basis_points=10_100),
                ],
            )

    @pytest.mark.parametrize("total", [9_999, 10_001, 0])
    def test_must_sum_to_exactly_100(self, total):
        with pytest.raises(ValueError, match="exactly 100%"):
            compute_splits(
                "percentage",
                100,
                [
                    ParticipantShare(A, share_basis_points=total // 2),
                    ParticipantShare(B, share_basis_points=total - total // 2),
                ],
            )


class TestCustom:
    def test_exact_amounts(self):
        splits = compute_splits(
            "custom",
            1_000,
            [ParticipantShare(A, owed_minor=999), ParticipantShare(B, owed_minor=1)],
        )
        assert owed(splits) == {A: 999, B: 1}

    def test_zero_share_allowed(self):
        splits = compute_splits(
            "custom",
            1_000,
            [ParticipantShare(A, owed_minor=1_000), ParticipantShare(B, owed_minor=0)],
        )
        assert owed(splits) == {A: 1_000, B: 0}

    def test_missing_amount_rejected(self):
        with pytest.raises(ValueError, match="needs an amount"):
            compute_splits(
                "custom", 100, [ParticipantShare(A, owed_minor=100), ParticipantShare(B)]
            )

    def test_negative_amount_rejected(self):
        with pytest.raises(ValueError, match="negative"):
            compute_splits(
                "custom",
                100,
                [ParticipantShare(A, owed_minor=-50), ParticipantShare(B, owed_minor=150)],
            )

    @pytest.mark.parametrize("amounts", [(50, 49), (50, 51)])
    def test_sum_mismatch_rejected(self, amounts):
        with pytest.raises(ValueError, match="add up to the total"):
            compute_splits(
                "custom",
                100,
                [
                    ParticipantShare(A, owed_minor=amounts[0]),
                    ParticipantShare(B, owed_minor=amounts[1]),
                ],
            )


class TestValidation:
    def test_empty_participants_rejected(self):
        with pytest.raises(ValueError, match="at least one person"):
            compute_splits("equal", 100, [])

    def test_duplicate_participant_rejected(self):
        with pytest.raises(ValueError, match="only once"):
            compute_splits("equal", 100, [ParticipantShare(A), ParticipantShare(A)])

    def test_unknown_method_rejected(self):
        with pytest.raises(ValueError, match="Unknown split method"):
            compute_splits("vibes", 100, [ParticipantShare(A)])

    def test_itemized_is_not_reachable_through_compute_splits(self):
        # Itemized takes line items, not participants, so it has its own entry
        # point; asking for it here is a caller bug, not a user error.
        with pytest.raises(ValueError, match="Unknown split method"):
            compute_splits("itemized", 100, [ParticipantShare(A)])


class TestShares:
    def test_two_to_one(self):
        splits = compute_splits(
            "shares",
            9_000,
            [ParticipantShare(A, share_units=2), ParticipantShare(B, share_units=1)],
        )
        assert owed(splits) == {A: 6_000, B: 3_000}

    def test_equal_shares_match_an_equal_split(self):
        shares = compute_splits(
            "shares", 100, [ParticipantShare(uid, share_units=1) for uid in (A, B, C)]
        )
        equal = compute_splits("equal", 100, [ParticipantShare(uid) for uid in (A, B, C)])
        assert sum(owed(shares).values()) == sum(owed(equal).values()) == 100

    def test_units_are_recorded(self):
        splits = compute_splits(
            "shares",
            300,
            [ParticipantShare(A, share_units=3), ParticipantShare(B, share_units=1)],
        )
        assert {s.user_id: s.share_units for s in splits} == {A: 3, B: 1}
        assert all(s.share_basis_points is None for s in splits)

    @pytest.mark.parametrize("amount", [1, 7, 99, 12_345, 999_999_999])
    def test_always_reconciles(self, amount):
        splits = compute_splits(
            "shares",
            amount,
            [
                ParticipantShare(A, share_units=3),
                ParticipantShare(B, share_units=1),
                ParticipantShare(C, share_units=1),
            ],
        )
        assert sum(owed(splits).values()) == amount

    def test_leftover_goes_to_the_largest_share(self):
        # 3 : 1 : 1 of 100 floors to 60 + 20 + 20 = 100 exactly; 3 : 1 : 1 of
        # 101 leaves one unit, which belongs with the biggest share.
        splits = compute_splits(
            "shares",
            101,
            [
                ParticipantShare(A, share_units=3),
                ParticipantShare(B, share_units=1),
                ParticipantShare(C, share_units=1),
            ],
        )
        assert owed(splits) == {A: 61, B: 20, C: 20}

    def test_missing_share_rejected(self):
        with pytest.raises(ValueError, match="needs a share"):
            compute_splits(
                "shares", 100, [ParticipantShare(A, share_units=1), ParticipantShare(B)]
            )

    def test_zero_share_rejected(self):
        # A zero-weight participant is someone who should not be in the split
        # at all -- silently owing nothing hides the mistake.
        with pytest.raises(ValueError, match="at least 1"):
            compute_splits(
                "shares",
                100,
                [ParticipantShare(A, share_units=0), ParticipantShare(B, share_units=1)],
            )


class TestItemized:
    def test_each_item_splits_among_its_own_participants(self):
        # A and B share a 1000 starter; only A had the 500 dessert.
        splits = compute_itemized_splits(
            1_500,
            [
                LineItem("Starter", 1_000, (A, B)),
                LineItem("Dessert", 500, (A,)),
            ],
        )
        assert owed(splits) == {A: 1_000, B: 500}

    def test_participants_are_the_union_of_the_items(self):
        splits = compute_itemized_splits(
            300, [LineItem("Taxi", 200, (A, B)), LineItem("Tip", 100, (C,))]
        )
        assert set(owed(splits)) == {A, B, C}

    def test_items_must_add_up_to_the_total(self):
        with pytest.raises(ValueError, match="add up to the total"):
            compute_itemized_splits(1_000, [LineItem("Starter", 999, (A, B))])

    def test_empty_bill_rejected(self):
        with pytest.raises(ValueError, match="at least one item"):
            compute_itemized_splits(0, [])

    def test_item_without_participants_rejected(self):
        with pytest.raises(ValueError, match="who shared"):
            compute_itemized_splits(100, [LineItem("Mystery dish", 100, ())])

    def test_duplicate_participant_in_one_item_rejected(self):
        with pytest.raises(ValueError, match="only once"):
            compute_itemized_splits(100, [LineItem("Pizza", 100, (A, A))])

    def test_rounding_rotates_between_items(self):
        # Three 100-unit items split two ways each: 50/50 leaves no remainder,
        # so make them odd. Each item leaves one unit, and rotating means A
        # does not absorb all three.
        splits = compute_itemized_splits(
            303,
            [
                LineItem("One", 101, (A, B)),
                LineItem("Two", 101, (A, B)),
                LineItem("Three", 101, (A, B)),
            ],
        )
        assert sum(owed(splits).values()) == 303
        assert owed(splits) == {A: 152, B: 151}

    @pytest.mark.parametrize("amount", [3, 101, 9_999, 1_000_003])
    def test_always_reconciles(self, amount):
        half = amount // 2
        splits = compute_itemized_splits(
            amount,
            [
                LineItem("Shared", half, (A, B, C)),
                LineItem("Rest", amount - half, (A, B)),
            ],
        )
        assert sum(owed(splits).values()) == amount
