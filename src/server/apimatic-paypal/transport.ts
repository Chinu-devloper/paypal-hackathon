import { createHash, randomUUID } from "node:crypto";
import { paypalBaseUrl, paypalCredentials } from "../env";
import { PayPalApiError } from "./models";

export interface HttpRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  /** Used only by the simulator to produce amounts for bodiless calls. */
  simHint?: { amount?: string; currency?: string; email?: string };
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export type TransportSource = "official-sdk" | "rest" | "simulator";

export interface Transport {
  readonly simulated: boolean;
  readonly source: TransportSource;
  readonly baseUrl: string;
  send(req: HttpRequest): Promise<HttpResponse>;
}

const REQUEST_TIMEOUT_MS = 20_000;

function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

const globalForToken = globalThis as unknown as { __ppToken?: TokenCache };

async function getAccessToken(): Promise<string> {
  const creds = paypalCredentials();
  if (!creds) throw new PayPalApiError("PayPal credentials are not configured", 500, null, null);

  const cached = globalForToken.__ppToken;
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const basic = Buffer.from(`${creds.clientId}:${creds.secret}`).toString("base64");
  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !body?.access_token) {
    throw new PayPalApiError("PayPal OAuth2 token request failed", res.status, null, body);
  }
  globalForToken.__ppToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000 };
  return body.access_token;
}

export class LiveTransport implements Transport {
  readonly simulated = false;
  readonly source = "rest" as const;
  readonly baseUrl = paypalBaseUrl();

  async send(req: HttpRequest): Promise<HttpResponse> {
    const token = await getAccessToken();
    const res = await fetch(`${this.baseUrl}${req.path}`, {
      method: req.method,
      headers: { ...req.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    return { status: res.status, body: parseJsonSafe(text) };
  }
}

/** Deterministic PayPal-looking identifier derived from a seed (so retries yield identical IDs). */
export function paypalLikeId(salt: string, seed: string, length = 17): string {
  const hex = createHash("sha256").update(`${salt}:${seed}`).digest("hex").toUpperCase();
  return hex.slice(0, length);
}

function simLatency(): Promise<void> {
  const configured = Number(process.env.SIM_LATENCY_MS);
  const ms = Number.isFinite(configured) && process.env.SIM_LATENCY_MS !== undefined ? configured : 250 + Math.random() * 450;
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function link(href: string, rel: string, method = "GET") {
  return { href, rel, method };
}

export class SimulatedTransport implements Transport {
  readonly simulated = true;
  readonly source = "simulator" as const;
  readonly baseUrl = "https://api-m.sandbox.paypal.com";

  async send(req: HttpRequest): Promise<HttpResponse> {
    await simLatency();
    const body = (req.body ?? {}) as Record<string, any>;
    const requestId = req.headers["PayPal-Request-Id"] ?? randomUUID();
    const now = new Date();
    const iso = now.toISOString();
    const base = this.baseUrl;

    if (req.method === "POST" && req.path === "/v2/checkout/orders") {
      const unit = body.purchase_units?.[0] ?? {};
      const id = paypalLikeId("order", requestId);
      return {
        status: 201,
        body: {
          id,
          status: "CREATED",
          intent: body.intent ?? "AUTHORIZE",
          purchase_units: [{ reference_id: unit.reference_id ?? "default", amount: unit.amount }],
          create_time: iso,
          links: [
            link(`${base}/v2/checkout/orders/${id}`, "self"),
            link(`https://www.sandbox.paypal.com/checkoutnow?token=${id}`, "approve"),
            link(`${base}/v2/checkout/orders/${id}/authorize`, "authorize", "POST"),
          ],
        },
      };
    }

    const authorizeMatch = req.path.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/);
    if (req.method === "POST" && authorizeMatch) {
      const orderId = authorizeMatch[1];
      const authId = paypalLikeId("auth", orderId);
      const expires = new Date(now.getTime() + 29 * 86_400_000).toISOString();
      const amount = { currency_code: req.simHint?.currency ?? "USD", value: req.simHint?.amount ?? "0.00" };
      return {
        status: 201,
        body: {
          id: orderId,
          status: "COMPLETED",
          intent: "AUTHORIZE",
          payer: { email_address: "sb-buyer@personal.example.com", name: { given_name: "Sandbox", surname: "Buyer" } },
          purchase_units: [
            {
              amount,
              payments: {
                authorizations: [
                  {
                    id: authId,
                    status: "CREATED",
                    amount,
                    create_time: iso,
                    expiration_time: expires,
                    links: [
                      link(`${base}/v2/payments/authorizations/${authId}`, "self"),
                      link(`${base}/v2/payments/authorizations/${authId}/capture`, "capture", "POST"),
                      link(`${base}/v2/payments/authorizations/${authId}/void`, "void", "POST"),
                    ],
                  },
                ],
              },
            },
          ],
        },
      };
    }

    const captureMatch = req.path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/capture$/);
    if (req.method === "POST" && captureMatch) {
      const capId = paypalLikeId("cap", `${captureMatch[1]}:${requestId}`);
      return {
        status: 201,
        body: {
          id: capId,
          status: "COMPLETED",
          amount: body.amount,
          final_capture: Boolean(body.final_capture),
          invoice_id: body.invoice_id,
          create_time: iso,
          seller_protection: { status: "ELIGIBLE" },
          links: [link(`${base}/v2/payments/captures/${capId}`, "self"), link(`${base}/v2/payments/captures/${capId}/refund`, "refund", "POST")],
        },
      };
    }

    const voidMatch = req.path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/void$/);
    if (req.method === "POST" && voidMatch) {
      return { status: 204, body: null };
    }

    const refundMatch = req.path.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/);
    if (req.method === "POST" && refundMatch) {
      const id = paypalLikeId("refund", `${refundMatch[1]}:${requestId}`);
      return { status: 201, body: { id, status: "COMPLETED", amount: body.amount, create_time: iso } };
    }

    if (req.method === "POST" && req.path === "/v1/payments/payouts") {
      const batchId = paypalLikeId("payout", requestId, 13);
      return {
        status: 201,
        body: {
          batch_header: {
            payout_batch_id: batchId,
            batch_status: "PENDING",
            sender_batch_header: body.sender_batch_header,
          },
          links: [link(`${base}/v1/payments/payouts/${batchId}`, "self")],
        },
      };
    }

    if (req.method === "POST" && req.path === "/v2/invoicing/invoices") {
      const id = `INV2-${paypalLikeId("inv", requestId, 4)}-${paypalLikeId("inv2", requestId, 4)}-${paypalLikeId("inv3", requestId, 4)}`;
      return { status: 201, body: { rel: "self", href: `${base}/v2/invoicing/invoices/${id}`, method: "GET" } };
    }

    const invoiceSend = req.path.match(/^\/v2\/invoicing\/invoices\/([^/]+)\/send$/);
    if (req.method === "POST" && invoiceSend) {
      return { status: 202, body: { rel: "self", href: `${base}/v2/invoicing/invoices/${invoiceSend[1]}`, method: "GET" } };
    }

    return {
      status: 404,
      body: { name: "RESOURCE_NOT_FOUND", message: `Simulator has no route for ${req.method} ${req.path}`, debug_id: "SIM404" },
    };
  }
}
