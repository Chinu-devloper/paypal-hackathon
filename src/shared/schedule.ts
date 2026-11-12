import type { ItemStatus, LedgerItem } from "./types";

/** Only unfunded rows can be re-planned. Once money is held in escrow the dates are part of the agreement. */
export const RESCHEDULABLE: readonly ItemStatus[] = ["DRAFT", "PENDING_FUNDING", "READY_TO_ORDER"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 365;

function dayNumber(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 86_400_000);
}

/**
 * Validates a drag/resize from the Bryntum Gantt. Returns an error message, or null when the move is allowed.
 * Dependencies are finish-to-start: a milestone may not start before everything it depends on has finished,
 * and may not finish after anything that depends on it has started.
 */
export function validateReschedule(item: LedgerItem, all: LedgerItem[], startDate: string, endDate: string): string | null {
  if (!RESCHEDULABLE.includes(item.status)) return `Cannot reschedule while ${item.status.replace(/_/g, " ").toLowerCase()}: the dates are locked once funds are held.`;
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || Number.isNaN(Date.parse(startDate)) || Number.isNaN(Date.parse(endDate))) {
    return "Dates must be valid YYYY-MM-DD values.";
  }
  if (endDate < startDate) return "A milestone cannot end before it starts.";
  if (dayNumber(endDate) - dayNumber(startDate) > MAX_SPAN_DAYS) return `A milestone cannot span more than ${MAX_SPAN_DAYS} days.`;

  for (const depId of item.dependencies) {
    const dep = all.find((i) => i.id === depId);
    if (dep && startDate < dep.endDate) return `Cannot start before "${dep.title}" finishes on ${dep.endDate}.`;
  }
  for (const next of all) {
    if (next.dependencies.includes(item.id) && endDate > next.startDate) return `Cannot finish after "${next.title}" starts on ${next.startDate}.`;
  }
  return null;
}
