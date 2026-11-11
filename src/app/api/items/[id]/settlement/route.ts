import { z } from "zod";
import { handle, json, readBody } from "@/server/http";
import { recordSettlementDecision } from "@/server/payments";

export const dynamic = "force-dynamic";

const schema = z.object({ party: z.enum(["client", "freelancer"]), accept: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { party, accept } = await readBody(req, schema);
    const logs: string[] = [];
    const { item, released } = await recordSettlementDecision(id, party, accept, (l) => void logs.push(l));
    return json({ item, released, logs });
  });
}
