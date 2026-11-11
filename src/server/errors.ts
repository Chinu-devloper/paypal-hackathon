export type PaymentErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "IS_PROCESSING_PAYMENT"
  | "NO_AUTHORIZATION"
  | "AUTH_EXPIRED"
  | "NOT_APPROVED"
  | "PRICE_GUARD"
  | "OVER_BUDGET"
  | "OUT_OF_STOCK"
  | "PAYPAL_ERROR"
  | "PAYOUT_FAILED"
  | "VALIDATION"
  | "DEMO_DISABLED";

export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
    readonly httpStatus: number = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
