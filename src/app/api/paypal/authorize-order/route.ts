import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { authorizeFundingOrder } from "@/server/payments";

export const dynamic = "force-dynamic";

const schema = z.object({ itemId: z.string().min(1).max(100), orderId: z.string().min(5).max(64) });

export async function POST(req: Request) {
  return handle(async () => {
    const { itemId, orderId } = await readBody(req, schema);
    return json({ item: await authorizeFundingOrder(itemId, orderId) });
  });
}
