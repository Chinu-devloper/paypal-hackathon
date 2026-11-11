import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { PaymentError } from "@/server/errors";
import { addAuditLog, getItem, updateItem } from "@/server/repo";
import { round2 } from "@/server/utils";

export const dynamic = "force-dynamic";

const schema = z.object({ amount: z.number().positive().max(1_000_000) });

/** Inline edit of a not-yet-funded milestone amount (AG Grid cell edit). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { amount } = await readBody(req, schema);
    const item = getItem(id);
    if (!item) throw new PaymentError("NOT_FOUND", "Item not found", 404);
    if (item.kind !== "SERVICE" || !["DRAFT", "PENDING_FUNDING"].includes(item.status) || item.isProcessingPayment) {
      throw new PaymentError("INVALID_STATE", "Only unfunded service milestones can be edited", 409);
    }
    const next = round2(amount);
    const updated = updateItem(id, (it) => {
      it.amount = next;
    });
    addAuditLog(item.projectId, id, "INFO", "AMOUNT_EDITED", `Draft amount changed from $${item.amount.toFixed(2)} to $${next.toFixed(2)}.`);
    return json({ item: updated });
  });
}
