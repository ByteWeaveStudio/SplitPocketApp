from fastapi import APIRouter

from app.api.routes import expenses, groups, health, me, settlements

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(me.router, tags=["auth"])
api_router.include_router(groups.router, tags=["groups"])
api_router.include_router(expenses.router, tags=["expenses"])
api_router.include_router(settlements.router, tags=["settlements"])
