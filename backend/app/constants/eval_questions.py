"""발표 성장 리포트 평가 문항 정의 (9문항, 3영역 x 3문항)"""

EVAL_QUESTIONS = [
    # ── 기획 ──
    {
        "key": "planning_consistency",
        "domain": "PLANNING",
        "order": 1,
        "label": "일관성",
        "self_text": "나는 발표의 전개가 하나의 핵심 메시지로 자연스럽게 귀결되도록 구성했다",
        "audience_text": "발표자는 발표의 전개가 하나의 핵심 메시지로 자연스럽게 귀결되도록 구성했다",
    },
    {
        "key": "planning_delivery",
        "domain": "PLANNING",
        "order": 2,
        "label": "전달력",
        "self_text": "나는 청중의 수준과 관심사를 고려하여 발표를 의도적으로 설계했다",
        "audience_text": "발표자는 청중의 수준과 관심사를 고려하여 발표를 의도적으로 설계했다",
    },
    {
        "key": "planning_originality",
        "domain": "PLANNING",
        "order": 3,
        "label": "특수성",
        "self_text": "나는 나만의 관점과 해석이 드러난 차별화된 메시지를 전달했다",
        "audience_text": "발표자는 나만의 관점과 해석이 드러난 차별화된 메시지를 전달했다",
    },
    # ── 디자인 ──
    {
        "key": "design_readability",
        "domain": "DESIGN",
        "order": 4,
        "label": "가독성",
        "self_text": "나는 슬라이드 내 요소(글자, 도표, 이미지 등)의 크기와 배치를 청중의 시선을 고려해 읽기 쉽게 구성했다",
        "audience_text": "발표자는 슬라이드의 글자 크기와 배치를 청중의 시선을 고려해 읽기 쉽게 구성했다",
    },
    {
        "key": "design_support",
        "domain": "DESIGN",
        "order": 5,
        "label": "지원성",
        "self_text": "슬라이드가 스피치의 핵심 메시지와 설명을 시각적으로 적절히 보조하고 있다",
        "audience_text": "슬라이드가 스피치의 핵심 메시지와 설명을 시각적으로 적절히 보조하고 있다",
    },
    {
        "key": "design_creativity",
        "domain": "DESIGN",
        "order": 6,
        "label": "통일성",
        "self_text": "나는 파워포인트의 기능과 디자인 요소를 발표의 분위기와 목적에 맞게 의도적으로 활용했다",
        "audience_text": "발표자는 파워포인트의 기능과 디자인 요소를 발표의 분위기와 목적에 맞게 의도적으로 활용했다",
    },
    # ── 스피치 ──
    {
        "key": "speech_expression",
        "domain": "SPEECH",
        "order": 7,
        "label": "표현력",
        "self_text": "나는 강조의 위치에 맞게 음량, 속도, 호흡, 어미 등을 적절히 조절했다",
        "audience_text": "발표자는 강조의 위치에 맞게 음량, 속도, 호흡, 어미 등을 적절히 조절했다",
    },
    {
        "key": "speech_fluency",
        "domain": "SPEECH",
        "order": 8,
        "label": "유창성",
        "self_text": "나는 발표 중 말이 끊기거나 막히지 않고, 흐름을 유지하며 자연스럽게 이어갔다",
        "audience_text": "발표자는 발표 중 말이 끊기거나 막히지 않고, 흐름을 유지하며 자연스럽게 이어갔다",
    },
    {
        "key": "speech_communication",
        "domain": "SPEECH",
        "order": 9,
        "label": "소통능력",
        "self_text": "나는 발표 중 슬라이드에만 집중하지 않고, 청중과 시선 교환 및 반응을 주고받으며 발표했다",
        "audience_text": "발표자는 발표 중 슬라이드에만 집중하지 않고, 청중과 시선 교환 및 반응을 주고받으며 발표했다",
    },
]

VALID_QUESTION_KEYS = {q["key"] for q in EVAL_QUESTIONS}

DOMAINS = ["PLANNING", "DESIGN", "SPEECH"]

DOMAIN_LABELS = {
    "PLANNING": "기획",
    "DESIGN": "디자인",
    "SPEECH": "스피치",
}

QUESTION_BY_KEY = {q["key"]: q for q in EVAL_QUESTIONS}

QUESTIONS_BY_DOMAIN = {
    domain: [q for q in EVAL_QUESTIONS if q["domain"] == domain]
    for domain in DOMAINS
}
