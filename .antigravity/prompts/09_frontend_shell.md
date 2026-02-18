# Phase 09: 프론트엔드 기반 세팅 + 공용 컴포넌트
> 참조: `docs/design.md`, `docs/spec_frontend.md`
> 모델: **claude-sonnet-4-5**
> 예상 소요: 3시간

---

## 작업 목표

React 앱 초기 세팅, 디자인 시스템 적용, 공용 컴포넌트를 구현한다.
**`docs/design.md`를 반드시 먼저 읽고 시작할 것.**

---

## 핵심 제약

### 디자인 시스템 (design.md 그대로)
```
배경: #0C0C0F (base), #131318 (surface), #1C1C24 (elevated)
Accent: #6B5FFF (인디고-퍼플)
폰트: Pretendard (한글) + Geist Mono (수치)
Dark mode only (html 태그에 class="dark" 필수)
```

### 절대 사용 금지
```
Inter, Roboto, Arial 폰트
text-white, bg-white, bg-gray-* 클래스
shadow-* 남용
localStorage, sessionStorage
```

---

## 수행 작업 목록

1. **Vite + React + TypeScript 프로젝트 생성**
   ```bash
   npm create vite@latest frontend -- --template react-ts
   cd frontend
   npm install
   ```

2. **의존성 설치**
   ```bash
   npm install @tanstack/react-query axios react-router-dom
   npm install @dnd-kit/core @dnd-kit/sortable
   npm install sonner lucide-react
   npx shadcn@latest init
   npx shadcn@latest add button input select dialog sheet table checkbox dropdown-menu badge tabs
   ```

3. **`frontend/src/index.css`** — `docs/design.md` 섹션 2 CSS 변수 전체 적용
   - CSS 변수 정의 (--bg-base, --accent 등)
   - shadcn dark 오버라이드
   - Pretendard + Geist Mono import
   - `font-feature-settings: "tnum"` (숫자 고정폭)

4. **`tailwind.config.ts`** — `docs/design.md` 섹션 2 확장 그대로 적용

5. **`frontend/src/lib/api.ts`**
   ```typescript
   import axios from 'axios';
   const api = axios.create({ baseURL: '/api/v1' });
   // JWT 인터셉터: localStorage 아닌 메모리 변수에 토큰 저장
   // 401 → 로그인 페이지 리다이렉트
   ```

6. **공용 컴포넌트** (`docs/design.md` 섹션 5 참조)
   - `components/StatusBadge.tsx` — BADGE 매핑 + STATUS_LABEL 한글
   - `components/ScoreDisplay.tsx` — 3분리 표시 + 퇴출/경고 배지
   - `components/WarningBanner.tsx` — error/warning/info 3단계
   - `components/TaskProgressPanel.tsx` — 크롤러 폴링 UI

7. **앱 쉘**
   - `components/Sidebar.tsx` — NavItem active 스타일 포함
   - `components/PageHeader.tsx`
   - `App.tsx` — `docs/spec_frontend.md` 라우트 맵 그대로 구현
   - `pages/LoginPage.tsx`

8. **`index.html`** — `<html class="dark">` 추가

---

## 완료 조건

```bash
# 개발 서버 기동
cd frontend && npm run dev

# 확인:
# 1. http://localhost:5173 → 로그인 페이지 표시
# 2. 배경색 #0C0C0F (완전 다크)
# 3. Pretendard 폰트 로드 확인 (DevTools > Network > Fonts)
# 4. /dashboard 접근 시 로그인 페이지로 리다이렉트 (AuthGuard)
# 5. 로그인 성공 → Dashboard로 이동
```
