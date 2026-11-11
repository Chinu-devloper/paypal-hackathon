"use client";

import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/stockholm-dark.css";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import { Gantt, StringHelper, type TaskModel } from "@bryntum/gantt";
import { useEffect, useMemo, useRef } from "react";
import { toGanttData } from "@/client/ganttData";
import { STATUS_META, fmtMoney } from "@/client/helpers";
import type { ItemStatus, LedgerItem } from "@/shared/types";

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

interface Props {
  items: LedgerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
  onError: (error: unknown) => void;
}

/** Real Bryntum Gantt (trial build) showing milestones, dependencies and PayPal payment-unlock dates. */
export default function BryntumTimeline({ items, selectedId, onSelect, onInspect, onError }: Readonly<Props>) {
  const host = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<Gantt | null>(null);
  const handlers = useRef({ onSelect, onInspect, onError });
  handlers.current = { onSelect, onInspect, onError };

  const data = useMemo(() => toGanttData(items), [items]);
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);

  useEffect(() => {
    if (!host.current) return;
    let gantt: Gantt | null = null;
    let onClick: ((e: MouseEvent) => void) | null = null;
    try {
      gantt = new Gantt({
        appendTo: host.current,
        height: 560,
        readOnly: true,
        rowHeight: 46,
        barMargin: 8,
        startDate: new Date(`${data.startDate}T00:00:00`),
        endDate: new Date(`${data.endDate}T00:00:00`),
        viewPreset: "weekAndDayLetter",
        project: { tasks: data.tasksData, dependencies: data.dependenciesData },
        columns: [
          {
            type: "name",
            text: "Milestone",
            width: 280,
            renderer: ({ record }: { record: { get: (f: string) => unknown } }) => asText(record.get("name")),
          },
          {
            text: "Amount",
            field: "cost",
            width: 110,
            align: "right",
            renderer: ({ record }: { record: { get: (f: string) => unknown } }) => fmtMoney(Number(record.get("cost") ?? 0)),
          },
          {
            text: "Escrow status",
            field: "status",
            width: 170,
            renderer: ({ record }: { record: { get: (f: string) => unknown } }) => {
              const status = asText(record.get("status"));
              return status === "UNLOCK" ? "Cash-flow event" : STATUS_META[status as ItemStatus]?.label ?? status;
            },
          },
        ],
        features: {
          taskEdit: false,
          taskMenu: false,
          cellMenu: false,
          headerMenu: false,
          taskDrag: false,
          taskResize: false,
          percentBar: true,
          timeRanges: { showCurrentTimeLine: true },
          taskTooltip: {
            template: ({ taskRecord }: { taskRecord: { id: string | number } }) => {
              const task = data.tasksData.find((t) => t.id === String(taskRecord.id));
              if (!task) return "";
              const label = task.status === "UNLOCK" ? "PayPal cash-flow event" : STATUS_META[task.status]?.label ?? task.status;
              return `<div><b>${StringHelper.encodeHtml(task.name)}</b><br>${StringHelper.encodeHtml(label)}<br>${StringHelper.encodeHtml(fmtMoney(task.cost))}</div>`;
            },
          },
        },
      });
      ganttRef.current = gantt;
      const hostEl = host.current;
      const g = gantt;
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
      ganttRef.current = null;
      gantt?.destroy();
    };
  }, [data, itemIds]);

  useEffect(() => {
    const gantt = ganttRef.current;
    if (!gantt || !selectedId) return;
    const record = gantt.taskStore.getById(selectedId) as TaskModel | null;
    if (record) {
      gantt.selectedRecord = record;
      void gantt.scrollTaskIntoView(record, { animate: true, highlight: true });
    }
  }, [selectedId, data]);

  return <div ref={host} className="mos-bryntum overflow-hidden rounded-xl border border-ink-600/60" />;
}
