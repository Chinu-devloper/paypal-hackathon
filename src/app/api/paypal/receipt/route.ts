import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { getReceipt } from "@/server/payments";

export const dynamic = "force-dynamic";

const schema = z.object({ itemId: z.string().min(1).max(100) });

export async function POST(req: Request) {
  return handle(async () => {
    const { itemId } = await readBody(req, schema);
    return json({ receipt: await getReceipt(itemId) });
  });
}
