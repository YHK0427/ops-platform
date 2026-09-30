import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCircle2, Mic, Presentation, Vote } from "lucide-react";
import { cn } from "@/lib/utils";
import { errMsg } from "@/hooks/useExcuses";
import { useCastBallot, useMemberOpenVotes, voteKeys, VOTE_DESC, VOTE_LABEL, type MemberVote as Ballot, type Person, type VoteCategory } from "@/hooks/useSessionVotes";

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
    const done = cats.every((c) => vote.my[c]);

    // 저장이 끝나기 전에 다른 부문을 눌러도 무시되지 않게 — 누를 때마다 두 부문의 선택 전체를 순서대로 보낸다.
    // 마지막 요청이 마지막으로 누른 상태라 요청 순서가 뒤바뀌어 옛 선택이 남는 일도 없다.
    const qc = useQueryClient();
    const queue = useRef(Promise.resolve());
    const pick = (cat: VoteCategory, id: number) => {
        const next = { ...vote.my, [cat]: vote.my[cat] === id ? undefined : id }; // 같은 걸 다시 누르면 취소
        const body = Object.fromEntries(cats.map((c) => [c, next[c] ?? null]));
        // 화면은 누르는 즉시 — 저장은 뒤에서 순서대로
        qc.setQueryData<Ballot[]>(voteKeys.memberOpen(), (prev) => prev?.map((v) => (v.id === vote.id ? { ...v, my: next } : v)));
        queue.current = queue.current.then(() => cast.mutateAsync({ id: vote.id, ...body }).then(
            () => undefined,
            (e) => { toast.error(errMsg(e, "저장하지 못했습니다")); },
        ));
    };

    const chosen = cats.filter((c) => vote.my[c]).length;

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
                            vote.my[c] ? "bg-white text-violet-700" : "bg-white/15 text-white/80")}>
                            {vote.my[c] ? <Check className="w-3.5 h-3.5" /> : <span className="w-1.5 h-1.5 rounded-full bg-white/60" />}
                            {VOTE_LABEL[c]}
                        </span>
                    ))}
                    <span className="ml-auto text-xs text-white/70 tabular-nums">{chosen}/{cats.length} 선택</span>
                </div>
            </div>

            {cats.map((cat) => {
                const Icon = cat === "OFF" ? Mic : Presentation;
                const picked = vote.candidates[cat]!.find((p) => p.id === vote.my[cat]);
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
                                <Candidate key={p.id} person={p} team={team} on={vote.my[cat] === p.id} onClick={() => pick(cat, p.id)} />
                            ))}
                        </div>
                    </div>
                );
            })}

            <div className={cn("rounded-2xl px-4 py-3 flex items-center gap-3 transition-colors",
                done ? "bg-emerald-50 border border-emerald-200" : "bg-gray-50 border border-gray-200")}>
                {done
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    : <Vote className="w-5 h-5 text-gray-400 shrink-0" />}
                <div className="text-sm [word-break:keep-all]">
                    <p className={cn("font-semibold", done ? "text-emerald-700" : "text-gray-600")}>
                        {done ? "투표를 마쳤습니다" : `${cats.map((c) => VOTE_LABEL[c]).join("·")}를 모두 골라주세요`}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">누를 때마다 바로 저장됩니다. 마감 전까지 바꿀 수 있고, 결과와 투표 내용은 운영진만 봅니다.</p>
                </div>
            </div>
        </section>
    );
}

// 이름 첫 글자 동그라미 색 — 같은 사람은 늘 같은 색
const TONES = [
    "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700", "bg-teal-100 text-teal-700", "bg-indigo-100 text-indigo-700",
];

function Candidate({ person, team, on, onClick }: { person: Person; team: boolean; on: boolean; onClick: () => void }) {
    // 사람은 이름(성 뺀 두 글자), 팀은 팀 이름 첫 글자
    const mark = team ? person.name.trim().slice(0, 1) : person.name.length > 2 ? person.name.slice(-2) : person.name;
    const avatar = (
        <span className={cn("relative rounded-full flex items-center justify-center font-bold shrink-0 transition-shadow",
            team ? "w-10 h-10 text-sm" : "w-12 h-12 text-sm",
            on ? "bg-violet-600 text-white ring-4 ring-violet-100" : TONES[person.id % TONES.length])}>
            {mark}
            <AnimatePresence>
                {on && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 500, damping: 25 }}
                        className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-white text-violet-600 flex items-center justify-center shadow">
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </motion.span>
                )}
            </AnimatePresence>
        </span>
    );
    return (
        <motion.button whileTap={{ scale: 0.96 }} onClick={onClick} aria-pressed={on}
            className={cn("rounded-2xl border-2 transition-colors min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
                team ? "flex items-center gap-3 px-3 py-3 text-left" : "flex flex-col items-center gap-1.5 px-1 pt-3 pb-2.5",
                on ? "border-violet-500 bg-violet-50" : "border-transparent bg-gray-50 active:bg-gray-100")}>
            {avatar}
            <span className="min-w-0 max-w-full">
                <span className={cn("block truncate text-sm font-semibold", on ? "text-violet-700" : "text-gray-800")}>{person.name}</span>
                {person.sub && <span className="block truncate text-xs text-gray-400 mt-0.5">{person.sub}</span>}
            </span>
        </motion.button>
    );
}
