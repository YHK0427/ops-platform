"""장부 잔액 스냅샷(deposit_after) 정합성 유틸리티."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ledger, Member


async def recalculate_deposit_after(db: AsyncSession, member_id: int) -> None:
    """
    해당 멤버의 모든 장부 항목 deposit_after를 시간순 재계산하고
    member.current_deposit을 최종 잔액으로 동기화한다.

    장부 항목이 생성/수정/삭제될 때마다 호출해야 한다.
    flush 후 호출 권장 (새 항목이 DB에 반영된 뒤 정렬되어야 하므로).
    """
    member = await db.get(Member, member_id)
    if not member:
        return

    entries = (
        await db.execute(
            select(Ledger)
            .where(Ledger.member_id == member_id)
            .order_by(Ledger.created_at, Ledger.id)
        )
    ).scalars().all()

    running = 20000  # 초기 디파짓 기본값
    for entry in entries:
        # MILESTONE_FINE(누적벌점 벌금)은 디파짓과 별개로 별도 납부받는 금액 → 잔액 합산 제외
        if entry.type != "MILESTONE_FINE":
            running += entry.amount_krw
        entry.deposit_after = running

    member.current_deposit = running
