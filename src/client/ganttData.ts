import type { ItemStatus, LedgerItem } from "@/shared/types";

export const PAYOUT_TASK_ID = "__final_payout";
export const unlockTaskId = (itemId: string) => `${itemId}__unlock`;

export interface GanttTaskData {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  duration?: number;
  percentDone: number;
  manuallyScheduled: true;
  cls: string;
  cost: number;
  status: ItemStatus | "UNLOCK";
  kind: "SERVICE" | "PROCUREMENT" | "UNLOCK" | "PAYOUT";
  /** PayPal authorization expiry, shown as a Bryntum deadline indicator. */
  deadlineDate?: string;
  showInTimeline?: boolean;
}

export interface GanttDependencyData {
  id: string;
  from: string;
  to: string;
  type: 2;
}

export interface GanttData {
  tasksData: GanttTaskData[];
  dependenciesData: GanttDependencyData[];
  startDate: string;
  endDate: string;
}

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const AUTH_HELD: ItemStatus[] = ["AUTHORIZED", "AI_AUDITING", "REVISION_NEEDED", "SECURITY_FLAGGED"];

/**
 * Bryntum Gantt project data. Every milestone gets a zero-duration "payment unlock" milestone at its end
 * date, and all unlocks feed a final payout milestone, so PayPal cash-flow dates are first-class tasks.
 */
export function toGanttData(items: LedgerItem[]): GanttData {
  const tasksData: GanttTaskData[] = [];
  const dependenciesData: GanttDependencyData[] = [];
  const hasDependents = new Set(items.flatMap((i) => i.dependencies));
  let lastDeadline = "";

  for (const item of items) {
    const done = item.status === "PAID_OUT" || item.status === "CAPTURED";
    const deadlineDate = AUTH_HELD.includes(item.status) && item.authorizationExpiresAt ? item.authorizationExpiresAt.slice(0, 10) : undefined;
    if (deadlineDate && deadlineDate > lastDeadline) lastDeadline = deadlineDate;
    tasksData.push({
      id: item.id,
      name: item.title,
      startDate: item.startDate,
      endDate: addDays(item.endDate, 1),
      percentDone: done ? 100 : item.auditScore ?? 0,
      manuallyScheduled: true,
      cls: `mos-${item.status}`,
      cost: item.amount,
      status: item.status,
      kind: item.kind,
      deadlineDate,
      showInTimeline: true,
    });
    const unlockId = unlockTaskId(item.id);
    tasksData.push({
      id: unlockId,
      name: `Unlock ${item.amount.toFixed(2)} USD`,
      startDate: addDays(item.endDate, 1),
      duration: 0,
      percentDone: done ? 100 : 0,
      manuallyScheduled: true,
      cls: `mos-unlock${done ? " mos-unlocked" : ""}`,
      cost: item.amount,
      status: "UNLOCK",
      kind: "UNLOCK",
    });
    dependenciesData.push({ id: `${item.id}->${unlockId}`, from: item.id, to: unlockId, type: 2 });
    for (const dep of item.dependencies) dependenciesData.push({ id: `${dep}->${item.id}`, from: dep, to: item.id, type: 2 });
  }

  const lastEnd = items.reduce((max, i) => (i.endDate > max ? i.endDate : max), items[0]?.endDate ?? new Date().toISOString().slice(0, 10));
  const firstStart = items.reduce((min, i) => (i.startDate < min ? i.startDate : min), items[0]?.startDate ?? lastEnd);
  const payoutDay = addDays(lastEnd, 2);
  const total = items.reduce((s, i) => s + i.amount, 0);
  tasksData.push({
    id: PAYOUT_TASK_ID,
    name: `Final Payout ${total.toFixed(2)} USD`,
    startDate: payoutDay,
    duration: 0,
    percentDone: 0,
    manuallyScheduled: true,
    cls: "mos-payout",
    cost: total,
    status: "UNLOCK",
    kind: "PAYOUT",
    showInTimeline: true,
  });
  for (const item of items) {
    if (!hasDependents.has(item.id)) {
      dependenciesData.push({ id: `${item.id}->payout`, from: unlockTaskId(item.id), to: PAYOUT_TASK_ID, type: 2 });
    }
  }

  const scheduleEnd = addDays(payoutDay, 3);
  const endDate = lastDeadline && addDays(lastDeadline, 2) > scheduleEnd ? addDays(lastDeadline, 2) : scheduleEnd;
  return { tasksData, dependenciesData, startDate: addDays(firstStart, -2), endDate };
}
