"""Supabase JWT verification.

Two schemes, depending on the Supabase project's signing keys:
- Current projects sign access tokens asymmetrically -> verified via the
  project's JWKS endpoint.
- Legacy projects sign with a shared HS256 secret -> set SUPABASE_JWT_SECRET.
"""

from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str | None
    claims: dict[str, Any]


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    settings = get_settings()
    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is not configured.")
    return jwt.PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")


# Verification algorithms are pinned per scheme rather than taken from the
# token's own header. Passing algorithms=[header["alg"]] lets the token choose
# how it is checked, which is the setup alg-confusion attacks need: the moment
# a project has both a shared secret and asymmetric keys, an attacker picks
# whichever one they can forge against.
_ASYMMETRIC_ALGORITHMS = ["RS256", "ES256", "EdDSA"]
_SYMMETRIC_ALGORITHMS = ["HS256"]


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    header = jwt.get_unverified_header(token)
    algorithm: str = header.get("alg", "")

    # Screen the header before resolving a key, so "none" and other unsupported
    # algorithms are refused outright instead of reaching the JWKS fetch.
    if algorithm in _SYMMETRIC_ALGORITHMS:
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("SUPABASE_JWT_SECRET is not configured.")
        key: Any = settings.supabase_jwt_secret
        algorithms = _SYMMETRIC_ALGORITHMS
    elif algorithm in _ASYMMETRIC_ALGORITHMS:
        key = _jwks_client().get_signing_key_from_jwt(token).key
        algorithms = _ASYMMETRIC_ALGORITHMS
    else:
        raise jwt.InvalidAlgorithmError(f"Unsupported token algorithm: {algorithm!r}.")

    # Without an explicit require list a validly-signed token that simply omits
    # `exp` never expires, and one missing `sub` reaches the caller and raises
    # a KeyError (a 500) instead of a 401.
    required = ["exp", "sub", "aud"]
    issuer = f"{settings.supabase_url}/auth/v1" if settings.supabase_url else None
    if issuer is not None:
        required.append("iss")

    return jwt.decode(
        token,
        key,
        algorithms=algorithms,
        audience="authenticated",
        issuer=issuer,
        options={"require": required},
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthenticatedUser:
    """FastAPI dependency: require a valid Supabase access token.

    Deliberately sync (`def`) so FastAPI runs it in the threadpool — the JWKS
    fetch inside decode_token is blocking HTTP and must stay off the event loop.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = decode_token(credentials.credentials)
    except jwt.exceptions.PyJWKClientConnectionError as exc:
        # A JWKS outage is a server-side failure, not a bad credential.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable.",
        ) from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return AuthenticatedUser(id=claims["sub"], email=claims.get("email"), claims=claims)
