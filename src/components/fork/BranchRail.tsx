import { useMemo, useState } from "react";
import { Tag } from "lucide-react";
import { branchSummaries, layoutRail, laneColorVar, pathTo, type Conversation } from "@/lib/fork-tree";

const ROW = 30;
const LANE = 22;
const PAD = 12;

export function BranchRail({
  conv, onJump, onLabel,
}: { conv: Conversation; onJump: (id: string) => void; onLabel: (id: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const { rows, lanes } = useMemo(() => layoutRail(conv), [conv]);
  const active = useMemo(() => new Set(pathTo(conv, conv.activeId)), [conv]);
  const index = useMemo(() => Object.fromEntries(rows.map((r, i) => [r.id, i])), [rows]);
  const width = PAD * 2 + Math.max(lanes - 1, 0) * LANE;
  const x = (l: number) => PAD + l * LANE;
  const y = (i: number) => (i + 1) * ROW + ROW / 2;
  const branches = useMemo(() => branchSummaries(conv), [conv]);
  const laneStart = useMemo(() => {
    const seen = new Set<number>();
    const out = new Set<string>();
    for (const r of rows) if (!seen.has(r.lane)) { seen.add(r.lane); if (r.lane > 0) out.add(r.id); }
    return out;
  }, [rows]);

  if (!rows.length)
    return <p className="p-4 font-mono text-[11px] text-muted-foreground">No messages yet. The trunk starts here.</p>;

  return (
    <div>
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {branches.map((b, i) => (
          <button
            key={b.tipId}
            onClick={() => onJump(b.tipId)}
            title={`Open ${b.lane === 0 ? "main" : `branch ${b.lane}`}: ${b.name}`}
            className={`flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] ${b.isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"}`}
            style={{ borderColor: laneColorVar(b.lane) }}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: laneColorVar(b.lane) }} />
            <span className="shrink-0">{b.lane === 0 ? "main" : `branch ${b.lane}`}</span>
            <span className="truncate">{b.name}</span>
            <span className="shrink-0 opacity-60">· {b.length}</span>
            {b.isActive && <span className="shrink-0 text-primary">● here</span>}
          </button>
        ))}
      </div>
      {branches.length < 2 && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">One branch so far — hover any message and click Branch to create one.</p>
      )}
    <div className="relative" style={{ height: (rows.length + 1) * ROW }}>
      <svg className="absolute left-0 top-0" width={width} height={(rows.length + 1) * ROW} aria-hidden>
        <rect x={x(0) - 5} y={y(-1) - 5} width={10} height={10} rx={2} fill="var(--lane-0)" />
        {rows.map((r, i) => {
          const pi = r.parentId && r.parentId !== conv.rootId ? (index[r.parentId] as number) : -1;
          const x1 = x(r.parentLane);
          const y1 = y(pi);
          const x2 = x(r.lane);
          const y2 = y(i);
          const on = active.has(r.id);
          const d =
            x1 === x2
              ? `M${x1} ${y1} L${x2} ${y2}`
              : `M${x1} ${y1} L${x2 - 6} ${y1} Q${x2} ${y1} ${x2} ${y1 + 6} L${x2} ${y2}`;
          return (
            <path
              key={r.id}
              d={d}
              fill="none"
              stroke={laneColorVar(r.lane)}
              strokeWidth={on ? 2.5 : 1.5}
              strokeOpacity={on ? 1 : 0.35}
            />
          );
        })}
        {rows.map((r, i) => {
          const on = active.has(r.id);
          const kidsOf = conv.nodes[r.id]?.children ?? [];
          const forks = kidsOf.length > 1 || kidsOf.some((id) => conv.nodes[id]?.branch);
          if (forks) {
            const cx = x(r.lane), cy = y(i), k = 6.5;
            return (
              <path key={r.id} d={`M${cx} ${cy - k} L${cx + k} ${cy} L${cx} ${cy + k} L${cx - k} ${cy} Z`}
                fill={on ? laneColorVar(r.lane) : "var(--background)"} stroke={laneColorVar(r.lane)} strokeWidth={2} />
            );
          }
          return (
            <circle
              key={r.id}
              cx={x(r.lane)}
              cy={y(i)}
              r={r.id === conv.activeId ? 5.5 : 4}
              fill={on ? laneColorVar(r.lane) : "var(--background)"}
              stroke={laneColorVar(r.lane)}
              strokeWidth={2}
              strokeOpacity={on ? 1 : 0.5}
            />
          );
        })}
      </svg>
      <div className="absolute right-0 flex items-center pl-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground" style={{ top: 0, height: ROW, left: width }}>start</div>
      {rows.map((r, i) => {
        const label = conv.labels?.[r.id];
        const kidIds = conv.nodes[r.id]?.children ?? [];
        // A branch made from the latest reply leaves main ending here, so it still counts as a split.
        const kids = kidIds.length + (kidIds.length > 0 && kidIds.every((id) => conv.nodes[id]?.branch) ? 1 : 0);
        const startIdx = laneStart.has(r.id) ? r.lane : -1;
        return (
          <div
            key={r.id}
            className={`group absolute right-0 flex items-center gap-1 rounded-sm border-l-2 pl-1.5 pr-1 hover:bg-accent ${active.has(r.id) ? "text-foreground" : "text-muted-foreground opacity-50"}`}
            style={{ top: (i + 1) * ROW, height: ROW, left: width, borderLeftColor: laneColorVar(r.lane) }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <button onClick={() => onJump(r.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left font-mono text-[11px]">
              <span className="shrink-0 opacity-60">{r.role === "user" ? "you" : "ai"}</span>
              {startIdx >= 0 && (
                <span className="shrink-0 rounded border px-1 text-[9px] uppercase" style={{ borderColor: laneColorVar(r.lane), color: laneColorVar(r.lane) }}>branch {r.lane}</span>
              )}
              {kids > 1 && <span className="shrink-0 text-[9px] uppercase" style={{ color: laneColorVar(r.lane) }}>splits ×{kids}</span>}
              {label && (
                <span className="shrink-0 rounded px-1 text-[10px] text-background" style={{ background: laneColorVar(r.lane) }}>{label}</span>
              )}
              <span className="truncate">{r.content.replace(/\s+/g, " ") || "…"}</span>
            </button>
            <button aria-label="Label branch" onClick={() => onLabel(r.id)} className="shrink-0 rounded p-0.5 opacity-0 hover:bg-background group-hover:opacity-100 focus-visible:opacity-100">
              <Tag className="size-3" />
            </button>
          </div>
        );
      })}
      {hover !== null && rows[hover] && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 w-60 rounded-md border border-border bg-popover p-2 text-[11px] text-popover-foreground shadow-lg"
          style={{ top: (hover + 2) * ROW, left: Math.min(width, 24) }}
        >
          <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="size-1.5 rounded-full" style={{ background: laneColorVar(rows[hover]!.lane) }} />
            {rows[hover]!.role === "user" ? "You" : "Assistant"} · {rows[hover]!.lane === 0 ? "main" : `branch ${rows[hover]!.lane}`}
            {" · "}{new Date(conv.nodes[rows[hover]!.id]!.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <p className="line-clamp-5 whitespace-pre-wrap">{rows[hover]!.content || "…"}</p>
          {(conv.nodes[rows[hover]!.id]!.children.length > 1) && (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">Splits into {conv.nodes[rows[hover]!.id]!.children.length} branches</p>
          )}
        </div>
      )}
    </div>
    </div>
  );
}
