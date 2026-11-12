import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatNumber(value: number): string {
    return new Intl.NumberFormat("ko-KR").format(value);
}

/** 기수 포털 경로인지 — "/member" 또는 "/member/…". 운영진 "/members"(멤버 탭)는 아니다. */
export function isMemberPortalPath(path: string): boolean {
    return path === "/member" || path.startsWith("/member/");
}
