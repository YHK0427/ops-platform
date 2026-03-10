import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_staff
from app.models import Assignment
from app.schemas.assignment import AssignmentResponse, AssignmentUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assignments", tags=["assignments"])


@router.patch("/{assignment_id}", response_model=AssignmentResponse)
async def update_assignment_status(
    assignment_id: int,
    body: AssignmentUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
):
    """과제(PPT 등) 상태 수동 변경"""
    result = await db.execute(select(Assignment).where(Assignment.id == assignment_id))
    assignment = result.scalar_one_or_none()
    
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
        
    if body.status:
        assignment.status = body.status
        
    await db.commit()
    await db.refresh(assignment)
    logger.audit(f"assignment_updated id={assignment_id} status={body.status}")
    return assignment
