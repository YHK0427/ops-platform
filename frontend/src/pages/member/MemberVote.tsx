import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, Check, Vote } from "lucide-react";
import { cn } from "@/lib/utils";
import { errMsg } from "@/hooks/useExcuses";
import { useCastBallot, useMemberOpenVotes, voteKeys, VOTE_DESC, VOTE_LABEL, type MemberVote as Ballot, type VoteCategory } from "@/hooks/useSessionVotes";

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

    return (
        <section className="space-y-5">
            <div>
                <p className="text-xs font-medium text-gray-400">{vote.session_week_num}주차 · {vote.session_title}{vote.group_num != null && ` · ${vote.group_num}분반`}</p>
                <h1 className="text-xl font-extrabold text-gray-900 mt-0.5">
                    오프·오피 {vote.round > 1 ? "재투표" : "투표"}
                </h1>
                <p className="text-sm text-gray-500 mt-1 [word-break:keep-all]">
                    {vote.round > 1 ? "동률이 나와 한 번 더 뽑습니다. " : ""}
                    {team ? "부문마다 한 팀을 골라주세요. 자기 팀은 목록에 없습니다." : "부문마다 한 명을 골라주세요."} 마감 전까지 바꿀 수 있고, 결과는 운영진만 봅니다.
                </p>
            </div>

            {cats.map((cat) => (
                <div key={cat} className="rounded-2xl bg-white border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-baseline justify-between mb-3">
                        <p className="font-bold text-gray-900">{VOTE_LABEL[cat]} <span className="text-xs font-normal text-gray-400">{VOTE_DESC[cat]}</span></p>
                        {vote.my[cat] && <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" />선택함</span>}
                    </div>
                    <div className={cn("grid gap-2", team ? "grid-cols-2" : "grid-cols-3")}>
                        {vote.candidates[cat]!.map((p) => {
                            const on = vote.my[cat] === p.id;
                            return (
                                <motion.button key={p.id} whileTap={{ scale: 0.96 }}
                                    onClick={() => pick(cat, p.id)}
                                    className={cn("rounded-xl border-2 px-1 py-2.5 text-sm font-semibold transition-colors flex flex-col items-center justify-center min-w-0",
                                        on ? "border-rose-500 bg-rose-50 text-rose-700" : "border-gray-200 text-gray-700 active:bg-gray-50")}>
                                    <span className="flex items-center gap-1 max-w-full">{on && <Check className="w-4 h-4 shrink-0" />}<span className="truncate">{p.name}</span></span>
                                    {p.sub && <span className="text-[11px] font-normal text-gray-400 truncate max-w-full px-1">{p.sub}</span>}
                                </motion.button>
                            );
                        })}
                    </div>
                </div>
            ))}

            {done && (
                <p className="text-sm text-center font-semibold text-emerald-600">
                    투표를 마쳤습니다. 마감 전까지는 바꿀 수 있습니다.
                </p>
            )}
        </section>
    );
}
