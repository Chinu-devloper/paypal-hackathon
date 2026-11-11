/**
 * Strongly-typed models for the subset of PayPal REST APIs used by MilestoneOS.
 * Shapes follow PayPal Orders v2, Payments v2, Payouts v1 and Invoicing v2.
 */

export interface Money {
  currency_code: string;
  value: string;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface OrderItemInput {
  name: string;
  quantity: string;
  unit_amount: Money;
  sku?: string;
}

export interface CreateOrderRequest {
  intent: "AUTHORIZE" | "CAPTURE";
  purchase_units: Array<{
    reference_id: string;
    custom_id?: string;
    description?: string;
    amount: Money & { breakdown?: { item_total: Money } };
    items?: OrderItemInput[];
  }>;
}

export interface OrderResponse {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  intent?: string;
  purchase_units?: Array<{
    reference_id?: string;
    amount?: Money;
    payments?: {
      authorizations?: AuthorizationResponse[];
      captures?: CaptureResponse[];
    };
  }>;
  links?: PayPalLink[];
}

export interface AuthorizationResponse {
  id: string;
  status: "CREATED" | "CAPTURED" | "DENIED" | "EXPIRED" | "PARTIALLY_CAPTURED" | "VOIDED" | "PENDING";
  amount?: Money;
  create_time?: string;
  expiration_time?: string;
  links?: PayPalLink[];
}

export interface CaptureRequest {
  amount: Money;
  final_capture: boolean;
  invoice_id?: string;
  note_to_payer?: string;
}

export interface CaptureResponse {
  id: string;
  status: "COMPLETED" | "PENDING" | "DECLINED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED";
  amount?: Money;
  final_capture?: boolean;
  invoice_id?: string;
  create_time?: string;
  links?: PayPalLink[];
}

export interface RefundRequest {
  amount?: Money;
  note_to_payer?: string;
}

export interface RefundResponse {
  id: string;
  status: "COMPLETED" | "PENDING" | "FAILED" | "CANCELLED";
  amount?: Money;
}

export interface PayoutRequest {
  sender_batch_header: {
    sender_batch_id: string;
    email_subject: string;
    email_message?: string;
  };
  items: Array<{
    recipient_type: "EMAIL";
    receiver: string;
    amount: Money;
    note: string;
    sender_item_id: string;
  }>;
}

export interface PayoutResponse {
  batch_header: {
    payout_batch_id: string;
    batch_status: "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED";
    sender_batch_header?: { sender_batch_id: string; email_subject?: string };
  };
  links?: PayPalLink[];
}

export interface InvoiceDraftRequest {
  detail: {
    invoice_number: string;
    currency_code: string;
    note?: string;
  };
  invoicer?: { email_address?: string };
  primary_recipients: Array<{ billing_info: { email_address: string } }>;
  items: Array<{ name: string; quantity: string; unit_amount: Money; description?: string }>;
}

export interface InvoiceDraftResponse {
  id: string;
  href?: string;
  status?: string;
}

export function usd(value: number): Money {
  return { currency_code: "USD", value: value.toFixed(2) };
}

export class PayPalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId: string | null,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "PayPalApiError";
  }
}
