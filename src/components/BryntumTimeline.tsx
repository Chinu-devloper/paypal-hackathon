"use client";

import "@bryntum/gantt/gantt.css";
import "@/styles/bryntum-theme.css";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import { Gantt, StringHelper, Timeline, type TaskModel } from "@bryntum/gantt";
import { CalendarPlus, Crosshair, Flag, Layers, Maximize2, Redo2, Route, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui";
import { toGanttData } from "@/client/ganttData";
import { STATUS_META, fmtMoney } from "@/client/helpers";
import { buildIcs } from "@/client/ics";
import type { ItemStatus, LedgerItem } from "@/shared/types";

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

const LEGEND: Array<{ label: string; color: string }> = [
  { label: "Paid / captured", color: "#059669" },
  { label: "Authorized (held)", color: "#0070ba" },
  { label: "AI auditing", color: "#7c3aed" },
  { label: "Revision needed", color: "#d97706" },
  { label: "Security flagged", color: "#dc2626" },
  { label: "Not funded", color: "#475569" },
];

interface Props {
  items: LedgerItem[];
  projectTitle?: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
  onFund: (item: LedgerItem) => void;
  onAudit: (item: LedgerItem) => void;
  onReceipt: (item: LedgerItem) => void;
  onReschedule: (itemId: string, startDate: string, endDate: string) => Promise<boolean>;
  onError: (error: unknown) => void;
}

interface Move {
  itemId: string;
  title: string;
  from: { start: string; end: string };
  to: { start: string; end: string };
}

const AUDITABLE: ItemStatus[] = ["AUTHORIZED", "AI_AUDITING", "REVISION_NEEDED", "SECURITY_FLAGGED"];
const SETTLED: ItemStatus[] = ["PAID_OUT", "CAPTURED", "REFUNDED"];

const pad = (n: number) => String(n).padStart(2, "0");
/** Bryntum dates are local midnights; format them without a UTC shift. */
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};

/** Real Bryntum Gantt (trial build) showing milestones, dependencies, payment-unlock dates and AI-plan baselines. */
export default function BryntumTimeline({
  items,
  projectTitle,
  selectedId,
  onSelect,
  onInspect,
  onFund,
  onAudit,
  onReceipt,
  onReschedule,
  onError,
}: Readonly<Props>) {
  const host = useRef<HTMLDivElement>(null);
  const overviewHost = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<Gantt | null>(null);
  const handlers = useRef({ onSelect, onInspect, onFund, onAudit, onReceipt, onReschedule, onError });
  handlers.current = { onSelect, onInspect, onFund, onAudit, onReceipt, onReschedule, onError };
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const viewStart = useRef<Date | null>(null);
  const [critical, setCritical] = useState(false);
  const [progress, setProgress] = useState(true);
  const [baselines, setBaselines] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [undoStack, setUndoStack] = useState<Move[]>([]);
  const [redoStack, setRedoStack] = useState<Move[]>([]);
  const flags = useRef({ critical, progress, baselines });
  flags.current = { critical, progress, baselines };

  const data = useMemo(() => toGanttData(items), [items]);
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);

  /** Persists a drag/resize. A rejected move (server rules) is rolled back by rebuilding the Gantt from server state. */
  const persistMove = useCallback(async (record: TaskModel) => {
    const itemId = String(record.id);
    const item = itemsRef.current.find((i) => i.id === itemId);
    const start = record.startDate;
    const end = record.endDate;
    if (!item || !(start instanceof Date) || !(end instanceof Date)) return;
    const to = { start: isoDay(start), end: isoDay(addDays(end, -1)) };
    const from = { start: item.startDate, end: item.endDate };
    if (to.start === from.start && to.end === from.end) return;
    setBusy(true);
    try {
      const ok = await handlers.current.onReschedule(itemId, to.start, to.end);
      if (ok) {
        setUndoStack((s) => [...s.slice(-19), { itemId, title: item.title, from, to }]);
        setRedoStack([]);
      } else {
        setResetKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const replay = useCallback(async (kind: "undo" | "redo") => {
    const source = kind === "undo" ? undoStack : redoStack;
    const move = source[source.length - 1];
    if (!move) return;
    setBusy(true);
    try {
      const target = kind === "undo" ? move.from : move.to;
      const ok = await handlers.current.onReschedule(move.itemId, target.start, target.end);
      if (!ok) return;
      if (kind === "undo") {
        setUndoStack((s) => s.slice(0, -1));
        setRedoStack((s) => [...s, move]);
      } else {
        setRedoStack((s) => s.slice(0, -1));
        setUndoStack((s) => [...s, move]);
      }
    } finally {
      setBusy(false);
    }
  }, [undoStack, redoStack]);

  useEffect(() => {
    if (!host.current) return;
    let gantt: Gantt | null = null;
    let overview: Timeline | null = null;
    let disposed = false;
    let onClick: ((e: MouseEvent) => void) | null = null;
    try {
      gantt = new Gantt({
        appendTo: host.current,
        height: 560,
        rowHeight: 46,
        barMargin: 8,
        startDate: new Date(`${data.startDate}T00:00:00`),
        endDate: new Date(`${data.endDate}T00:00:00`),
        viewPreset: "weekAndDayLetter",
        project: { tasks: data.tasksData, dependencies: data.dependenciesData },
        listeners: {
          // Task changes are persisted through the escrow API; Bryntum only provides the interaction.
          taskDrop: ({ taskRecords }: { taskRecords: TaskModel[] }) => {
            for (const record of taskRecords) void persistMove(record);
          },
          taskResizeEnd: ({ changed, taskRecord }: { changed: boolean; taskRecord: TaskModel }) => {
            if (changed) void persistMove(taskRecord);
          },
        },
        columns: [
          {
            type: "name",
            text: "Milestone",
            width: 280,
            editor: false,
            renderer: ({ record }: { record: { get: (f: string) => unknown } }) => asText(record.get("name")),
          },
          {
            text: "Amount",
            field: "cost",
            width: 110,
            align: "right",
            editor: false,
            renderer: ({ record }: { record: { get: (f: string) => unknown } }) => fmtMoney(Number(record.get("cost") ?? 0)),
          },
          {
            text: "Escrow status",
            field: "status",
            width: 170,
            editor: false,
            renderer: ({ record }: { record: { get: (f: string) => unknown } }) => {
              const status = asText(record.get("status"));
              return status === "UNLOCK" ? "Cash-flow event" : STATUS_META[status as ItemStatus]?.label ?? status;
            },
          },
        ],
        features: {
          taskEdit: false,
          cellEdit: false,
          rowReorder: false,
          // Right-click a bar to drive the escrow lifecycle straight from the schedule.
          taskMenu: {
            processItems: ({ taskRecord, items: menu }: { taskRecord: { id: string | number }; items: Record<string, unknown> }) => {
              for (const key of Object.keys(menu)) delete menu[key];
              const id = String(taskRecord.id).replace(/__unlock$/, "");
              const item = itemsRef.current.find((i) => i.id === id);
              if (!item) return false;
              const h = handlers.current;
              menu.inspect = { text: "Inspect milestone", icon: "fa fa-magnifying-glass", onItem: () => h.onInspect(id) };
              const fundable = item.kind === "SERVICE" ? ["DRAFT", "PENDING_FUNDING"].includes(item.status) : item.status === "READY_TO_ORDER";
              if (fundable) menu.fund = { text: "Fund escrow (PayPal)", icon: "fa fa-lock", onItem: () => h.onFund(item) };
              if (item.kind === "SERVICE" && AUDITABLE.includes(item.status) && item.paypal.authorizationId) {
                menu.audit = { text: "Run AI audit & release", icon: "fa fa-robot", onItem: () => h.onAudit(item) };
              }
              if (SETTLED.includes(item.status)) menu.receipt = { text: "View receipt", icon: "fa fa-receipt", onItem: () => h.onReceipt(item) };
              return true;
            },
          },
          indicators: true,
          cellMenu: false,
          headerMenu: false,
          taskDrag: true,
          taskResize: true,
          dependencies: { allowCreate: false },
          dependencyEdit: false,
          baselines: { disabled: !flags.current.baselines },
          percentBar: { allowResize: false },
          criticalPaths: { disabled: !flags.current.critical },
          progressLine: { disabled: !flags.current.progress },
          labels: {
            after: {
              field: "cost",
              renderer: ({ taskRecord }: { taskRecord: { get: (f: string) => unknown } }) =>
                asText(taskRecord.get("status")) === "UNLOCK" ? "" : StringHelper.encodeHtml(fmtMoney(Number(taskRecord.get("cost") ?? 0))),
            },
          },
          timeRanges: { showCurrentTimeLine: true },
          taskTooltip: {
            template: ({ taskRecord }: { taskRecord: { id: string | number } }) => {
              const task = data.tasksData.find((t) => t.id === String(taskRecord.id));
              if (!task) return "";
              const label = task.status === "UNLOCK" ? "PayPal cash-flow event" : STATUS_META[task.status]?.label ?? task.status;
              const item = itemsRef.current.find((i) => i.id === task.id);
              const extra = [
                item?.auditScore != null ? `AI audit score: ${item.auditScore}/100` : "",
                item?.paypal.authorizationId ? `Authorization: ${item.paypal.authorizationId}` : "",
                task.deadlineDate ? `Authorization expires: ${task.deadlineDate}` : "",
                item && item.plannedStartDate && (item.plannedStartDate !== item.startDate || item.plannedEndDate !== item.endDate)
                  ? `AI plan: ${item.plannedStartDate} to ${item.plannedEndDate}`
                  : "",
                task.readOnly && task.status !== "UNLOCK" ? "Dates locked (funds held)" : "",
              ].filter(Boolean);
              return `<div><b>${StringHelper.encodeHtml(task.name)}</b><br>${StringHelper.encodeHtml(label)}<br>${StringHelper.encodeHtml(fmtMoney(task.cost))}${extra.map((l) => `<br>${StringHelper.encodeHtml(l)}`).join("")}</div>`;
            },
          },
        },
      });
      ganttRef.current = gantt;
      const g = gantt;
      // The Timeline widget shares the Gantt's project, so both views always show the same schedule.
      void gantt.project.commitAsync().then(() => {
        if (disposed) return;
        // Keep the user's scroll position after a save rebuilds the chart.
        if (viewStart.current) void g.scrollToDate(viewStart.current, { block: "start", animate: false });
        if (!overviewHost.current) return;
        try {
          // Bryntum's typings declare a SchedulerPro project here, but the Gantt project is the documented one to share.
          overview = new Timeline({ appendTo: overviewHost.current, project: g.project as never, readOnly: true });
        } catch (err) {
          console.warn("Bryntum Timeline overview unavailable", err);
        }
      });
      const hostEl = host.current;
      onClick = (e: MouseEvent) => {
        const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(".b-gantt-task");
        const record = el ? g.resolveTaskRecord(el) : null;
        if (!record) return;
        const base = String(record.id).replace(/__unlock$/, "");
        if (itemIds.has(base)) {
          handlers.current.onSelect(base);
          handlers.current.onInspect(base);
        }
      };
      hostEl.addEventListener("click", onClick, true);
    } catch (err) {
      handlers.current.onError(err);
    }
    return () => {
      if (onClick) host.current?.removeEventListener("click", onClick, true);
      try {
        viewStart.current = gantt?.visibleDateRange?.startDate ?? viewStart.current;
      } catch {
        // View not rendered yet; nothing to remember.
      }
      ganttRef.current = null;
      disposed = true;
      overview?.destroy();
      gantt?.destroy();
    };
  }, [data, itemIds, persistMove, resetKey]);

  useEffect(() => {
    const gantt = ganttRef.current;
    if (!gantt || !selectedId) return;
    const record = gantt.taskStore.getById(selectedId) as TaskModel | null;
    if (record) {
      gantt.selectedRecord = record;
      void gantt.scrollTaskIntoView(record, { animate: true, highlight: true });
    }
  }, [selectedId, data, resetKey]);

  useEffect(() => {
    const g = ganttRef.current;
    if (g) g.features.criticalPaths.disabled = !critical;
  }, [critical, data, resetKey]);

  useEffect(() => {
    const g = ganttRef.current;
    if (g) g.features.progressLine.disabled = !progress;
  }, [progress, data, resetKey]);

  useEffect(() => {
    const g = ganttRef.current;
    if (g) g.features.baselines.disabled = !baselines;
  }, [baselines, data, resetKey]);

  const exportIcs = () => {
    const blob = new Blob([buildIcs(projectTitle ?? "MilestoneOS project", itemsRef.current)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(projectTitle ?? "milestoneos").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "milestoneos"}-schedule.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const gantt = () => ganttRef.current;
  const lastUndo = undoStack[undoStack.length - 1];
  const lastRedo = redoStack[redoStack.length - 1];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void gantt()?.zoomOut()} aria-label="Zoom out"><ZoomOut className="h-3.5 w-3.5" /> Zoom out</Button>
        <Button variant="outline" size="sm" onClick={() => void gantt()?.zoomIn()} aria-label="Zoom in"><ZoomIn className="h-3.5 w-3.5" /> Zoom in</Button>
        <Button variant="outline" size="sm" onClick={() => void gantt()?.zoomToFit({ animate: true })}><Maximize2 className="h-3.5 w-3.5" /> Fit project</Button>
        <Button variant="outline" size="sm" onClick={() => void gantt()?.scrollToDate(new Date(), { block: "center", animate: true })}><Crosshair className="h-3.5 w-3.5" /> Today</Button>
        <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" aria-hidden />
        <Button variant={critical ? "primary" : "outline"} size="sm" aria-pressed={critical} onClick={() => setCritical((v) => !v)}><Route className="h-3.5 w-3.5" /> Critical path</Button>
        <Button variant={progress ? "primary" : "outline"} size="sm" aria-pressed={progress} onClick={() => setProgress((v) => !v)}><Flag className="h-3.5 w-3.5" /> Progress line</Button>
        <Button variant={baselines ? "primary" : "outline"} size="sm" aria-pressed={baselines} onClick={() => setBaselines((v) => !v)}><Layers className="h-3.5 w-3.5" /> AI plan baseline</Button>
        <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" aria-hidden />
        <Button variant="outline" size="sm" disabled={!lastUndo || busy} title={lastUndo ? `Undo: ${lastUndo.title}` : "Nothing to undo"} onClick={() => void replay("undo")}><Undo2 className="h-3.5 w-3.5" /> Undo</Button>
        <Button variant="outline" size="sm" disabled={!lastRedo || busy} title={lastRedo ? `Redo: ${lastRedo.title}` : "Nothing to redo"} onClick={() => void replay("redo")}><Redo2 className="h-3.5 w-3.5" /> Redo</Button>
        <Button variant="outline" size="sm" onClick={exportIcs}><CalendarPlus className="h-3.5 w-3.5" /> Export .ics</Button>
        <ul className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400" aria-label="Status legend">
          {LEGEND.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} aria-hidden /> {l.label}
            </li>
          ))}
        </ul>
      </div>
      <div ref={overviewHost} className="mos-bryntum-overview overflow-hidden rounded-2xl border border-white/10 [box-shadow:var(--card-shadow)] empty:hidden" />
      <div ref={host} className="mos-bryntum overflow-hidden rounded-2xl border border-white/10 [box-shadow:var(--card-shadow)]" />
    </div>
  );
}
