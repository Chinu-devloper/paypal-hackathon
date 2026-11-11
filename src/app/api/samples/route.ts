import { z } from "zod";
import { handle, json, readBody, requireDemoTools } from "@/server/http";
import { generateSampleDeliverable } from "@/server/ai/sample-gen";
import { getEnvStatus } from "@/server/env";
import { PaymentError } from "@/server/errors";
import { getItem } from "@/server/repo";
import { buildSampleSubmissions } from "@/shared/samples";

export const dynamic = "force-dynamic";

const schema = z.object({ itemId: z.string().min(1).max(100), kind: z.enum(["passing", "partial"]) });

/** Returns a test deliverable; custom projects get an LLM-written one so a real auditor can pass it. */
export async function POST(req: Request) {
  return handle(async () => {
    requireDemoTools();
    const { itemId, kind } = await readBody(req, schema);
    const item = getItem(itemId);
    if (!item) throw new PaymentError("NOT_FOUND", "Item not found", 404);
    const samples = buildSampleSubmissions(item.acceptanceCriteria);
    if (samples.needsGeneration && getEnvStatus().openai) {
      const generated = await generateSampleDeliverable(item.title, item.acceptanceCriteria, kind);
      if (generated) return json({ submission: generated, source: "ai-generated" });
    }
    return json({ submission: samples[kind], source: "built-in" });
  });
}
