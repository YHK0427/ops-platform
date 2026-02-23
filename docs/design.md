# UnivPT Ops Platform — 디자인 가이드라인 (v2.0 Modernized)
> 개발 시 참고용 | Tailwind CSS + ShadcnUI + **Framer Motion**

---

## 1. 디자인 콘셉트: "Neo-Industrial Command"
기존의 "지휘소" 컨셉을 계승하되, **Glassmorphism(유리 질감)**, **Glow(발광)**, **Smooth Motion(부드러운 움직임)**을 더해 현대적이고 몰입감 있는 인터페이스를 지향한다. 단조로움을 피하기 위해 깊이감(Depth)과 미세한 인터랙션(Micro-interactions)을 강화한다.

> 키워드: `Depth`, `Glow`, `Fluid`, `Tactile`, `Premium Dark`

### 핵심 업그레이드 요소
1.  **Depth & Glass**: 완전한 불투명 배경 대신, 반투명 블러(`backdrop-blur`)와 레이어링을 통해 깊이감을 부여한다.
2.  **Accent Glow**: 포인트 컬러(Red/Accent)를 단순 텍스트/배경색이 아닌, 은은하게 퍼지는 빛(Box-shadow, Gradient)으로 표현한다.
3.  **Motion**: 화면 전환, 리스트 등장, 버튼 인터랙션에 물리 기반 애니메이션을 적용하여 "살아있는" 느낌을 준다.

---

## 2. 컬러 시스템 (v2)

### 팔레트 조정
기존 Zinc 기반에서 더 깊고 푸른빛이 감도는 Black 계열로 변경하여 세련미를 더한다.

```css
:root {
  /* Background */
  --bg-base:       #050505;   /* 거의 완전한 블랙 */
  --bg-surface:    rgba(20, 20, 25, 0.6); /* 반투명 레이어 */
  --bg-elevated:   rgba(30, 30, 35, 0.8); /* 모달 등 */
  
  /* Border */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-default:rgba(255, 255, 255, 0.12);
  --border-highlight: rgba(255, 255, 255, 0.2);

  /* Accent (Red - UnivPT Brand) */
  --accent:        #F43F5E;   /* Rose-500: 기존 Red보다 약간 더 핑크/모던 */
  --accent-glow:   0 0 20px rgba(244, 63, 94, 0.35); /* 네온 효과 */
  --accent-dim:    rgba(244, 63, 94, 0.1);
}
```

### 상태별 컬러 (Status Colors)
- **PRESENT (출석)**: `Green-500` (#22c55e)
- **LATE_UNDER10 (지각 10분↓)**: `Yellow-500` (#eab308)
- **LATE_OVER10 (지각 10분↑)**: `Orange-500` (#f97316)
- **EARLY_LEAVE (조퇴)**: `Purple-500` (#a855f7)
- **ABSENT (결석)**: `Red-500` (#ef4444)
- **EXCUSED (공결/사유)**: `Blue-400` (#60a5fa)
- **PENDING (미처리)**: `Gray-500` (#6b7280)

### Shadcn Override (CSS Variables)
```css
/* index.css */
@layer base {
  :root {
    --background: 0 0% 2%;  /* #050505 */
    --foreground: 210 40% 98%;

    --card: 240 10% 3.9%;
    --card-foreground: 0 0% 98%;
 
    --popover: 240 10% 3.9%;
    --popover-foreground: 0 0% 98%;
 
    --primary: 346 87% 60%; /* Rose-500 */
    --primary-foreground: 355 100% 97%;
 
    --secondary: 240 3.7% 15.9%;
    --secondary-foreground: 0 0% 98%;
 
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
 
    --accent: 240 3.7% 15.9%;
    --accent-foreground: 0 0% 98%;
 
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
 
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 346 87% 60%;
  }
}
```

---

## 3. UI 컴포넌트 스타일링 (v2)

### 3-1. Glass Card
카드는 이제 반투명하고 블러 처리된다. Border는 아주 얇고 은으하게.

```tsx
<div className="
  relative overflow-hidden rounded-xl border border-white/10
  bg-zinc-900/50 backdrop-blur-md
  transition-all duration-300 hover:border-white/20 hover:bg-zinc-900/70
">
  {/* 내부 컨텐츠 */}
</div>
```

### 3-2. Neon Status Badge
배지에도 은은한 Glow를 추가하여 상태를 강조한다.

```tsx
const BADGE_VARIANTS = {
  active: "bg-green-500/10 text-green-400 border-green-500/20 shadow-[0_0_10px_rgba(74,222,128,0.15)]",
  warning: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20 shadow-[0_0_10px_rgba(250,204,21,0.15)]",
  danger: "bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.15)]",
};
```

### 3-3. Gradient Text
섹션 타이틀이나 강조 텍스트에 그라데이션을 적용한다.

```tsx
<h1 className="text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/50">
  Dashboard
</h1>
```

---

## 4. 애니메이션 가이드 (Framer Motion)

### 페이지 진입 (Page Transition)
모든 페이지는 부드럽게 떠오르며 나타난다.

```tsx
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -10 }}
  transition={{ duration: 0.3, ease: "easeOut" }}
>
  {children}
</motion.div>
```

### 리스트 아이템 (Staggered List)
멤버 목록이나 세션 목록은 순차적으로 나타난다.

```tsx
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const item = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0 }
};
```

### 버튼 인터랙션 (Tap Scale)
버튼 클릭 시 살짝 작아지는 효과로 클릭감을 준다.

```tsx
<motion.button whileTap={{ scale: 0.97 }} ... />
```

---

## 5. 레이아웃 업그레이드

### Sidebar
-   **배경**: 완전 불투명 → `backdrop-blur-xl bg-black/50`
-   **Active Item**:
    -   왼쪽에 빛나는 Bar (`w-1 h-full bg-primary absolute left-0 rounded-r-full shadow-[0_0_10px_var(--primary)]`)
    -   배경은 그라데이션 (`bg-gradient-to-r from-primary/10 to-transparent`)

### Background Graphic
body 전체에 은은한 스팟라이트 효과를 주어 공간감을 형성한다.

```css
/* index.css */
body {
  background-color: #050505;
  background-image: 
    radial-gradient(circle at 50% 0%, rgba(244, 63, 94, 0.08) 0%, transparent 40%),
    radial-gradient(circle at 80% 10%, rgba(255, 255, 255, 0.03) 0%, transparent 20%);
  background-attachment: fixed;
}
```

---
