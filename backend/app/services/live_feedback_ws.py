"""실시간 피드백 보드 WebSocket 연결 관리 + Redis pub/sub 팬아웃.

백엔드가 uvicorn 멀티 워커(--workers 2)로 뜨므로, WS 연결과 REST 변이가
서로 다른 워커 프로세스에 떨어질 수 있다. in-memory 만으로는 워커 간 브로드캐스트가
누락되므로 Redis pub/sub로 모든 워커에 이벤트를 팬아웃한다.

핵심: 연결마다 role("admin"|"member")을 보관하고, 전달 시 role별로 다른 payload를
보낸다(익명 글의 실명은 멤버 클라이언트에 절대 전송 금지).
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field

import redis.asyncio as aioredis
from fastapi import WebSocket

from app.config import settings

logger = logging.getLogger("live_feedback")

CHANNEL = "live_feedback:events"


@dataclass(eq=False)  # eq=False → 객체 정체성 기반 hash (set 사용 가능, 연결마다 고유)
class Conn:
    ws: WebSocket
    role: str  # "admin" | "member"
    member_id: int | None = None


@dataclass
class ConnectionManager:
    rooms: dict[int, set[Conn]] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _redis: aioredis.Redis | None = None
    _sub_task: asyncio.Task | None = None

    def _client(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        return self._redis

    async def connect(self, board_id: int, ws: WebSocket, role: str, member_id: int | None) -> Conn:
        conn = Conn(ws=ws, role=role, member_id=member_id)
        async with self._lock:
            self.rooms.setdefault(board_id, set()).add(conn)
        return conn

    async def disconnect(self, board_id: int, conn: Conn) -> None:
        async with self._lock:
            room = self.rooms.get(board_id)
            if room:
                room.discard(conn)
                if not room:
                    self.rooms.pop(board_id, None)

    async def broadcast(self, board_id: int, admin_payload: dict, member_payload: dict) -> None:
        """이벤트를 Redis로 발행 → 모든 워커(자기 자신 포함)가 로컬 연결에 전달."""
        msg = json.dumps({
            "board_id": board_id,
            "admin": admin_payload,
            "member": member_payload,
        })
        try:
            await self._client().publish(CHANNEL, msg)
        except Exception:
            logger.exception("live_feedback broadcast publish 실패 — 로컬만 전달")
            await self._local_deliver(board_id, admin_payload, member_payload)

    async def _local_deliver(self, board_id: int, admin_payload: dict, member_payload: dict) -> None:
        async with self._lock:
            conns = list(self.rooms.get(board_id, set()))
        dead: list[Conn] = []
        for conn in conns:
            payload = admin_payload if conn.role == "admin" else member_payload
            try:
                await conn.ws.send_json(payload)
            except Exception:
                dead.append(conn)
        if dead:
            async with self._lock:
                room = self.rooms.get(board_id)
                if room:
                    for c in dead:
                        room.discard(c)

    async def start_subscriber(self) -> None:
        """워커마다 1개 — Redis 채널 구독 후 로컬 연결에 전달."""
        if self._sub_task is not None:
            return
        self._sub_task = asyncio.create_task(self._subscribe_loop())

    async def stop_subscriber(self) -> None:
        if self._sub_task:
            self._sub_task.cancel()
            self._sub_task = None

    async def _subscribe_loop(self) -> None:
        while True:
            try:
                pubsub = self._client().pubsub()
                await pubsub.subscribe(CHANNEL)
                async for raw in pubsub.listen():
                    if raw.get("type") != "message":
                        continue
                    try:
                        data = json.loads(raw["data"])
                        await self._local_deliver(data["board_id"], data["admin"], data["member"])
                    except Exception:
                        logger.exception("live_feedback 이벤트 처리 실패")
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("live_feedback 구독 루프 오류 — 2초 후 재시도")
                await asyncio.sleep(2)


# 모듈 싱글톤 — WS 핸들러 + REST 변이 + lifespan 구독 시작에서 공유
manager = ConnectionManager()
