import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { PaymentError } from "@/server/errors";
import { releaseFunds } from "@/server/payments";
import { getItem } from "@/server/repo";

export const dynamic = "force-dynamic";

const schema = z.object({ itemId: z.string().min(1).max(100) });

/**
 * Releases escrow for an item. Services require a stored passing AI audit; procurement requires a
 * funded order. Also used to safely retry a payout after a failure (all steps are idempotent).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { itemId } = await readBody(req, schema);
    const item = getItem(itemId);
    if (!item) throw new PaymentError("NOT_FOUND", "Item not found", 404);
    const logs: string[] = [];
    const result = await releaseFunds(itemId, item.kind === "PROCUREMENT" ? "PROCUREMENT" : "AUDIT", (l) => void logs.push(l));
    return json({ ...result, logs });
  });
}
