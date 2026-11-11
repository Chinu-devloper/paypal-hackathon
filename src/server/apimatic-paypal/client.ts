import { randomUUID } from "node:crypto";
import { paypalCredentials } from "../env";
import { addApiCall } from "../repo";
import {
  PayPalApiError,
  type AuthorizationResponse,
  type CaptureRequest,
  type CaptureResponse,
  type CreateOrderRequest,
  type InvoiceDraftRequest,
  type InvoiceDraftResponse,
  type OrderResponse,
  type PayoutRequest,
  type PayoutResponse,
  type RefundRequest,
  type RefundResponse,
} from "./models";
import { OfficialSdkTransport } from "./official-sdk-transport";
import { LiveTransport, SimulatedTransport, type HttpRequest, type Transport } from "./transport";

export interface CallContext {
  projectId?: string | null;
  itemId?: string | null;
  /** Force the simulator (e.g. authorization was created by the 1-click sandbox button). */
  forceSimulated?: boolean;
}

const live = new LiveTransport();
const sim = new SimulatedTransport();

// Orders/Payments go through the official (APIMatic-generated) PayPal SDK; Payouts/Invoicing use REST.
function pickTransport(ctx: CallContext, req: HttpRequest): Transport {
  if (ctx.forceSimulated || !paypalCredentials()) return sim;
  return OfficialSdkTransport.supports(req) ? new OfficialSdkTransport() : live;
}

function errorMessage(body: unknown, fallback: string): { message: string; debugId: string | null } {
  if (body && typeof body === "object") {
    const b = body as { message?: string; name?: string; debug_id?: string; error_description?: string };
    return { message: b.message ?? b.error_description ?? b.name ?? fallback, debugId: b.debug_id ?? null };
  }
  return { message: fallback, debugId: null };
}

async function call<T>(operation: string, ctx: CallContext, req: HttpRequest): Promise<T> {
  const transport = pickTransport(ctx, req);
  const started = Date.now();
  let status = 0;
  let responseBody: unknown = null;
  try {
    const res = await transport.send(req);
    status = res.status;
    responseBody = res.body;
  } catch (err) {
    responseBody = { error: err instanceof Error ? err.message : String(err) };
    record();
    if (err instanceof PayPalApiError) throw err;
    throw new PayPalApiError(`Network error calling PayPal (${operation}): ${(err as Error).message}`, 0, null, responseBody);
  }
  record();

  if (status < 200 || status >= 300) {
    const { message, debugId } = errorMessage(responseBody, `PayPal ${operation} failed with HTTP ${status}`);
    throw new PayPalApiError(`${operation}: ${message}`, status, debugId, responseBody);
  }
  return responseBody as T;

  function record() {
    try {
      addApiCall({
        projectId: ctx.projectId ?? null,
        itemId: ctx.itemId ?? null,
        ts: new Date().toISOString(),
        operation,
        simulated: transport.simulated,
        source: transport.source,
        method: req.method,
        url: `${transport.baseUrl}${req.path}`,
        requestHeaders: { ...req.headers },
        requestBody: req.body ?? null,
        status,
        responseBody,
        latencyMs: Date.now() - started,
        requestId: req.headers["PayPal-Request-Id"] ?? null,
      });
    } catch (err) {
      console.warn("[telemetry] failed to record API call", err);
    }
  }
}

function requireId(value: { id?: string } | null | undefined, operation: string): string {
  if (!value?.id) throw new PayPalApiError(`${operation}: response did not contain an id`, 502, null, value);
  return value.id;
}

/** APIMatic-style typed facade over the PayPal REST API. */
export const paypalSdk = {
  orders: {
    async create(req: CreateOrderRequest, ctx: CallContext, requestId: string = randomUUID()): Promise<OrderResponse> {
      const res = await call<OrderResponse>("orders.create", ctx, {
        method: "POST",
        path: "/v2/checkout/orders",
        headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
        body: req,
      });
      requireId(res, "orders.create");
      return res;
    },

    async authorize(
      orderId: string,
      ctx: CallContext,
      hint: { amount: string; currency?: string },
      requestId: string = randomUUID(),
    ): Promise<{ order: OrderResponse; authorization: AuthorizationResponse }> {
      const order = await call<OrderResponse>("orders.authorize", ctx, {
        method: "POST",
        path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
        headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
        body: {},
        simHint: hint,
      });
      const authorization = order.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!authorization?.id) {
        throw new PayPalApiError("orders.authorize: no authorization in response (buyer may not have approved)", 502, null, order);
      }
      if (authorization.status === "DENIED") {
        throw new PayPalApiError("orders.authorize: authorization denied by PayPal", 402, null, order);
      }
      return { order, authorization };
    },
  },

  authorizations: {
    async capture(authorizationId: string, req: CaptureRequest, requestId: string, ctx: CallContext): Promise<CaptureResponse> {
      const res = await call<CaptureResponse>("authorizations.capture", ctx, {
        method: "POST",
        path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
        headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
        body: req,
      });
      requireId(res, "authorizations.capture");
      if (res.status === "DECLINED" || res.status === "FAILED") {
        throw new PayPalApiError(`authorizations.capture: capture ${res.status}`, 402, null, res);
      }
      return res;
    },

    async void(authorizationId: string, requestId: string, ctx: CallContext): Promise<void> {
      await call<null>("authorizations.void", ctx, {
        method: "POST",
        path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
        headers: { "PayPal-Request-Id": requestId },
      });
    },
  },

  captures: {
    async refund(captureId: string, req: RefundRequest, requestId: string, ctx: CallContext): Promise<RefundResponse> {
      const res = await call<RefundResponse>("captures.refund", ctx, {
        method: "POST",
        path: `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
        headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
        body: req,
      });
      requireId(res, "captures.refund");
      return res;
    },
  },

  payouts: {
    async create(req: PayoutRequest, requestId: string, ctx: CallContext): Promise<PayoutResponse> {
      const res = await call<PayoutResponse>("payouts.create", ctx, {
        method: "POST",
        path: "/v1/payments/payouts",
        headers: { "PayPal-Request-Id": requestId },
        body: req,
      });
      if (!res?.batch_header?.payout_batch_id) {
        throw new PayPalApiError("payouts.create: response did not contain payout_batch_id", 502, null, res);
      }
      return res;
    },
  },

  invoicing: {
    async createDraft(req: InvoiceDraftRequest, requestId: string, ctx: CallContext): Promise<InvoiceDraftResponse> {
      const res = await call<{ href?: string; id?: string }>("invoicing.createDraft", ctx, {
        method: "POST",
        path: "/v2/invoicing/invoices",
        headers: { "PayPal-Request-Id": requestId },
        body: req,
      });
      const id = res.id ?? res.href?.split("/").pop();
      if (!id) throw new PayPalApiError("invoicing.createDraft: no invoice id in response", 502, null, res);
      return { id, href: res.href };
    },
  },
};

export type PayPalSdk = typeof paypalSdk;
