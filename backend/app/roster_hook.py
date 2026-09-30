"""출결 명단이 바뀌면 그 세션의 실시간 피드백 보드에 알린다.

보드의 발표자 명단은 저장하지 않고 매번 출결(분반·상태)에서 계산한다. 서버는 늘 최신이지만,
이미 보드를 열어둔 화면은 모른다. 분반 저장·출결 드롭다운·일괄 출석·포털 사유서 반영·
카페 스캔(워커) 등 바꾸는 경로가 여러 곳이라, 저장 시점 한 곳에서 잡는다.
"""
import asyncio
import logging

from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session

from app.models import Attendance

logger = logging.getLogger(__name__)
_KEY = "roster_changed_sessions"
_WATCHED = ("status", "group_num")
_tasks: set[asyncio.Task] = set()


@event.listens_for(Session, "after_flush")
def _collect(session, flush_context) -> None:
    ids = session.info.setdefault(_KEY, set())
    for obj in list(session.new) + list(session.deleted):
        if isinstance(obj, Attendance) and obj.session_id:
            ids.add(obj.session_id)
    for obj in session.dirty:
        if not isinstance(obj, Attendance):
            continue
        state = inspect(obj)
        if any(state.attrs[k].history.has_changes() for k in _WATCHED):
            ids.add(obj.session_id)


@event.listens_for(Session, "after_rollback")
def _clear(session) -> None:
    session.info.pop(_KEY, None)


@event.listens_for(Session, "after_commit")
def _notify(session) -> None:
    ids = session.info.pop(_KEY, None)
    if not ids:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_broadcast(set(ids)))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _broadcast(session_ids: set[int]) -> None:
    from app.database import AsyncSessionLocal
    from app.models import LiveFeedbackBoard
    from app.services.live_feedback_ws import manager
    try:
        async with AsyncSessionLocal() as db:
            board_ids = (await db.execute(
                select(LiveFeedbackBoard.id).where(LiveFeedbackBoard.session_id.in_(session_ids))
            )).scalars().all()
        evt = {"type": "board.roster_changed", "data": {}}
        for bid in board_ids:
            await manager.broadcast(bid, evt, evt)
        # 오프·오피 투표 — 투표권(출석자)·집계가 바뀐다
        from app.models import Session as SessionModel, SessionVote
        from app.services.live_feedback_ws import vote_manager
        async with AsyncSessionLocal() as db:
            cohorts = (await db.execute(
                select(SessionModel.cohort_id).join(SessionVote, SessionVote.session_id == SessionModel.id)
                .where(SessionModel.id.in_(session_ids), SessionVote.is_open == True).distinct()  # noqa: E712
            )).scalars().all()
        vote_evt = {"type": "vote.changed"}
        for cid in cohorts:
            await vote_manager.broadcast(cid, vote_evt, vote_evt)
    except Exception:
        logger.warning("명단 변경 알림 실패", exc_info=True)
