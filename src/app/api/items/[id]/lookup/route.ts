import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { enrichSingle, lookupProductByUrl } from "@/server/channel3";
import { PaymentError } from "@/server/errors";
import { recommendProduct, requireProcurementItem } from "@/server/procurement";
import { addAuditLog, updateItem } from "@/server/repo";

export const dynamic = "force-dynamic";

const schema = z.object({ url: z.string().trim().url("Enter a full product link").max(1000) });

/** Channel3 /v1/lookup: paste any retailer product link; it is priced, scored and added to the candidates. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { url } = await readBody(req, schema);
    const item = requireProcurementItem(id);
    if (!["DRAFT", "READY_TO_ORDER"].includes(item.status)) {
      throw new PaymentError("INVALID_STATE", `Cannot add products while ${item.status}`, 409);
    }
    const found = await lookupProductByUrl(url, item.projectId);
    const product = await enrichSingle(found, item.maxBudget);
    const candidates = [product, ...item.candidates.filter((p) => p.id !== product.id)].slice(0, 6);
    const recommendation = await recommendProduct(item, candidates, true);
    const updated = updateItem(id, (it) => {
      it.candidates = candidates;
      it.recommendation = recommendation;
    });
    const over = item.maxBudget !== null && product.price > item.maxBudget;
    addAuditLog(
      updated.projectId,
      id,
      over ? "WARN" : "INFO",
      "PRODUCT_LINK_ADDED",
      `Channel3 resolved a pasted link to "${product.title.slice(0, 60)}" at $${product.price.toFixed(2)}${over ? ` (over the $${item.maxBudget?.toFixed(2)} cap, cannot be approved)` : ""}.`,
    );
    return json({ item: updated, product, overBudget: over });
  });
}
