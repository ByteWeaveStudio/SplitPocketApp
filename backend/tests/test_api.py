"""API-level tests over the FastAPI app: open endpoints, auth guards, and the
no-database guard. No Supabase or Postgres required."""

from tests.conftest import make_token


def test_health_is_open_and_reports_configuration(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "environment": "test",
        "supabase_configured": False,
    }


def test_docs_disabled_outside_development(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_me_requires_auth(client):
    response = client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated."
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_invalid_token_rejected(client):
    response = client.get("/api/v1/me", headers={"Authorization": "Bearer nonsense"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired token."


def test_expired_token_rejected(client):
    token = make_token(expires_in=-60)
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired token."


def test_non_bearer_scheme_rejected(client):
    response = client.get("/api/v1/me", headers={"Authorization": "Basic dXNlcjpwYXNz"})
    assert response.status_code == 401


def test_group_routes_require_auth(client):
    group_id = "22222222-2222-4222-8222-222222222222"
    create = client.post("/api/v1/groups", json={"name": "Trip", "currency": "USD"})
    assert create.status_code == 401
    assert client.get(f"/api/v1/groups/{group_id}/balances").status_code == 401
    assert client.get("/api/v1/me/balances").status_code == 401


def test_group_route_without_database_returns_503(client, auth_headers):
    # Token is valid, but DATABASE_URL isn't configured in tests: the pool
    # guard must answer with a clear 503, not a crash.
    response = client.post(
        "/api/v1/groups", json={"name": "Trip", "currency": "USD"}, headers=auth_headers
    )
    assert response.status_code == 503
    assert "Database is not configured" in response.json()["detail"]


def test_group_payload_validation_runs_before_database(client, auth_headers):
    response = client.post(
        "/api/v1/groups", json={"name": "", "currency": "usd"}, headers=auth_headers
    )
    assert response.status_code == 422


GROUP_ID = "22222222-2222-4222-8222-222222222222"


def test_group_update_requires_auth(client):
    assert client.patch(f"/api/v1/groups/{GROUP_ID}", json={"name": "Trip"}).status_code == 401


def test_group_update_rejects_empty_patch(client, auth_headers):
    # Answered before the pool is touched, so an all-defaults body can't read
    # as "set every field to its default".
    response = client.patch(f"/api/v1/groups/{GROUP_ID}", json={}, headers=auth_headers)
    assert response.status_code == 422
    assert response.json()["detail"] == "Nothing to update."


def test_group_update_ignores_immutable_fields(client, auth_headers):
    # currency and createdBy are not on GroupUpdate: sending them changes
    # nothing, which leaves the patch empty rather than silently re-denominating
    # a group that already has amounts stored against it.
    response = client.patch(
        f"/api/v1/groups/{GROUP_ID}",
        json={"currency": "USD", "createdBy": GROUP_ID},
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Nothing to update."


def test_group_update_rejects_over_long_name(client, auth_headers):
    response = client.patch(
        f"/api/v1/groups/{GROUP_ID}", json={"name": "x" * 81}, headers=auth_headers
    )
    assert response.status_code == 422


def test_group_update_without_database_returns_503(client, auth_headers):
    # A well-formed patch gets past validation and hits the pool guard.
    response = client.patch(
        f"/api/v1/groups/{GROUP_ID}", json={"name": "Trip"}, headers=auth_headers
    )
    assert response.status_code == 503


# ---------------------------------------------------------------------------
# v2 endpoints: auth guards and payload validation. Every one of these is
# answered before the pool is touched, which is what makes them testable
# without a database — and what keeps a malformed body from becoming a 503.
# ---------------------------------------------------------------------------

EXPENSE_ID = "33333333-3333-4333-8333-333333333333"
MEMBER_ID = "44444444-4444-4444-8444-444444444444"
USER_A = "55555555-5555-4555-8555-555555555555"
USER_B = "66666666-6666-4666-8666-666666666666"


def _expense_body(**overrides):
    body = {
        "description": "Dinner",
        "amountMinor": 3000,
        "categoryId": None,
        "date": "2026-08-07",
        "notes": None,
        "method": "equal",
        "participants": [{"userId": USER_A}, {"userId": USER_B}],
    }
    body.update(overrides)
    return body


def test_v2_routes_require_auth(client):
    assert client.get(f"/api/v1/groups/{GROUP_ID}/activity").status_code == 401
    assert client.get(f"/api/v1/groups/{GROUP_ID}/invites").status_code == 401
    assert client.post(f"/api/v1/groups/{GROUP_ID}/invites", json={}).status_code == 401
    assert client.get(f"/api/v1/groups/{GROUP_ID}/presets").status_code == 401
    assert client.get(f"/api/v1/expenses/{EXPENSE_ID}/comments").status_code == 401
    assert client.delete(f"/api/v1/expenses/{EXPENSE_ID}").status_code == 401
    assert client.delete(f"/api/v1/settlements/{EXPENSE_ID}").status_code == 401
    assert client.post("/api/v1/invites/accept", json={"token": "x" * 40}).status_code == 401
    assert (
        client.patch(
            f"/api/v1/groups/{GROUP_ID}/members/{MEMBER_ID}", json={"role": "owner"}
        ).status_code
        == 401
    )


class TestSplitPayloadShapes:
    def test_itemized_requires_items(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(method="itemized", participants=[]),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_itemized_rejects_participants(self, client, auth_headers):
        # Sending both shapes leaves "which one wins?" to the handler, and the
        # loser is a split the user believed they had entered.
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(
                method="itemized",
                items=[{"description": "Pizza", "amountMinor": 3000, "participantIds": [USER_A]}],
            ),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_non_itemized_rejects_items(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(
                items=[{"description": "Pizza", "amountMinor": 3000, "participantIds": [USER_A]}]
            ),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_participants_required_for_equal(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(participants=[]),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_share_units_must_be_positive(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(
                method="shares", participants=[{"userId": USER_A, "shareUnits": 0}]
            ),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_well_formed_shares_payload_reaches_the_pool_guard(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(
                method="shares",
                participants=[
                    {"userId": USER_A, "shareUnits": 2},
                    {"userId": USER_B, "shareUnits": 1},
                ],
            ),
            headers=auth_headers,
        )
        assert response.status_code == 503

    def test_well_formed_itemized_payload_reaches_the_pool_guard(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(
                method="itemized",
                participants=[],
                items=[
                    {
                        "description": "Pizza",
                        "amountMinor": 2000,
                        "participantIds": [USER_A, USER_B],
                    },
                    {"description": "Beer", "amountMinor": 1000, "participantIds": [USER_A]},
                ],
            ),
            headers=auth_headers,
        )
        assert response.status_code == 503

    def test_unknown_method_rejected(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(method="vibes"),
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestInvites:
    def test_expiry_is_bounded(self, client, auth_headers):
        # An invite link is a bearer credential; "never expires" is not on the
        # menu, and neither is a year.
        for hours in (0, 721):
            response = client.post(
                f"/api/v1/groups/{GROUP_ID}/invites",
                json={"expiresInHours": hours},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_defaults_are_accepted(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/invites", json={}, headers=auth_headers
        )
        assert response.status_code == 503

    def test_token_travels_in_the_body_not_the_path(self, client, auth_headers):
        # There is no GET /invites/{token} at all: a path lands in access logs.
        assert client.get("/api/v1/invites/sometoken", headers=auth_headers).status_code == 404
        response = client.post(
            "/api/v1/invites/preview", json={"token": "x" * 43}, headers=auth_headers
        )
        assert response.status_code == 503

    def test_short_token_rejected(self, client, auth_headers):
        response = client.post(
            "/api/v1/invites/accept", json={"token": "short"}, headers=auth_headers
        )
        assert response.status_code == 422


class TestMemberRoles:
    def test_role_is_constrained(self, client, auth_headers):
        response = client.patch(
            f"/api/v1/groups/{GROUP_ID}/members/{MEMBER_ID}",
            json={"role": "admin"},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_valid_role_reaches_the_pool_guard(self, client, auth_headers):
        response = client.patch(
            f"/api/v1/groups/{GROUP_ID}/members/{MEMBER_ID}",
            json={"role": "owner"},
            headers=auth_headers,
        )
        assert response.status_code == 503


class TestComments:
    def test_over_long_body_rejected(self, client, auth_headers):
        response = client.post(
            f"/api/v1/expenses/{EXPENSE_ID}/comments",
            json={"body": "x" * 1001},
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestPresets:
    def test_itemized_cannot_be_saved_as_a_preset(self, client, auth_headers):
        # Its participant list is derived from line items belonging to one
        # specific bill, so there is nothing reusable to store.
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/presets",
            json={"name": "The usual", "method": "itemized", "participants": [{"userId": USER_A}]},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_preset_needs_participants(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/presets",
            json={"name": "The usual", "method": "equal", "participants": []},
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestWhitespaceOnlyText:
    """Blank-but-not-empty input is a 422, not a 500.

    Every text column is checked as `length(trim(x)) between ...`, so "   "
    passing a bare min_length in Pydantic would reach Postgres and come back
    as a check violation.
    """

    def test_group_name(self, client, auth_headers):
        response = client.post(
            "/api/v1/groups", json={"name": "   ", "currency": "USD"}, headers=auth_headers
        )
        assert response.status_code == 422

    def test_expense_description(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(description="  "),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_item_description(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/expenses",
            json=_expense_body(
                method="itemized",
                participants=[],
                items=[{"description": " ", "amountMinor": 3000, "participantIds": [USER_A]}],
            ),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_comment_body(self, client, auth_headers):
        response = client.post(
            f"/api/v1/expenses/{EXPENSE_ID}/comments", json={"body": "   "}, headers=auth_headers
        )
        assert response.status_code == 422

    def test_preset_name(self, client, auth_headers):
        response = client.post(
            f"/api/v1/groups/{GROUP_ID}/presets",
            json={"name": " ", "method": "equal", "participants": [{"userId": USER_A}]},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_group_rename_to_blank(self, client, auth_headers):
        response = client.patch(
            f"/api/v1/groups/{GROUP_ID}", json={"name": "  "}, headers=auth_headers
        )
        assert response.status_code == 422
