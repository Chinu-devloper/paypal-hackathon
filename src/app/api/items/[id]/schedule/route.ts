import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { PaymentError } from "@/server/errors";
import { addAuditLog, getItem, listItems, updateItem } from "@/server/repo";
import { validateReschedule } from "@/shared/schedule";

export const dynamic = "force-dynamic";

const schema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Persists a Bryntum Gantt drag/resize. The server re-validates dependencies and funding state. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { startDate, endDate } = await readBody(req, schema);
    const item = getItem(id);
    if (!item) throw new PaymentError("NOT_FOUND", "Item not found", 404);
    const error = validateReschedule(item, listItems(item.projectId), startDate, endDate);
    if (error) throw new PaymentError("INVALID_STATE", error, 409);
    const previous = `${item.startDate} to ${item.endDate}`;
    const updated = updateItem(id, (it) => {
      // The first manual change freezes the original plan as the baseline.
      it.plannedStartDate ??= it.startDate;
      it.plannedEndDate ??= it.endDate;
      it.startDate = startDate;
      it.endDate = endDate;
    });
    addAuditLog(
      updated.projectId,
      id,
      "INFO",
      "SCHEDULE_CHANGED",
      `Rescheduled "${updated.title}" from ${previous} to ${startDate} to ${endDate} (AI baseline: ${updated.plannedStartDate ?? updated.startDate} to ${updated.plannedEndDate ?? updated.endDate}).`,
    );
    return json({ item: updated });
  });
}
