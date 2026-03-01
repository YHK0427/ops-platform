from contextlib import asynccontextmanager

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import assignments, auth, crawler, members, sessions, ledger


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ARQ Redis Pool 생성
    app.state.arq_pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    yield
    await app.state.arq_pool.close()


app = FastAPI(
    title="UnivPT Ops API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    max_age=3600,
)

# 라우터 등록
app.include_router(auth.router, prefix="/api/v1")
app.include_router(members.router, prefix="/api/v1")
app.include_router(sessions.router, prefix="/api/v1")
app.include_router(crawler.router, prefix="/api/v1")
app.include_router(assignments.router, prefix="/api/v1")
app.include_router(ledger.router, prefix="/api/v1")


@app.get("/health")
async def health():
    """Docker healthcheck 전용"""
    return {"status": "ok"}
