from fastapi import APIRouter

from app.api.routes import groups, health, me

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(me.router, tags=["auth"])
api_router.include_router(groups.router, tags=["groups"])
