import logging
import time
from contextlib import asynccontextmanager

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.logging_config import setup_logging
from app.routers import assignments, auth, crawler, evaluation, generation, members, sessions, ledger

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger.info("Application starting")
    # ARQ Redis Pool 생성
    app.state.arq_pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    yield
    await app.state.arq_pool.close()


_is_prod = settings.ENV == "production"

app = FastAPI(
    title="UnivPT Ops API",
    version="1.0.0",
    docs_url=None if _is_prod else "/api/docs",
    redoc_url=None if _is_prod else "/api/redoc",
    openapi_url=None if _is_prod else "/api/openapi.json",
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


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled: {request.method} {request.url.path}", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start
    if duration > 1.0 or response.status_code >= 400:
        logger.info(
            f"{request.method} {request.url.path} → {response.status_code} ({duration:.2f}s)"
        )
    return response


# 라우터 등록
app.include_router(auth.router, prefix="/api/v1")
app.include_router(members.router, prefix="/api/v1")
app.include_router(sessions.router, prefix="/api/v1")
app.include_router(crawler.router, prefix="/api/v1")
app.include_router(assignments.router, prefix="/api/v1")
app.include_router(ledger.router, prefix="/api/v1")
app.include_router(generation.router, prefix="/api/v1")
app.include_router(evaluation.router, prefix="/api/v1")


@app.get("/health")
async def health():
    """Docker healthcheck 전용"""
    return {"status": "ok"}
