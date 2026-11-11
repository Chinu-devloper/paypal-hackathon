import { handle, json } from "@/server/http";
import { PaymentError } from "@/server/errors";
import { searchProducts } from "@/server/channel3";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const params = new URL(req.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    if (q.length < 2 || q.length > 200) throw new PaymentError("VALIDATION", "q must be 2-200 characters", 422);
    const rawMax = params.get("maxPrice");
    let maxPrice: number | null = null;
    if (rawMax !== null && rawMax !== "") {
      maxPrice = Number(rawMax);
      if (!Number.isFinite(maxPrice) || maxPrice <= 0) throw new PaymentError("VALIDATION", "maxPrice must be a positive number", 422);
    }
    return json(await searchProducts(q, maxPrice, 3));
  });
}
