// 패치노트 본문: 평문 + 이미지 줄. 이미지는 우리 서버에 올린 공지 이미지 경로만 허용한다.
const IMG_LINE = /^!\[\]\((\/api\/v1\/notifications\/img\/[0-9a-f]{32})\)$/;

export const imageLine = (url: string) => `![](${url})`;

export function PatchNoteBody({ body }: { body: string }) {
    const blocks: ({ img: string } | { text: string })[] = [];
    for (const line of body.split("\n")) {
        const m = line.trim().match(IMG_LINE);
        if (m) blocks.push({ img: m[1] });
        else {
            const last = blocks[blocks.length - 1];
            if (last && "text" in last) last.text += "\n" + line;
            else blocks.push({ text: line });
        }
    }
    return (
        <div className="space-y-2">
            {blocks.map((b, i) => "img" in b ? (
                <a key={i} href={b.img} target="_blank" rel="noreferrer" className="block">
                    <img src={b.img} alt="" loading="lazy"
                        className="max-h-[50vh] max-w-full mx-auto rounded-lg border border-[var(--color-border)]" />
                </a>
            ) : b.text.trim() ? (
                <div key={i} className="whitespace-pre-wrap leading-relaxed">{b.text.replace(/^\n+|\n+$/g, "")}</div>
            ) : null)}
        </div>
    );
}
