import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCircle2, Mic, Presentation, Vote } from "lucide-react";
import { cn } from "@/lib/utils";
import { errMsg } from "@/hooks/useExcuses";
import { useCastBallot, useMemberOpenVotes, VOTE_DESC, VOTE_LABEL, type MemberVote as Ballot, type Person, type VoteCategory } from "@/hooks/useSessionVotes";

const CATS: VoteCategory[] = ["OFF", "OPI"];

/** 오프·오피 투표 — 누르면 바로 저장, 마감 전까지 바꿀 수 있다. 결과는 운영진만 본다. */
export default function MemberVote() {
    const navigate = useNavigate();
    const { data: votes, isLoading } = useMemberOpenVotes();

    return (
        <main className="mx-auto w-full max-w-lg px-4 py-6 space-y-5">
            <button onClick={() => navigate("/member")} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
                <ArrowLeft className="w-4 h-4" />홈
            </button>
            {isLoading ? (
                <div className="py-20 text-center text-sm text-gray-400">불러오는 중…</div>
            ) : !votes?.length ? (
                <div className="py-20 text-center space-y-2">
                    <Vote className="w-10 h-10 mx-auto text-gray-300" />
                    <p className="text-sm font-semibold text-gray-600">지금 참여할 수 있는 투표가 없습니다</p>
                    <p className="text-xs text-gray-400">투표가 마감되었거나, 오늘 출석 명단에 없는 경우입니다.</p>
                </div>
            ) : (
                votes.map((v) => <VoteForm key={v.id} vote={v} />)
            )}
        </main>
    );
}

function VoteForm({ vote }: { vote: Ballot }) {
    const cast = useCastBallot();
    const cats = CATS.filter((c) => vote.candidates[c]);
    const team = vote.kind === "TEAM";

    // 고르는 건 화면에서만, '투표 제출'을 눌러야 저장된다
    const saved = vote.my;
    const valid = (d: Ballot["my"]) => Object.fromEntries(
        cats.filter((c) => d[c] && vote.candidates[c]!.some((p) => p.id === d[c])).map((c) => [c, d[c]]),
    ) as Ballot["my"];
    const [draft, setDraft] = useState<Ballot["my"]>(() => valid(saved));
    const dirty = cats.some((c) => draft[c] !== saved[c]);
    // 서버 값이 바뀌면(운영진이 후보를 바꿔 내 표가 지워지는 등) 아직 안 건드린 화면은 따라간다
    const savedKey = JSON.stringify(saved);
    useEffect(() => { if (!dirty) setDraft(valid(saved)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
    // 후보에서 빠진 사람을 골라둔 채면 걸러낸다
    const candKey = JSON.stringify(vote.candidates);
    useEffect(() => { setDraft((d) => valid(d)); }, [candKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const submitted = cats.every((c) => saved[c]);
    const complete = cats.every((c) => draft[c]);
    // 제출 안 한 선택이 있으면 창을 닫거나 새로고침할 때 한 번 묻는다
    useEffect(() => {
        if (!dirty) return;
        const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", h);
        return () => window.removeEventListener("beforeunload", h);
    }, [dirty]);

    const pick = (cat: VoteCategory, id: number) =>
        setDraft((d) => ({ ...d, [cat]: d[cat] === id ? undefined : id })); // 같은 걸 다시 누르면 취소
    const submit = () => cast.mutate(
        { id: vote.id, ...Object.fromEntries(cats.map((c) => [c, draft[c] ?? null])) },
        {
            onSuccess: () => toast.success(submitted ? "다시 제출했습니다" : "투표를 제출했습니다"),
            onError: (e) => toast.error(errMsg(e, "제출하지 못했습니다. 다시 눌러주세요")),
        },
    );

    const chosen = cats.filter((c) => draft[c]).length;

    return (
        <section className="space-y-4">
            {/* 투표 머리 — 이 화면에서 유일하게 색을 크게 쓰는 곳. 몇 부문을 골랐는지 한눈에 */}
            <div className="rounded-3xl bg-gradient-to-br from-violet-600 to-fuchsia-600 p-5 text-white shadow-lg shadow-violet-200">
                <p className="text-xs font-medium text-white/70">
                    {vote.session_week_num}주차 {vote.session_title}{vote.group_num != null && `, ${vote.group_num}분반`}
                </p>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
                    {vote.round > 1 ? "동률 재투표" : "오프·오피 투표"}
                </h1>
                <p className="mt-1.5 text-sm text-white/85 [word-break:keep-all]">
                    {vote.round > 1 ? "동률이 나와 동률 후보끼리 한 번 더 뽑습니다. " : ""}
                    {team ? "부문마다 한 팀을 골라주세요. 자기 팀은 목록에 없습니다." : "부문마다 한 명을 골라주세요. 본인은 목록에 없습니다."}
                </p>
                <div className="mt-4 flex items-center gap-2">
                    {cats.map((c) => (
                        <span key={c} className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                            draft[c] ? "bg-white text-violet-700" : "bg-white/15 text-white/80")}>
                            {draft[c] ? <Check className="w-3.5 h-3.5" /> : <span className="w-1.5 h-1.5 rounded-full bg-white/60" />}
                            {VOTE_LABEL[c]}
                        </span>
                    ))}
                    <span className="ml-auto text-xs text-white/70 tabular-nums">{chosen}/{cats.length} 선택</span>
                </div>
            </div>

            {cats.map((cat) => {
                const Icon = cat === "OFF" ? Mic : Presentation;
                const picked = vote.candidates[cat]!.find((p) => p.id === draft[cat]);
                return (
                    <div key={cat} className="rounded-2xl bg-white border border-gray-200 p-4">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                                <Icon className="w-5 h-5" />
                            </span>
                            <div className="min-w-0">
                                <p className="font-bold text-gray-900 leading-tight">{VOTE_LABEL[cat]}</p>
                                <p className="text-xs text-gray-400">{VOTE_DESC[cat]}{team && " 팀"}</p>
                            </div>
                            <span className={cn("ml-auto max-w-[45%] truncate rounded-full px-2.5 py-1 text-xs font-semibold",
                                picked ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-400")}>
                                {picked ? picked.name : "아직 안 고름"}
                            </span>
                        </div>
                        <div className={cn("grid gap-2", team ? "grid-cols-1" : "grid-cols-3")}>
                            {vote.candidates[cat]!.map((p) => (
                                <Candidate key={p.id} person={p} team={team} on={draft[cat] === p.id} onClick={() => pick(cat, p.id)} />
                            ))}
                        </div>
                    </div>
                );
            })}

            <p className="px-1 text-xs text-gray-400 [word-break:keep-all]">
                마감 전까지 바꿔서 다시 제출할 수 있습니다. 결과와 투표 내용은 운영진만 봅니다.
            </p>

            {/* 제출 막대 — 하단 탭 바로 위에 붙어 있어 스크롤해도 늘 보인다 */}
            <div className="sticky bottom-[76px] z-10 pt-2">
                <div className={cn("rounded-2xl border p-3 shadow-lg backdrop-blur flex items-center gap-3",
                    !dirty && submitted ? "bg-emerald-50/95 border-emerald-200" : "bg-white/95 border-gray-200")}>
                    <div className="min-w-0 flex-1 text-sm [word-break:keep-all]">
                        {!dirty && submitted ? (
                            <p className="font-semibold text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 shrink-0" />제출 완료</p>
                        ) : !complete ? (
                            <p className="font-semibold text-gray-600">{cats.filter((c) => !draft[c]).map((c) => VOTE_LABEL[c]).join("·")}를 골라주세요</p>
                        ) : (
                            <p className="font-semibold text-violet-700">{submitted ? "바꾼 내용은 다시 제출해야 반영됩니다" : "다 골랐습니다. 제출해 주세요"}</p>
                        )}
                    </div>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={submit}
                        disabled={!complete || !dirty || cast.isPending}
                        className="shrink-0 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-400 transition-colors">
                        {cast.isPending ? "제출 중…" : submitted ? "다시 제출" : "투표 제출"}
                    </motion.button>
                </div>
            </div>
        </section>
    );
}

function Candidate({ person, team, on, onClick }: { person: Person; team: boolean; on: boolean; onClick: () => void }) {
    const mark = (
        <AnimatePresence>
            {on && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    className="w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3" strokeWidth={3} />
                </motion.span>
            )}
        </AnimatePresence>
    );
    return (
        <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} aria-pressed={on}
            className={cn("rounded-xl border-2 transition-colors min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
                team ? "flex items-center gap-3 px-4 py-3 text-left" : "flex items-center justify-center gap-1.5 px-2 py-3",
                on ? "border-violet-500 bg-violet-50" : "border-gray-100 bg-gray-50 active:bg-gray-100")}>
            {!team && mark}
            <span className={cn("min-w-0", team && "flex-1")}>
                <span className={cn("block truncate text-sm font-semibold", on ? "text-violet-700" : "text-gray-800")}>{person.name}</span>
                {person.sub && <span className="block truncate text-xs text-gray-400 mt-0.5">{person.sub}</span>}
            </span>
            {team && mark}
        </motion.button>
    );
}
