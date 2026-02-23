from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Session, Attendance, Member

async def check_attendance_streaks(db: AsyncSession):
    """
    최근 4개의 FINALIZED 세션동안 모두 'PRESENT'인 멤버 목록을 반환
    """
    # 1. 최근 FINALIZED 세션 4개 조회
    stmt_sessions = (
        select(Session.id)
        .where(Session.status == "FINALIZED")
        .order_by(desc(Session.date))
        .limit(4)
    )
    result_sessions = await db.execute(stmt_sessions)
    session_ids = result_sessions.scalars().all()
    
    if len(session_ids) < 4:
        return []
    
    # 2. 해당 세션들에서 모두 출석한 멤버 조회
    # Group By member_id Having count = 4
    stmt_streak = (
        select(Member)
        .join(Attendance, Member.id == Attendance.member_id)
        .where(
            Attendance.session_id.in_(session_ids),
            Attendance.status == "PRESENT"
        )
        .group_by(Member.id)
        .having(func.count(Attendance.id) == 4)
    )
    
    result_streak = await db.execute(stmt_streak)
    members = result_streak.scalars().all()
    
    return list(members)
