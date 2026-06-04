from app.routers.evaluation import MemberResultDetail


def test_member_result_detail_has_comparison_fields():
    d = MemberResultDetail(
        member_id=1,
        member_name="x",
        self_scores_by_question={},
        self_scores_by_domain={},
        audience_scores_by_question={},
        audience_scores_by_domain={},
        combined_scores_by_domain={},
    )
    assert d.round_type is None
    assert d.initial is None


def test_member_result_detail_nested_initial():
    inner = MemberResultDetail(
        member_id=1,
        member_name="x",
        self_scores_by_question={},
        self_scores_by_domain={},
        audience_scores_by_question={},
        audience_scores_by_domain={},
        combined_scores_by_domain={"PLANNING": 3.0},
        round_type="INITIAL",
    )
    outer = MemberResultDetail(
        member_id=1,
        member_name="x",
        self_scores_by_question={},
        self_scores_by_domain={},
        audience_scores_by_question={},
        audience_scores_by_domain={},
        combined_scores_by_domain={"PLANNING": 4.0},
        round_type="FINAL",
        initial=inner,
    )
    assert outer.initial is not None
    assert outer.initial.round_type == "INITIAL"
    assert outer.initial.initial is None
