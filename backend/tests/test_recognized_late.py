"""지각·조퇴 인정사유 — 출결은 그대로, 벌점만 면제."""
from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.penalty_engine import attendance_penalty
from app.services.portal_excuse import desired_status, write_attendance


def test_recognized_late_and_early_leave_have_no_penalty():
    assert attendance_penalty("LATE_UNDER10", "PRE", True) == (0, 0)
    assert attendance_penalty("LATE_OVER10", None, True) == (0, 0)
    assert attendance_penalty("EARLY_LEAVE", "POST", True) == (0, 0)


def test_unrecognized_keeps_matrix():
    assert attendance_penalty("LATE_OVER10", "POST", False) == (-2, -3000)
    assert attendance_penalty("EARLY_LEAVE", None, False) == (-2, -4000)


def test_recognized_flag_does_not_touch_absent():
    assert attendance_penalty("ABSENT", "PRE", True) == (-4, -4000)


def test_approved_late_keeps_late_status():
    assert desired_status("LATE", "RECOGNIZED", "APPROVED", "PENDING") == "LATE_UNDER10"
    assert desired_status("EARLY_LEAVE", "RECOGNIZED", "APPROVED", "EARLY_LEAVE", applied="EARLY_LEAVE") is None


def test_approved_absent_still_excused():
    assert desired_status("ABSENT", "RECOGNIZED", "APPROVED", "ABSENT", applied="ABSENT") == "EXCUSED"


def _sub(category, review):
    return SimpleNamespace(category=category, excuse_type="PRE", reason_kind="RECOGNIZED", review=review,
                           created_at=datetime(2026, 10, 5, 5, 0, tzinfo=timezone.utc), reason="r", applied_status=None)


def test_write_sets_recognized_flag_only_for_approved_late():
    att = SimpleNamespace(status="PENDING", excuse_type=None, excuse_text=None, is_recognized=False)
    write_attendance(att, _sub("LATE", "PENDING"))
    assert (att.status, att.is_recognized) == ("LATE_UNDER10", False)
    sub = _sub("LATE", "APPROVED"); sub.applied_status = "LATE_UNDER10"
    write_attendance(att, sub)
    assert (att.status, att.is_recognized) == ("LATE_UNDER10", True)
    sub.review = "REJECTED"
    write_attendance(att, sub)
    assert (att.status, att.is_recognized) == ("LATE_UNDER10", False)


def test_write_absent_approved_is_excused_without_flag():
    att = SimpleNamespace(status="PENDING", excuse_type=None, excuse_text=None, is_recognized=False)
    sub = _sub("ABSENT", "APPROVED")
    write_attendance(att, sub)
    assert (att.status, att.is_recognized) == ("EXCUSED", False)


def test_normal_submission_does_not_touch_staff_recognized_flag():
    att = SimpleNamespace(status="LATE_UNDER10", excuse_type="PRE", excuse_text=None, is_recognized=True)
    sub = _sub("LATE", None); sub.reason_kind = "NORMAL"; sub.applied_status = "LATE_UNDER10"
    write_attendance(att, sub)
    assert att.is_recognized is True


def test_attendance_update_accepts_recognized_flag():
    from app.schemas.attendance import AttendanceUpdate
    assert AttendanceUpdate(is_recognized=True).model_dump(exclude_unset=True) == {"is_recognized": True}
