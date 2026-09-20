"""컨테이너별 상태 — Docker 엔진 API 를 유닉스 소켓으로 직접 읽는다.

docker SDK 를 새로 넣지 않는다. 필요한 건 GET 두 개뿐이고, httpx 가 유닉스 소켓
transport 를 지원한다. 의존성 하나를 아끼는 게 아니라, 나중에 이 프로젝트를 넘겨받은
사람이 업그레이드해야 할 패키지를 하나 안 늘리는 게 목적이다.

소켓은 **읽기 전용(:ro)** 으로만 붙인다. 쓰기가 되면 컨테이너를 지우거나 새로 띄울 수
있으니, 이 기능 하나 때문에 그 권한을 열어줄 이유가 없다.

소켓이 없으면(마운트를 안 했거나 권한이 없으면) 조용히 빈 목록을 돌려준다 —
모니터링 화면이 이것 때문에 통째로 실패하면 안 된다.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

import httpx

logger = logging.getLogger("docker_stats")

_SOCK = "/var/run/docker.sock"
# 소켓을 직접 붙이지 않고 읽기 전용 프록시를 통해 읽는다. docker.sock 을 ':ro' 로 붙여도
# 소켓으로 나가는 POST 는 막히지 않아서, 인터넷에 열린 백엔드가 털리면 호스트 루트가 된다.
_API_URL = os.getenv("DOCKER_API_URL", "").rstrip("/")


def available() -> bool:
    return bool(_API_URL) or os.path.exists(_SOCK)


def _client() -> httpx.AsyncClient:
    if _API_URL:
        return httpx.AsyncClient(base_url=_API_URL, timeout=5.0)
    # 프록시가 없는 환경(로컬 실험 등)을 위한 폴백
    return httpx.AsyncClient(
        transport=httpx.AsyncHTTPTransport(uds=_SOCK),
        base_url="http://docker",   # 유닉스 소켓이라 호스트명은 의미 없다
        timeout=5.0,
    )


def _cpu_percent(stats: dict) -> float | None:
    """Docker 가 주는 누적값 차분으로 CPU % 계산. 공식 docker stats 와 같은 식."""
    try:
        cpu = stats["cpu_stats"]
        pre = stats["precpu_stats"]
        cpu_delta = cpu["cpu_usage"]["total_usage"] - pre["cpu_usage"]["total_usage"]
        sys_delta = cpu["system_cpu_usage"] - pre["system_cpu_usage"]
        n = cpu.get("online_cpus") or len(cpu["cpu_usage"].get("percpu_usage") or []) or 1
        if sys_delta > 0 and cpu_delta >= 0:
            return round(cpu_delta / sys_delta * n * 100, 1)
    except (KeyError, TypeError, ZeroDivisionError):
        pass
    return None


def _mem_mb(stats: dict) -> float | None:
    try:
        used = stats["memory_stats"]["usage"]
        # cgroup v2 의 'usage' 에는 파일 캐시가 섞여 있다. docker stats 와 맞추려면 빼야 한다.
        cache = stats["memory_stats"].get("stats", {}).get("inactive_file", 0)
        return round(max(0, used - cache) / (1024 * 1024), 1)
    except (KeyError, TypeError):
        return None


async def _one(c: httpx.AsyncClient, ct: dict) -> dict:
    cid = ct["Id"]
    labels = ct.get("Labels") or {}
    row = {
        "id_short": cid[:12],
        "name": (ct.get("Names") or ["/?"])[0].lstrip("/"),
        "service": labels.get("com.docker.compose.service") or (ct.get("Names") or ["?"])[0].lstrip("/"),
        "project": labels.get("com.docker.compose.project"),
        "image": ct.get("Image"),
        "state": ct.get("State"),          # running / exited / restarting
        "status": ct.get("Status"),        # "Up 2 hours (healthy)"
        "health": None, "restart_count": None, "started_at": None,
        "oom_killed": None, "exit_code": None, "cpu_percent": None, "memory_mb": None,
    }
    try:
        ins = (await c.get(f"/containers/{cid}/json")).json()
        st = ins.get("State") or {}
        row["restart_count"] = ins.get("RestartCount")
        row["started_at"] = st.get("StartedAt")
        row["oom_killed"] = st.get("OOMKilled")
        row["exit_code"] = st.get("ExitCode")
        row["health"] = (st.get("Health") or {}).get("Status")
    except Exception:
        pass

    if ct.get("State") == "running":
        try:
            # one-shot 을 켜면 precpu_stats 가 비어 CPU% 를 못 구한다. 끄면 도커가
            # 1초 간격으로 두 번 재서 차분을 채워주는데, 그만큼 응답이 늦다 —
            # 그래서 컨테이너별로 동시에 부른다(직렬로 하면 10개에 20초).
            stats = (await c.get(f"/containers/{cid}/stats",
                                 params={"stream": "false"}, timeout=8.0)).json()
            row["cpu_percent"] = _cpu_percent(stats)
            row["memory_mb"] = _mem_mb(stats)
        except Exception:
            pass
    return row


async def list_containers() -> list[dict]:
    """컨테이너별 상태·재시작 횟수·메모리·CPU. 실패하면 빈 목록."""
    if not available():
        return []
    try:
        async with _client() as c:
            r = await c.get("/containers/json", params={"all": "true"})
            r.raise_for_status()
            rows = await asyncio.gather(*(_one(c, ct) for ct in r.json()))
            return sorted(rows, key=lambda x: (x["project"] or "~", x["name"]))
    except Exception:
        logger.debug("docker 소켓 조회 실패", exc_info=True)
        return []


def uptime_seconds(started_at: str | None) -> float | None:
    if not started_at:
        return None
    try:
        # Docker 는 나노초 9자리를 주는데 파이썬은 6자리까지만 읽는다
        s = started_at.replace("Z", "+00:00")
        if "." in s:
            head, rest = s.split(".", 1)
            frac, tz = rest[:6], rest[len(rest) - 6:] if "+" in rest else "+00:00"
            s = f"{head}.{frac}{tz}"
        return (datetime.now(timezone.utc) - datetime.fromisoformat(s)).total_seconds()
    except Exception:
        return None


def _demux(raw: bytes) -> list[tuple[str, str]]:
    """Docker 로그 스트림에서 8바이트 헤더를 벗겨 (스트림, 줄) 목록으로.

    TTY 가 아닌 컨테이너의 로그는 [스트림(1바이트)][패딩3][길이(4, 빅엔디안)] 뒤에
    본문이 붙는 형식으로 온다. 그대로 보여주면 줄마다 이상한 문자가 섞인다.
    """
    out: list[tuple[str, str]] = []
    i, n = 0, len(raw)
    while i + 8 <= n:
        stream = raw[i]
        size = int.from_bytes(raw[i + 4:i + 8], "big")
        body = raw[i + 8:i + 8 + size]
        i += 8 + size
        for line in body.decode("utf-8", "replace").splitlines():
            if line.strip():
                out.append(("stderr" if stream == 2 else "stdout", line))
    if not out and raw:
        # TTY 컨테이너는 헤더가 없다
        for line in raw.decode("utf-8", "replace").splitlines():
            if line.strip():
                out.append(("stdout", line))
    return out


async def container_logs(name: str, tail: int = 200, since_seconds: int | None = None) -> list[dict]:
    """컨테이너 로그 최근 N줄. 이름으로 찾는다(id 를 화면에 들고 다니지 않으려고)."""
    if not available():
        return []
    try:
        async with _client() as c:
            rs = (await c.get("/containers/json", params={"all": "true"})).json()
            match = next(
                (x for x in rs if (x.get("Names") or [""])[0].lstrip("/") == name),
                None,
            )
            if match is None:
                return []
            params = {"stdout": 1, "stderr": 1, "tail": max(1, min(tail, 2000)), "timestamps": 1}
            if since_seconds:
                import time as _t
                params["since"] = int(_t.time()) - since_seconds
            r = await c.get(f"/containers/{match['Id']}/logs", params=params, timeout=15.0)
            r.raise_for_status()

            rows = []
            for stream, line in _demux(r.content):
                ts, _, msg = line.partition(" ")
                rows.append({"ts": ts, "stream": stream, "message": msg or line})
            return rows
    except Exception:
        logger.debug("로그 조회 실패", exc_info=True)
        return []
