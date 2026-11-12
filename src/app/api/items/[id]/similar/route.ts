import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { findSimilarProducts } from "@/server/channel3";
import { PaymentError } from "@/server/errors";
import { recommendProduct, requireProcurementItem } from "@/server/procurement";
import { addAuditLog, updateItem } from "@/server/repo";

export const dynamic = "force-dynamic";

const schema = z.object({ productId: z.string().trim().min(1).max(200) });

/** Channel3 /v1/similar: swap the candidate list for in-budget alternatives to one product. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { productId } = await readBody(req, schema);
    const item = requireProcurementItem(id);
    if (!["DRAFT", "READY_TO_ORDER"].includes(item.status)) {
      throw new PaymentError("INVALID_STATE", `Cannot re-source while ${item.status}`, 409);
    }
    const seed = item.candidates.find((p) => p.id === productId) ?? (item.product?.id === productId ? item.product : null);
    if (!seed) throw new PaymentError("NOT_FOUND", "Product is not among this item's candidates", 404);

    const result = await findSimilarProducts(seed, item.maxBudget, 4, item.projectId);
    if (result.products.length === 0) {
      return json({ item, source: result.source, note: result.note ?? "No similar in-budget products found." });
    }
    const recommendation = await recommendProduct(item, result.products, true);
    const updated = updateItem(id, (it) => {
      it.candidates = result.products;
      it.recommendation = recommendation;
    });
    addAuditLog(updated.projectId, id, "INFO", "SIMILAR_PRODUCTS", `Channel3 found ${result.products.length} in-budget alternative(s) similar to "${seed.title.slice(0, 60)}".`);
    return json({ item: updated, source: result.source, note: result.note ?? null });
  });
}
