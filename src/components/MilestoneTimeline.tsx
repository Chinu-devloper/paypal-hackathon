"use client";

import { useMemo } from "react";
import { cn } from "@/shared/cn";
import { fmtDate, fmtMoney, STATUS_META } from "@/client/helpers";
import type { ItemStatus, LedgerItem } from "@/shared/types";

const DAY_MS = 86_400_000;
const DAY_W = 38;
const ROW_H = 52;
const LABEL_W = 230;
const HEADER_H = 48;

const BAR_COLOR: Partial<Record<ItemStatus, string>> = {
  PAID_OUT: "from-emerald-600 to-emerald-500",
  CAPTURED: "from-emerald-600 to-emerald-500",
  AUTHORIZED: "from-pp-navy to-pp-blue",
  AI_AUDITING: "from-violet-700 to-violet-500",
  REVISION_NEEDED: "from-amber-600 to-amber-500",
  SECURITY_FLAGGED: "from-red-700 to-red-500",
  READY_TO_ORDER: "from-sky-700 to-sky-500",
  REFUNDED: "from-fuchsia-700 to-fuchsia-500",
  VOIDED: "from-slate-700 to-slate-600",
};

const dayIndex = (iso: string, origin: number) => Math.round((new Date(`${iso}T00:00:00Z`).getTime() - origin) / DAY_MS);

interface Props {
  items: LedgerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
}

export function MilestoneTimeline({ items, selectedId, onSelect, onInspect }: Props) {
  const layout = useMemo(() => {
    if (items.length === 0) return null;
    const starts = items.map((i) => new Date(`${i.startDate}T00:00:00Z`).getTime());
    const ends = items.map((i) => new Date(`${i.endDate}T00:00:00Z`).getTime());
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const origin = Math.min(...starts, todayUtc) - 2 * DAY_MS;
    const last = Math.max(...ends, todayUtc);
    const totalDays = Math.round((last + 4 * DAY_MS - origin) / DAY_MS) + 1;

    const hasDependents = new Set(items.flatMap((i) => i.dependencies));
    const terminal = items.filter((i) => !hasDependents.has(i.id));
    const payoutDay = Math.round((last - origin) / DAY_MS) + 2;
    const total = items.reduce((s, i) => s + i.amount, 0);

    return { origin, totalDays, todayIdx: Math.round((todayUtc - origin) / DAY_MS), terminal, payoutDay, total };
  }, [items]);

  if (!layout) return <p className="text-sm text-slate-400">No milestones to display.</p>;
  const { origin, totalDays, todayIdx, terminal, payoutDay, total } = layout;
  const rowCount = items.length + 1;
  const width = totalDays * DAY_W;
  const height = rowCount * ROW_H;
  const rowIndex = new Map(items.map((i, idx) => [i.id, idx]));
  const y = (idx: number) => idx * ROW_H + ROW_H / 2;
  const barX = (i: LedgerItem) => dayIndex(i.startDate, origin) * DAY_W;
  const barEndX = (i: LedgerItem) => (dayIndex(i.endDate, origin) + 1) * DAY_W;

  const arrows: Array<{ key: string; d: string }> = [];
  for (const item of items) {
    for (const dep of item.dependencies) {
      const from = items.find((i) => i.id === dep);
      if (!from) continue;
      const x1 = barEndX(from) + 10;
      const y1 = y(rowIndex.get(from.id) as number);
      const x2 = barX(item) - 2;
      const y2 = y(rowIndex.get(item.id) as number);
      const mid = Math.max(x1 + 8, Math.min(x2 - 8, (x1 + x2) / 2));
      arrows.push({ key: `${dep}-${item.id}`, d: `M${x1},${y1} H${mid} V${y2} H${x2}` });
    }
  }
  const payoutX = payoutDay * DAY_W;
  const payoutY = y(items.length);
  for (const t of terminal) {
    const x1 = barEndX(t) + 10;
    const y1 = y(rowIndex.get(t.id) as number);
    arrows.push({ key: `payout-${t.id}`, d: `M${x1},${y1} H${x1 + 10} V${payoutY} H${payoutX - 6}` });
  }

  return (
    <div className="rounded-xl border border-ink-600/60 bg-ink-900/60">
      <div className="flex items-center justify-between border-b border-ink-600/50 px-4 py-2 text-xs text-slate-400">
        <span>Milestone schedule & PayPal cash-flow unlock dates. Click a bar to inspect and highlight its ledger row.</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rotate-45 bg-emerald-400" aria-hidden /> payment unlock</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-0.5 bg-rose-400" aria-hidden /> today</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="relative" style={{ width: LABEL_W + width, minWidth: "100%" }}>
          <div className="sticky top-0 z-10 flex border-b border-ink-600/50 bg-ink-900" style={{ height: HEADER_H }}>
            <div className="sticky left-0 z-20 flex shrink-0 items-end bg-ink-900 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ width: LABEL_W }}>
              Milestone
            </div>
            <div className="flex">
              {Array.from({ length: totalDays }, (_, d) => {
                const date = new Date(origin + d * DAY_MS);
                const isMonthStart = date.getUTCDate() === 1 || d === 0;
                return (
                  <div key={d} className="flex shrink-0 flex-col items-center justify-end border-l border-ink-600/30 pb-1 text-[10px] text-slate-500" style={{ width: DAY_W }}>
                    {isMonthStart && <span className="font-semibold text-slate-300">{date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</span>}
                    <span>{date.getUTCDate()}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative" style={{ height }}>
            {items.map((item, idx) => (
              <div
                key={item.id}
                className={cn("absolute left-0 right-0 flex border-b border-ink-600/20", selectedId === item.id && "bg-pp-blue/15")}
                style={{ top: idx * ROW_H, height: ROW_H }}
              >
                <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center bg-ink-900/95 px-3" style={{ width: LABEL_W }}>
                  <button onClick={() => { onSelect(item.id); onInspect(item.id); }} className="truncate text-left text-xs font-medium text-slate-100 hover:text-pp-sky" title={item.title}>
                    M{idx + 1}. {item.title}
                  </button>
                  <span className="text-[10px] text-slate-500">{item.kind === "SERVICE" ? "Service escrow" : "Channel3 product"} - {fmtMoney(item.amount)}</span>
                </div>
              </div>
            ))}
            <div className="absolute left-0 right-0 flex border-b border-ink-600/20" style={{ top: items.length * ROW_H, height: ROW_H }}>
              <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center bg-ink-900/95 px-3" style={{ width: LABEL_W }}>
                <span className="text-xs font-medium text-emerald-300">Final Payout</span>
                <span className="text-[10px] text-slate-500">All escrow released - {fmtMoney(total)}</span>
              </div>
            </div>

            <div className="absolute top-0" style={{ left: LABEL_W, width, height }}>
              {Array.from({ length: totalDays }, (_, d) => (
                <div key={d} className="absolute top-0 h-full border-l border-ink-600/15" style={{ left: d * DAY_W }} />
              ))}
              <div className="absolute top-0 z-10 h-full w-0.5 bg-rose-400/80" style={{ left: todayIdx * DAY_W + DAY_W / 2 }} aria-label="Today" />

              <svg className="pointer-events-none absolute inset-0 z-10" width={width} height={height} aria-hidden>
                <defs>
                  <marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" fill="#64748b" />
                  </marker>
                </defs>
                {arrows.map((a) => (
                  <path key={a.key} d={a.d} fill="none" stroke="#64748b" strokeWidth={1.4} markerEnd="url(#arrowhead)" />
                ))}
              </svg>

              {items.map((item, idx) => {
                const w = Math.max(DAY_W, barEndX(item) - barX(item));
                return (
                  <div key={item.id}>
                    <button
                      onClick={() => { onSelect(item.id); onInspect(item.id); }}
                      title={`${item.title}\n${fmtDate(item.startDate)} - ${fmtDate(item.endDate)}\n${STATUS_META[item.status].label}`}
                      className={cn(
                        "absolute z-20 flex items-center gap-2 overflow-hidden rounded-md bg-gradient-to-r px-2 text-left text-[11px] font-semibold text-white shadow-md ring-1 ring-white/10 transition hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-white",
                        BAR_COLOR[item.status] ?? "from-slate-700 to-slate-500",
                        selectedId === item.id && "ring-2 ring-white",
                      )}
                      style={{ left: barX(item), top: idx * ROW_H + 11, width: w, height: ROW_H - 22 }}
                    >
                      <span className="truncate">{fmtMoney(item.amount)}</span>
                      <span className="truncate text-[10px] font-normal opacity-80">{STATUS_META[item.status].label}</span>
                    </button>
                    <div
                      className="absolute z-20 h-3 w-3 rotate-45 bg-emerald-400 ring-2 ring-ink-900"
                      style={{ left: barEndX(item) + 4, top: idx * ROW_H + ROW_H / 2 - 6 }}
                      title={`Payment unlock ${fmtDate(item.endDate)}: ${fmtMoney(item.amount)}`}
                    />
                  </div>
                );
              })}

              <div
                className="absolute z-20 flex items-center gap-1.5 rounded-md bg-emerald-600/90 px-2 text-[11px] font-semibold text-white"
                style={{ left: payoutX - 4, top: items.length * ROW_H + 13, height: ROW_H - 26 }}
              >
                {fmtMoney(total)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
