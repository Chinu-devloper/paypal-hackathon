import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { voidOrRefund } from "@/server/payments";

export const dynamic = "force-dynamic";

const schema = z.object({
  itemId: z.string().min(1).max(100),
  action: z.enum(["VOID", "REFUND"]),
  amount: z.number().positive().optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const { itemId, action, amount } = await readBody(req, schema);
    return json({ item: await voidOrRefund(itemId, action, amount) });
  });
}
