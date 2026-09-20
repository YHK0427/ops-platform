"""인프라 상태 — 전체 관리자 전용. Docker socket 마운트 없이 백엔드 프로세스 안에서
읽을 수 있는 것만 본다: 호스트 CPU/메모리/디스크, DB, Redis, 큐, 백업, 백엔드 프로세스.

설계 기준은 Google SRE 의 Four Golden Signals 중 **포화도(saturation)** 와
**조용한 실패**다. 사용자가 30명이라 '화면이 깨졌다'는 몇 분 안에 사람이 알려준다.
반대로 큐가 막혔다, 백업이 안 돈다, 워커가 살아만 있고 일을 안 한다 같은 건
아무도 알려주지 않으므로 여기서 봐야 한다.

'절대량'이 아니라 **한도 대비 비율**로 본다. 연결 7개가 많은지 적은지는
max_connections 를 알아야 판단할 수 있다.
"""
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_admin, _get_redis_client

router = APIRouter(prefix="/infra", tags=["infra"])

_PROCESS_START = time.time()

# 백업 스크립트(scripts/backup_db.sh)가 쌓는 곳. 컨테이너엔 마운트가 없을 수 있어
# 여러 후보를 본다 — 없으면 '백업 설정 안 됨'으로 표시된다.
_BACKUP_DIRS = ("/app/backups", "/backups", "/app/files/backups")

# arq 가 health_check_interval 마다 Redis 에 쓰는 기록.
# 예: "Mar-01 17:41:22 j_complete=0 j_failed=0 j_retried=0 j_ongoing=0 queued=0"
_ARQ_QUEUE = "arq:queue"
_ARQ_HEALTH = "arq:queue:health-check"


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


def _git_sha() -> str | None:
    """지금 돌고 있는 버전. 'SSH 없이 알 수 있는 가장 쓸모 있는 정보'라서 넣는다.

    git 바이너리에 의존하지 않고 .git 파일을 직접 읽는다 — 이미지에 git 이 없어도 되고
    소유권 경고("dubious ownership") 같은 것도 안 걸린다.
    """
    env = os.getenv("GIT_SHA")
    if env:
        return env[:12]
    git_dir = Path("/app/.git")
    try:
        head = (git_dir / "HEAD").read_text().strip()
        if head.startswith("ref: "):
            ref = head[5:]
            ref_file = git_dir / ref
            if ref_file.exists():
                return ref_file.read_text().strip()[:12]
            # 패킹된 ref (git gc 이후)
            for line in (git_dir / "packed-refs").read_text().splitlines():
                if line.endswith(" " + ref):
                    return line.split()[0][:12]
            return None
        return head[:12]  # detached HEAD
    except Exception:
        return None


def _latest_backup() -> tuple[float | None, float | None]:
    """가장 최근 백업의 (경과 시간, 크기MB). 없으면 (None, None)."""
    newest = None
    for d in _BACKUP_DIRS:
        p = Path(d)
        if not p.is_dir():
            continue
        for f in p.glob("db-*.dump"):
            try:
                st = f.stat()
            except OSError:
                continue
            if newest is None or st.st_mtime > newest[0]:
                newest = (st.st_mtime, st.st_size)
    if newest is None:
        return None, None
    age_h = (time.time() - newest[0]) / 3600
    return round(age_h, 1), round(newest[1] / (1024 * 1024), 1)


def _parse_arq_health(raw: str | bytes | None) -> dict:
    """arq 헬스 기록에서 j_complete / j_failed / j_ongoing / queued 를 뽑는다.

    arq 가 이미 완료·실패·진행·대기를 다 적어두고 있어서, 큐에 대한 RED 지표를
    새로 계측할 필요가 없다. 우리는 읽기만 하면 된다.
    """
    if not raw:
        return {}
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    return {k: int(v) for k, v in re.findall(r"(j_\w+|queued)=(\d+)", raw)}


class InfraStatus(BaseModel):
    # ── 버전 / 가동 ──
    backend_uptime_seconds: float
    git_sha: str | None = None
    server_time: str

    # ── 호스트 ──
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

    # ── PostgreSQL ──
    db_ok: bool
    db_latency_ms: float | None
    db_size_mb: float | None
    db_active_connections: int | None
    db_max_connections: int | None = None
    db_connections_percent: float | None = None
    db_longest_query_seconds: float | None = None
    db_idle_in_transaction: int | None = None
    db_cache_hit_percent: float | None = None
    db_deadlocks: int | None = None

    # ── Redis ──
    redis_ok: bool
    redis_latency_ms: float | None
    redis_used_memory_mb: float | None
    redis_max_memory_mb: float | None = None
    redis_used_percent: float | None = None
    redis_connected_clients: int | None
    redis_blocked_clients: int | None = None
    redis_evicted_keys: int | None = None
    redis_aof_last_write_ok: bool | None = None

    # ── 작업 큐 (ARQ) ──
    queue_depth: int | None = None
    worker_alive: bool | None = None
    worker_jobs_complete: int | None = None
    worker_jobs_failed: int | None = None
    worker_jobs_retried: int | None = None
    worker_jobs_ongoing: int | None = None

    # ── 백업 ──
    backup_age_hours: float | None = None
    backup_size_mb: float | None = None

    # ── 판정 ──
    # 화면에서 다시 계산하지 않도록 서버가 결론을 내려준다.
    # 임계값이 한 군데(여기)에만 있어야 나중에 고칠 때 빠뜨리지 않는다.
    problems: list[str] = []
    warnings: list[str] = []


@router.get("/status", response_model=InfraStatus)
async def get_infra_status(
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    load1, load5, load15 = os.getloadavg()
    disk = shutil.disk_usage("/")
    disk_pct = round(disk.used / disk.total * 100, 1)

    mem = _read_meminfo()
    mem_total_mb = mem.get("MemTotal", 0) / 1024 or None
    mem_avail_mb = mem.get("MemAvailable", 0) / 1024 or None
    mem_used_pct = None
    if mem_total_mb and mem_avail_mb is not None:
        mem_used_pct = round((1 - mem_avail_mb / mem_total_mb) * 100, 1)

    # ── PostgreSQL ──
    db_ok = False
    db_latency_ms = db_size_mb = None
    db_active = db_max_conn = db_conn_pct = None
    db_longest = db_idle_tx = db_cache_hit = db_deadlocks = None
    try:
        t0 = time.monotonic()
        await db.execute(text("SELECT 1"))
        db_latency_ms = round((time.monotonic() - t0) * 1000, 1)
        db_ok = True

        size_row = (await db.execute(text("SELECT pg_database_size(current_database())"))).scalar()
        db_size_mb = round(size_row / (1024 * 1024), 1) if size_row else None

        # 연결·최장 쿼리·열어둔 트랜잭션을 한 번에. 쿼리를 나눠 쏘면 시점이 어긋난다.
        row = (await db.execute(text("""
            SELECT
                count(*) FILTER (WHERE datname = current_database()),
                COALESCE(MAX(EXTRACT(EPOCH FROM (now() - query_start)))
                         FILTER (WHERE state = 'active' AND pid <> pg_backend_pid()), 0),
                count(*) FILTER (WHERE state = 'idle in transaction')
            FROM pg_stat_activity
        """))).first()
        if row:
            db_active = int(row[0])
            db_longest = round(float(row[1]), 1)
            db_idle_tx = int(row[2])

        db_max_conn = int((await db.execute(text("SHOW max_connections"))).scalar())
        if db_max_conn:
            db_conn_pct = round((db_active or 0) / db_max_conn * 100, 1)

        stat = (await db.execute(text("""
            SELECT blks_hit, blks_read, deadlocks
            FROM pg_stat_database WHERE datname = current_database()
        """))).first()
        if stat:
            hit, read, dl = int(stat[0] or 0), int(stat[1] or 0), int(stat[2] or 0)
            if hit + read > 0:
                db_cache_hit = round(hit / (hit + read) * 100, 2)
            db_deadlocks = dl
    except Exception:
        pass

    # ── Redis + 큐 ──
    redis_ok = False
    redis_latency_ms = redis_used_mb = redis_max_mb = redis_used_pct = None
    redis_clients = redis_blocked = redis_evicted = redis_aof_ok = None
    queue_depth = worker_alive = None
    jobs: dict = {}
    try:
        redis = _get_redis_client()
        t0 = time.monotonic()
        await redis.ping()
        redis_latency_ms = round((time.monotonic() - t0) * 1000, 1)
        redis_ok = True

        info = await redis.info(section="memory")
        redis_used_mb = round(info.get("used_memory", 0) / (1024 * 1024), 1)
        max_bytes = info.get("maxmemory", 0)
        if max_bytes:
            redis_max_mb = round(max_bytes / (1024 * 1024), 1)
            redis_used_pct = round(info.get("used_memory", 0) / max_bytes * 100, 1)

        clients_info = await redis.info(section="clients")
        redis_clients = clients_info.get("connected_clients")
        redis_blocked = clients_info.get("blocked_clients")

        stats = await redis.info(section="stats")
        # noeviction 정책이라 여기가 0이 아니면 큐 작업이 버려졌다는 뜻이다.
        redis_evicted = stats.get("evicted_keys")

        persist = await redis.info(section="persistence")
        if "aof_last_write_status" in persist:
            redis_aof_ok = persist.get("aof_last_write_status") == "ok"

        # 큐 깊이 — 정렬집합 원소 수가 곧 대기 중인 작업 수다.
        queue_depth = int(await redis.zcard(_ARQ_QUEUE))
        # 워커가 살아 있으면 이 키가 TTL 과 함께 계속 갱신된다. 없으면 죽었거나 멈춘 것.
        raw = await redis.get(_ARQ_HEALTH)
        worker_alive = raw is not None
        jobs = _parse_arq_health(raw)
    except Exception:
        pass

    backup_age_h, backup_size_mb = _latest_backup()

    # ── 판정 ──
    problems: list[str] = []
    warnings: list[str] = []

    if not db_ok:
        problems.append("DB에 연결되지 않습니다")
    if not redis_ok:
        problems.append("Redis에 연결되지 않습니다")
    if worker_alive is False:
        problems.append("작업 워커가 응답하지 않습니다 — 크롤링·영상·푸시가 멈춥니다")
    if disk_pct >= 90:
        problems.append(f"디스크가 {disk_pct}% 찼습니다")
    elif disk_pct >= 80:
        warnings.append(f"디스크 {disk_pct}% 사용 중")
    if redis_evicted:
        problems.append(f"Redis가 키 {redis_evicted}개를 버렸습니다 — 작업이 유실됐을 수 있습니다")

    if backup_age_h is None:
        warnings.append("백업이 없습니다 — scripts/backup_db.sh 를 cron에 등록하세요")
    elif backup_age_h > 48:
        problems.append(f"마지막 백업이 {int(backup_age_h)}시간 전입니다")
    elif backup_age_h > 30:
        warnings.append(f"마지막 백업이 {int(backup_age_h)}시간 전입니다")

    if db_conn_pct is not None and db_conn_pct >= 80:
        warnings.append(f"DB 연결이 한도의 {db_conn_pct}%입니다")
    if db_longest is not None and db_longest > 300:
        warnings.append(f"{int(db_longest // 60)}분째 도는 쿼리가 있습니다")
    if db_idle_tx:
        warnings.append(f"열어둔 채 방치된 트랜잭션 {db_idle_tx}개")
    if redis_used_pct is not None and redis_used_pct >= 70:
        warnings.append(f"Redis 메모리가 한도의 {redis_used_pct}%입니다")
    if mem_used_pct is not None and mem_used_pct >= 90:
        warnings.append(f"메모리 {mem_used_pct}% 사용 중")
    if queue_depth and queue_depth > 100:
        warnings.append(f"대기 중인 작업이 {queue_depth}개입니다")

    return InfraStatus(
        backend_uptime_seconds=round(time.time() - _PROCESS_START, 1),
        git_sha=_git_sha(),
        server_time=datetime.now(timezone.utc).isoformat(),
        cpu_load_1m=load1, cpu_load_5m=load5, cpu_load_15m=load15,
        cpu_count=os.cpu_count() or 1,
        memory_total_mb=mem_total_mb, memory_available_mb=mem_avail_mb, memory_used_percent=mem_used_pct,
        disk_total_gb=round(disk.total / (1024 ** 3), 1),
        disk_used_gb=round(disk.used / (1024 ** 3), 1),
        disk_used_percent=disk_pct,
        db_ok=db_ok, db_latency_ms=db_latency_ms, db_size_mb=db_size_mb,
        db_active_connections=db_active, db_max_connections=db_max_conn,
        db_connections_percent=db_conn_pct, db_longest_query_seconds=db_longest,
        db_idle_in_transaction=db_idle_tx, db_cache_hit_percent=db_cache_hit,
        db_deadlocks=db_deadlocks,
        redis_ok=redis_ok, redis_latency_ms=redis_latency_ms,
        redis_used_memory_mb=redis_used_mb, redis_max_memory_mb=redis_max_mb,
        redis_used_percent=redis_used_pct,
        redis_connected_clients=redis_clients, redis_blocked_clients=redis_blocked,
        redis_evicted_keys=redis_evicted, redis_aof_last_write_ok=redis_aof_ok,
        queue_depth=queue_depth, worker_alive=worker_alive,
        worker_jobs_complete=jobs.get("j_complete"), worker_jobs_failed=jobs.get("j_failed"),
        worker_jobs_retried=jobs.get("j_retried"), worker_jobs_ongoing=jobs.get("j_ongoing"),
        backup_age_hours=backup_age_h, backup_size_mb=backup_size_mb,
        problems=problems, warnings=warnings,
    )


# ── 지표 이력 (그래프용) ─────────────────────────────────────────────────────
# 화면을 켜둔 동안만 모으면 "어제부터 메모리가 새고 있다"를 영영 못 본다.
# 워커가 분당 한 줄 쌓아두고, 여기서 기간에 맞게 솎아서 내려준다.

class HistoryPoint(BaseModel):
    t: str
    cpu: float | None = None
    mem: float | None = None
    disk: float | None = None
    db_mb: float | None = None
    db_conn: int | None = None
    redis_mb: float | None = None
    queue: int | None = None
    requests: int | None = None
    errors: int | None = None
    p95_ms: int | None = None


@router.get("/history", response_model=list[HistoryPoint])
async def get_history(
    hours: int = 24,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """최근 N시간 추이. 점이 너무 많으면 화면이 느려지므로 구간 평균으로 묶는다."""
    from app.models import InfraSnapshot

    hours = max(1, min(hours, 24 * 90))
    # 어떤 기간을 봐도 점 200개 안팎이 되게 묶는 간격을 정한다.
    bucket_min = max(1, round(hours * 60 / 200))

    rows = (await db.execute(text("""
        SELECT
            to_timestamp(floor(extract(epoch FROM created_at) / (:b * 60)) * (:b * 60)) AS t,
            avg(cpu_load_1m), avg(memory_used_percent), avg(disk_used_percent),
            avg(db_size_mb), avg(db_connections), avg(redis_used_mb), max(queue_depth),
            sum(requests), sum(errors), max(p95_ms)
        FROM infra_snapshots
        WHERE created_at >= now() - make_interval(hours => :h)
        GROUP BY 1 ORDER BY 1
    """), {"b": bucket_min, "h": hours})).all()

    def f(v):
        return round(float(v), 1) if v is not None else None

    return [
        HistoryPoint(
            t=t.isoformat(), cpu=f(cpu), mem=f(mem), disk=f(disk), db_mb=f(dbmb),
            db_conn=int(conn) if conn is not None else None, redis_mb=f(rmb),
            queue=int(q) if q is not None else None,
            requests=int(req) if req is not None else None,
            errors=int(err) if err is not None else None,
            p95_ms=int(p95) if p95 is not None else None,
        )
        for t, cpu, mem, disk, dbmb, conn, rmb, q, req, err, p95 in rows
    ]


# ── 컨테이너 ────────────────────────────────────────────────────────────────

class ContainerOut(BaseModel):
    name: str
    service: str
    project: str | None = None
    is_ours: bool = False
    image: str | None = None
    state: str | None = None
    status: str | None = None
    health: str | None = None
    restart_count: int | None = None
    uptime_seconds: float | None = None
    oom_killed: bool | None = None
    exit_code: int | None = None
    cpu_percent: float | None = None
    memory_mb: float | None = None


@router.get("/containers", response_model=list[ContainerOut])
async def get_containers(_admin: dict = Depends(require_admin)):
    """컨테이너별 상태. Docker 소켓이 없으면 빈 목록 — 화면이 이것 때문에 죽지 않게."""
    from app.services import docker_stats

    import socket

    rows = await docker_stats.list_containers()
    # 한 호스트에 dev 와 prod 가 같이 떠 있다. 내 컨테이너 id(=hostname)로
    # 내가 속한 프로젝트를 찾아, 어느 쪽이 '우리 것'인지 표시한다.
    me = socket.gethostname()
    mine = next((c.get("project") for c in rows if c.get("id_short") == me), None)
    out = []
    for c in rows:
        out.append(ContainerOut(
            name=c["name"], service=c["service"], project=c.get("project"),
            # 이 백엔드가 속한 프로젝트인지 — 한 호스트에 dev/prod 가 같이 떠 있어서 구분이 필요하다
            is_ours=bool(mine and c.get("project") == mine),
            image=c["image"], state=c["state"],
            status=c["status"], health=c["health"], restart_count=c["restart_count"],
            uptime_seconds=docker_stats.uptime_seconds(c["started_at"]),
            oom_killed=c["oom_killed"], exit_code=c["exit_code"],
            cpu_percent=c["cpu_percent"], memory_mb=c["memory_mb"],
        ))
    return out


# ── 우리 API 가 얼마나 건강한가 (RED) ─────────────────────────────────────────
# access_logs 에 이미 상태코드와 응답시간이 들어 있다. 새로 계측할 게 없다.

class EndpointStat(BaseModel):
    path: str
    requests: int
    errors: int
    avg_ms: int
    max_ms: int


class ApiHealth(BaseModel):
    window_hours: int
    requests: int
    errors: int
    error_rate: float
    p50_ms: int | None = None
    p95_ms: int | None = None
    p99_ms: int | None = None
    slowest: list[EndpointStat] = []
    most_errors: list[EndpointStat] = []


@router.get("/api-health", response_model=ApiHealth)
async def get_api_health(
    hours: int = 24,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    hours = max(1, min(hours, 24 * 30))
    p = {"h": hours}

    row = (await db.execute(text("""
        SELECT
            COALESCE(sum(hits), 0),
            COALESCE(sum(hits) FILTER (WHERE status_code >= 400), 0),
            percentile_disc(0.50) WITHIN GROUP (ORDER BY duration_ms),
            percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms),
            percentile_disc(0.99) WITHIN GROUP (ORDER BY duration_ms)
        FROM access_logs
        WHERE last_seen_at >= now() - make_interval(hours => :h)
    """), p)).first()
    total, errs = int(row[0]), int(row[1])

    slow = (await db.execute(text("""
        SELECT path, sum(hits), COALESCE(sum(hits) FILTER (WHERE status_code >= 400), 0),
               avg(duration_ms), max(duration_ms)
        FROM access_logs
        WHERE last_seen_at >= now() - make_interval(hours => :h)
        GROUP BY path ORDER BY avg(duration_ms) DESC NULLS LAST LIMIT 8
    """), p)).all()

    bad = (await db.execute(text("""
        SELECT path, sum(hits), sum(hits) FILTER (WHERE status_code >= 400),
               avg(duration_ms), max(duration_ms)
        FROM access_logs
        WHERE last_seen_at >= now() - make_interval(hours => :h)
          AND status_code >= 400
        GROUP BY path ORDER BY sum(hits) DESC LIMIT 8
    """), p)).all()

    def rows(rs):
        return [
            EndpointStat(
                path=r[0], requests=int(r[1] or 0), errors=int(r[2] or 0),
                avg_ms=int(r[3] or 0), max_ms=int(r[4] or 0),
            ) for r in rs
        ]

    return ApiHealth(
        window_hours=hours, requests=total, errors=errs,
        error_rate=round(errs / total * 100, 2) if total else 0.0,
        p50_ms=row[2], p95_ms=row[3], p99_ms=row[4],
        slowest=rows(slow), most_errors=rows(bad),
    )
