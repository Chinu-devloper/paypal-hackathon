import { z } from "zod";
import { errorResponse, readBody } from "@/server/http";
import { auditAndRelease } from "@/server/audit-flow";
import { PaymentError } from "@/server/errors";
import { seedIfEmpty } from "@/server/seed";

export const dynamic = "force-dynamic";

const schema = z.object({
  itemId: z.string().min(1).max(100),
  submission: z.string().max(200_000),
});

const LINE_DELAY_MS = 160;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Streams the live agentic terminal as newline-delimited JSON events. */
export async function POST(req: Request) {
  let body: z.infer<typeof schema>;
  try {
    seedIfEmpty();
    body = await readBody(req, schema);
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const result = await auditAndRelease(body.itemId, body.submission, async (line) => {
          send({ type: "log", line });
          await sleep(LINE_DELAY_MS);
        });
        send({ type: "result", ...result });
      } catch (err) {
        if (err instanceof PaymentError) {
          send({ type: "error", error: { code: err.code, message: err.message } });
        } else {
          console.error("[audit] unexpected error", err);
          send({ type: "error", error: { code: "INTERNAL", message: "Unexpected server error during audit" } });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
