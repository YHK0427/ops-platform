"""포털 사유서 판정 — 마감 경계와 출결 상태 규칙."""
from datetime import date, datetime, timezone

from app.services.portal_excuse import (
    build_excuse_text, classify, desired_status, edit_deadline,
)

D = date(2026, 10, 7)  # 수요일 세션
UTC = timezone.utc


def test_pre_until_prev_day_2159_kst():
    assert classify(D, datetime(2026, 10, 6, 12, 59, 59, tzinfo=UTC)) == "PRE"


def test_post_one_second_after_pre_deadline():
    assert classify(D, datetime(2026, 10, 6, 13, 0, 0, tzinfo=UTC)) == "POST"


def test_post_until_next_day_2159_kst():
    assert classify(D, datetime(2026, 10, 8, 12, 59, 59, tzinfo=UTC)) == "POST"


def test_closed_after_post_deadline():
    assert classify(D, datetime(2026, 10, 8, 13, 0, 0, tzinfo=UTC)) is None


def test_closed_date_does_not_block_later_date():
    now = datetime(2026, 10, 8, 14, 0, 0, tzinfo=UTC)  # 10/8 23:00 KST
    assert classify(D, now) is None                     # 10/7 세션: 사후 마감 지남
    assert classify(date(2026, 10, 14), now) == "PRE"   # 다음 주 세션: 사전 가능


def test_edit_deadline():
    assert edit_deadline(D, "PRE") == datetime(2026, 10, 6, 12, 59, 59, tzinfo=UTC)
    assert edit_deadline(D, "POST") == datetime(2026, 10, 8, 12, 59, 59, tzinfo=UTC)


def test_status_preset_from_pending_or_present():
    assert desired_status("ABSENT", "NORMAL", None, "PENDING") == "ABSENT"
    assert desired_status("LATE", "NORMAL", None, "PRESENT") == "LATE_UNDER10"


def test_staff_set_status_is_not_overwritten():
    assert desired_status("LATE", "NORMAL", None, "LATE_OVER10") is None
    assert desired_status("ABSENT", "NORMAL", None, "EXCUSED") is None


def test_recognized_pending_stays_category():
    assert desired_status("ABSENT", "RECOGNIZED", "PENDING", "PENDING") == "ABSENT"


def test_recognized_approved_becomes_excused():
    assert desired_status("ABSENT", "RECOGNIZED", "APPROVED", "ABSENT") == "EXCUSED"


def test_rejected_reverts_excused():
    assert desired_status("ABSENT", "RECOGNIZED", "REJECTED", "EXCUSED") == "ABSENT"


def test_category_edit_replaces_our_previous_value():
    assert desired_status("ABSENT", "NORMAL", None, "LATE_UNDER10", prev_category="LATE") == "ABSENT"


def test_no_change_returns_none():
    assert desired_status("ABSENT", "NORMAL", None, "ABSENT") is None


def test_excuse_text_header():
    text = build_excuse_text(
        category="ABSENT", excuse_type="PRE", reason_kind="RECOGNIZED", review="PENDING",
        created_at=datetime(2026, 10, 5, 5, 3, tzinfo=UTC), reason="병원",
    )
    assert text == "[포털] 결석 · 사전 · 인정사유(승인 대기)\n제출 2026-10-05 14:03\n---\n병원"


def test_excuse_text_post_normal():
    text = build_excuse_text(
        category="LATE", excuse_type="POST", reason_kind="NORMAL", review=None,
        created_at=datetime(2026, 10, 7, 14, 0, tzinfo=UTC), reason="늦잠",
    )
    assert text == "[포털] 지각 · 사후 · 일반사유\n제출 2026-10-07 23:00\n---\n늦잠"
