import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { demoToolsEnabled } from "./env";
import { PaymentError } from "./errors";
import { seedIfEmpty } from "./seed";

/** Guards demo-only endpoints (sample deliverables, simulated authorization, reset). */
export function requireDemoTools(): void {
  if (!demoToolsEnabled()) throw new PaymentError("DEMO_DISABLED", "Demo tools are disabled on this server", 403);
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof PaymentError) {
    return json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.httpStatus);
  }
  if (err instanceof ZodError) {
    return json({ error: { code: "VALIDATION", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") } }, 422);
  }
  console.error("[api] unexpected error", err);
  return json({ error: { code: "INTERNAL", message: "Unexpected server error" } }, 500);
}

/** Wraps a route handler: seeds demo data on first use and maps errors to JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    seedIfEmpty();
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}

export async function readBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new PaymentError("VALIDATION", "Request body must be valid JSON", 400);
  }
  return schema.parse(raw);
}
