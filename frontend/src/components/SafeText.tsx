import { Fragment, type ReactNode } from "react";

/**
 * (레거시) Paperlogy 폰트 파일의 빈 글리프(획 없음) cmap 매핑을 지워서
 * 미지원 문자는 이제 CSS 폰트 스택으로 자동 폴백(GmarketSans 등)됨 —
 * 더 이상 수동으로 감쌀 필요 없음. hangul-fallback 클래스도 제거되어
 * 아래 span은 순수 no-op 래퍼. 혹시 모를 신규 미지원 문자 대비용으로만 남겨둠.
 */
const RARE_HANGUL = new Set<string>([]);

/**
 * 문자열에서 희귀 한글만 찾아 <span class="hangul-fallback">로 감싸 렌더.
 * - 연속된 일반 문자는 하나의 문자열 노드로 유지 (DOM 최소화)
 * - 빈 문자열/undefined/null은 원본 그대로 반환
 */
export function renderSafeHangul(text: string | null | undefined): ReactNode {
    if (!text) return text ?? "";

    const parts: ReactNode[] = [];
    let buffer = "";
    let key = 0;

    for (const ch of Array.from(text)) {
        if (RARE_HANGUL.has(ch)) {
            if (buffer) {
                parts.push(buffer);
                buffer = "";
            }
            parts.push(
                <span key={`h${key++}`} className="hangul-fallback">
                    {ch}
                </span>
            );
        } else {
            buffer += ch;
        }
    }
    if (buffer) parts.push(buffer);

    return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

/**
 * 간단한 래퍼 컴포넌트 — JSX에서 `<SafeText>{title}</SafeText>` 형태로 쓰고 싶을 때.
 */
export function SafeText({ children }: { children: string | null | undefined }) {
    return <>{renderSafeHangul(children)}</>;
}
