import { z } from "zod";
import { errorResponse, readBody } from "@/server/http";
import { auditAndRelease, type SubmissionInput } from "@/server/audit-flow";
import { PaymentError } from "@/server/errors";
import { seedIfEmpty } from "@/server/seed";
import { SOURCE_LIMITS } from "@/shared/source";

export const dynamic = "force-dynamic";

const schema = z.object({
  itemId: z.string().min(1).max(100),
  submission: z.string().max(200_000).optional(),
  repoUrl: z.string().min(1).max(300).optional(),
  files: z
    .array(z.object({ path: z.string().min(1).max(300), content: z.string().max(SOURCE_LIMITS.maxFileBytes) }))
    .max(SOURCE_LIMITS.maxFiles * 2)
    .optional(),
  label: z.string().max(80).optional(),
});

function toInput(body: z.infer<typeof schema>): SubmissionInput {
  if (body.repoUrl) return { kind: "git", url: body.repoUrl };
  if (body.files && body.files.length > 0) return { kind: "files", files: body.files, label: body.label };
  return { kind: "text", text: body.submission ?? "" };
}

const LINE_DELAY_MS = 160;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Streams the live agentic terminal as newline-delimited JSON events. */
export async function POST(req: Request) {
  let body: z.infer<typeof schema>;
  try {
    seedIfEmpty();
    if (Number(req.headers.get("content-length") ?? 0) > SOURCE_LIMITS.maxUploadBytes + 500_000) {
      throw new PaymentError("VALIDATION", "The upload is too large.", 413);
    }
    body = await readBody(req, schema);
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const result = await auditAndRelease(body.itemId, toInput(body), async (line) => {
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
