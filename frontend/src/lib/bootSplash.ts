import { useEffect } from "react";

/**
 * 첫 접속 로고 화면(index.html 의 #boot-splash).
 * 앱이 떠도 로그인 확인·화면 조각 받기가 이어지면 로딩 표시가 여러 번 바뀌며 깜빡인다.
 * 그래서 첫 화면 내용이 실제로 그려질 때까지 로고 화면을 유지하고, 그 뒤 한 번만 부드럽게 걷어낸다.
 * 첫 로딩 중의 로딩 표시들은 useHoldSplash() 로 로고 화면을 붙잡는다.
 */
let holds = 0;
let done = false;

function hide() {
    if (done || holds > 0) return;
    done = true;
    const el = document.getElementById("boot-splash");
    if (!el) return;
    el.classList.add("boot-out");
    window.setTimeout(() => el.remove(), 400);
}

/** 로딩 표시가 사라진 뒤 다음 로딩이 곧바로 이어질 수 있어 한 박자 기다렸다 판단한다. */
export function hideSplashSoon() {
    window.setTimeout(hide, 50);
}

/** 첫 로딩이 이미 끝났으면(로고 화면 없음) false — 이후 로딩 표시는 평소대로 보여준다. */
export function splashActive() {
    return !done;
}

export function useHoldSplash() {
    useEffect(() => {
        if (done) return;
        holds++;
        return () => { holds--; hideSplashSoon(); };
    }, []);
}

// 어떤 이유로든 로딩 표시가 끝나지 않아도 로고 화면이 오류 화면을 영영 가리지 않게
window.setTimeout(() => { holds = 0; hide(); }, 15000);

/** 조건부로 로고 화면을 붙잡을 때: {isLoading && <HoldSplash />} */
export function HoldSplash() {
    useHoldSplash();
    return null;
}
