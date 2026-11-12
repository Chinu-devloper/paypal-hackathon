import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { searchProducts } from "@/server/channel3";
import { PaymentError } from "@/server/errors";
import { recommendProduct, requireProcurementItem } from "@/server/procurement";
import { updateItem } from "@/server/repo";

export const dynamic = "force-dynamic";

const schema = z.object({ query: z.string().trim().min(2).max(120).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { query } = await readBody(req, schema);
    const item = requireProcurementItem(id);
    if (!["DRAFT", "READY_TO_ORDER"].includes(item.status)) {
      throw new PaymentError("INVALID_STATE", `Cannot re-source while ${item.status}`, 409);
    }
    const q = query ?? item.searchQuery;
    if (!q) throw new PaymentError("VALIDATION", "No search query available", 422);
    const result = await searchProducts(q, item.maxBudget, 3, item.projectId);
    const recommendation = await recommendProduct(item, result.products, true);
    const updated = updateItem(id, (it) => {
      it.searchQuery = q;
      it.candidates = result.products;
      it.recommendation = recommendation;
    });
    return json({ item: updated, source: result.source, note: result.note ?? null });
  });
}
