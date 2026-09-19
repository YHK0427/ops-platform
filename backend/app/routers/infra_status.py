"""인프라 상태 — 전체 관리자 전용. Docker socket 마운트 없이 백엔드 프로세스 안에서
읽을 수 있는 것만 본다: 호스트 CPU/메모리/디스크, DB, Redis, 백엔드 프로세스 자체.
컨테이너별 개별 지표(재시작 횟수 등)는 범위 밖 — 필요해지면 별도로 다룬다."""
import os
import shutil
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_admin, _get_redis_client

router = APIRouter(prefix="/infra", tags=["infra"])

_PROCESS_START = time.time()


def _read_meminfo() -> dict:
    """/proc/meminfo에서 전체/가용 메모리(kB) 읽기 — stdlib만으로 컨테이너 메모리 확인."""
    info = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, rest = line.partition(":")
                if key in ("MemTotal", "MemAvailable"):
                    info[key] = int(rest.strip().split()[0])  # kB
    except Exception:
        pass
    return info


class InfraStatus(BaseModel):
    backend_uptime_seconds: float
    cpu_load_1m: float
    cpu_load_5m: float
    cpu_load_15m: float
    cpu_count: int
    memory_total_mb: float | None
    memory_available_mb: float | None
    memory_used_percent: float | None
    disk_total_gb: float
    disk_used_gb: float
    disk_used_percent: float
    db_ok: bool
    db_latency_ms: float | None
    db_size_mb: float | None
    db_active_connections: int | None
    redis_ok: bool
    redis_latency_ms: float | None
    redis_used_memory_mb: float | None
    redis_connected_clients: int | None


@router.get("/status", response_model=InfraStatus)
async def get_infra_status(
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    load1, load5, load15 = os.getloadavg()
    disk = shutil.disk_usage("/")

    mem = _read_meminfo()
    mem_total_mb = mem.get("MemTotal", 0) / 1024 or None
    mem_avail_mb = mem.get("MemAvailable", 0) / 1024 or None
    mem_used_pct = None
    if mem_total_mb and mem_avail_mb is not None:
        mem_used_pct = round((1 - mem_avail_mb / mem_total_mb) * 100, 1)

    # DB 상태
    db_ok = False
    db_latency_ms = None
    db_size_mb = None
    db_active = None
    try:
        t0 = time.monotonic()
        await db.execute(text("SELECT 1"))
        db_latency_ms = round((time.monotonic() - t0) * 1000, 1)
        db_ok = True
        size_row = (await db.execute(text("SELECT pg_database_size(current_database())"))).scalar()
        db_size_mb = round(size_row / (1024 * 1024), 1) if size_row else None
        active_row = (await db.execute(text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"))).scalar()
        db_active = int(active_row) if active_row is not None else None
    except Exception:
        pass

    # Redis 상태
    redis_ok = False
    redis_latency_ms = None
    redis_used_mb = None
    redis_clients = None
    try:
        redis = _get_redis_client()
        t0 = time.monotonic()
        await redis.ping()
        redis_latency_ms = round((time.monotonic() - t0) * 1000, 1)
        redis_ok = True
        info = await redis.info(section="memory")
        redis_used_mb = round(info.get("used_memory", 0) / (1024 * 1024), 1)
        clients_info = await redis.info(section="clients")
        redis_clients = clients_info.get("connected_clients")
    except Exception:
        pass

    return InfraStatus(
        backend_uptime_seconds=round(time.time() - _PROCESS_START, 1),
        cpu_load_1m=load1, cpu_load_5m=load5, cpu_load_15m=load15,
        cpu_count=os.cpu_count() or 1,
        memory_total_mb=mem_total_mb, memory_available_mb=mem_avail_mb, memory_used_percent=mem_used_pct,
        disk_total_gb=round(disk.total / (1024 ** 3), 1),
        disk_used_gb=round(disk.used / (1024 ** 3), 1),
        disk_used_percent=round(disk.used / disk.total * 100, 1),
        db_ok=db_ok, db_latency_ms=db_latency_ms, db_size_mb=db_size_mb, db_active_connections=db_active,
        redis_ok=redis_ok, redis_latency_ms=redis_latency_ms,
        redis_used_memory_mb=redis_used_mb, redis_connected_clients=redis_clients,
    )
