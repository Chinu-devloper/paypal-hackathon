import { z } from "zod";
import { handle, json, readBody, requireDemoTools } from "@/server/http";
import { simulateAuthorization } from "@/server/payments";

export const dynamic = "force-dynamic";

const schema = z.object({ itemId: z.string().min(1).max(100) });

export async function POST(req: Request) {
  return handle(async () => {
    requireDemoTools();
    const { itemId } = await readBody(req, schema);
    return json({ item: await simulateAuthorization(itemId) });
  });
}
