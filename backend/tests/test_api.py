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
