import {
  ApiError,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  type OrderRequest,
  type RefundRequest,
  type CaptureRequest,
} from "@paypal/paypal-server-sdk";
import { getEnvStatus, paypalCredentials } from "../env";
import { PayPalApiError } from "./models";
import type { HttpRequest, HttpResponse, Transport } from "./transport";

/**
 * Live transport backed by PayPal's official Server SDK (@paypal/paypal-server-sdk), which is generated
 * by APIMatic. It covers Orders v2 and Payments v2; Payouts and Invoicing are not in that SDK and use the
 * REST transport.
 */

const REQUEST_TIMEOUT_MS = 20_000;

interface SdkBundle {
  key: string;
  orders: OrdersController;
  payments: PaymentsController;
}

let bundle: SdkBundle | null = null;

function sdk(): SdkBundle {
  const creds = paypalCredentials();
  if (!creds) throw new PayPalApiError("PayPal credentials are not configured", 500, null, null);
  const env = getEnvStatus().paypalEnv;
  const key = `${creds.clientId}:${env}`;
  if (!bundle || bundle.key !== key) {
    const client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: creds.clientId, oAuthClientSecret: creds.secret },
      timeout: REQUEST_TIMEOUT_MS,
      environment: env === "live" ? Environment.Production : Environment.Sandbox,
    });
    bundle = { key, orders: new OrdersController(client), payments: new PaymentsController(client) };
  }
  return bundle;
}

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Converts the snake_case REST payloads used across the app into the SDK's camelCase models. */
function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [camel(k), camelize(v)]));
  }
  return value;
}

function parse(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: raw.slice(0, 2000) };
  }
}

export const OFFICIAL_SDK_ROUTES: RegExp[] = [
  /^\/v2\/checkout\/orders$/,
  /^\/v2\/checkout\/orders\/[^/]+\/authorize$/,
  /^\/v2\/payments\/authorizations\/[^/]+\/(capture|void)$/,
  /^\/v2\/payments\/captures\/[^/]+\/refund$/,
];

export class OfficialSdkTransport implements Transport {
  readonly simulated = false;
  readonly source = "official-sdk" as const;
  readonly baseUrl = getEnvStatus().paypalEnv === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  static supports(req: HttpRequest): boolean {
    return req.method === "POST" && OFFICIAL_SDK_ROUTES.some((re) => re.test(req.path));
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    const { orders, payments } = sdk();
    const paypalRequestId = req.headers["PayPal-Request-Id"];
    const prefer = req.headers["Prefer"];
    const body = camelize(req.body ?? {});

    try {
      let res;
      if (req.path === "/v2/checkout/orders") {
        res = await orders.createOrder({ body: body as OrderRequest, paypalRequestId, prefer });
      } else {
        const auth = req.path.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/);
        const capture = req.path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/capture$/);
        const voided = req.path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/void$/);
        const refund = req.path.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/);
        if (auth) res = await orders.authorizeOrder({ id: decodeURIComponent(auth[1]), paypalRequestId, prefer });
        else if (capture) res = await payments.captureAuthorizedPayment({ authorizationId: decodeURIComponent(capture[1]), paypalRequestId, prefer, body: body as CaptureRequest });
        else if (voided) res = await payments.voidPayment({ authorizationId: decodeURIComponent(voided[1]), paypalRequestId, prefer });
        else if (refund) res = await payments.refundCapturedPayment({ captureId: decodeURIComponent(refund[1]), paypalRequestId, prefer, body: body as RefundRequest });
        else throw new PayPalApiError(`Official SDK transport has no route for ${req.method} ${req.path}`, 501, null, null);
      }
      // The raw body keeps PayPal's original snake_case JSON, which the rest of the app expects.
      return { status: res.statusCode, body: parse(res.body) };
    } catch (err) {
      if (err instanceof ApiError) return { status: err.statusCode, body: parse(err.body) ?? { message: err.message } };
      throw err;
    }
  }
}
