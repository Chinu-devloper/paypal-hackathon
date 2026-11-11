import { paypalSdk, PayPalApiError, usd, type CallContext } from "./paypal-sdkClient";
import type { InvoiceDraftRequest } from "./apimatic-paypal/models";
import { paypalCredentials } from "./env";
import { PaymentError } from "./errors";
import { checkPriceGuard } from "./procurement";
import {
  acquirePaymentLock,
  addAuditLog,
  getIdempotent,
  getItem,
  getProject,
  putIdempotent,
  releasePaymentLock,
  updateItem,
} from "./repo";
import { APPROVAL_THRESHOLD, AUTH_EXPIRY_DAYS, AUTH_WARNING_DAYS, type LedgerItem, type Project } from "../shared/types";
import { daysBetween, round2, sha256 } from "./utils";

export type Emitter = (line: string) => void | Promise<void>;
const noop: Emitter = () => {};

function load(itemId: string): { item: LedgerItem; project: Project } {
  const item = getItem(itemId);
  if (!item) throw new PaymentError("NOT_FOUND", "Item not found", 404);
  const project = getProject(item.projectId);
  if (!project) throw new PaymentError("NOT_FOUND", "Project not found", 404);
  return { item, project };
}

function ctxFor(item: LedgerItem, forceSimulated = item.simulatedAuth): CallContext {
  return { projectId: item.projectId, itemId: item.id, forceSimulated };
}

function wrapPayPal(err: unknown, fallbackCode: "PAYPAL_ERROR" | "PAYOUT_FAILED" = "PAYPAL_ERROR"): never {
  if (err instanceof PaymentError) throw err;
  if (err instanceof PayPalApiError) {
    throw new PaymentError(fallbackCode, err.message + (err.debugId ? ` (PayPal debug_id ${err.debugId})` : ""), err.status >= 400 && err.status < 500 ? 422 : 502, err.body);
  }
  throw err;
}

export function authorizationAgeDays(item: LedgerItem): number | null {
  return item.authorizedAt ? daysBetween(item.authorizedAt) : null;
}

export function needsReauthorization(item: LedgerItem): boolean {
  const age = authorizationAgeDays(item);
  return item.status === "AUTHORIZED" && age !== null && age > AUTH_WARNING_DAYS;
}

function assertFundable(item: LedgerItem): void {
  if (item.kind === "PROCUREMENT") {
    if (!item.product) throw new PaymentError("INVALID_STATE", "Approve a Channel3 product before funding", 409);
    if (item.status !== "READY_TO_ORDER" && !needsReauthorization(item)) {
      throw new PaymentError("INVALID_STATE", `Item cannot be funded while ${item.status}`, 409);
    }
    return;
  }
  if (!["PENDING_FUNDING", "DRAFT"].includes(item.status) && !needsReauthorization(item)) {
    throw new PaymentError("INVALID_STATE", `Milestone cannot be funded while ${item.status}`, 409);
  }
}

async function withLock<T>(itemId: string, fn: () => Promise<T>): Promise<T> {
  if (!acquirePaymentLock(itemId)) {
    throw new PaymentError("IS_PROCESSING_PAYMENT", "Another payment operation is already in progress for this item", 409);
  }
  try {
    return await fn();
  } finally {
    releasePaymentLock(itemId);
  }
}

/** POST /api/paypal/create-order: creates an AUTHORIZE order sized to the milestone/product. */
export async function createFundingOrder(
  itemId: string,
  opts: { simulated?: boolean } = {},
): Promise<{ orderId: string; amount: number; simulated: boolean; priceGuard?: { livePrice: number } }> {
  const { item, project } = load(itemId);
  assertFundable(item);

  let amount = item.amount;
  let livePrice: number | undefined;
  if (item.kind === "PROCUREMENT") {
    const guard = await checkPriceGuard(item);
    if (!guard.ok) {
      addAuditLog(project.id, item.id, "WARN", "PRICE_GUARD_BLOCK", guard.message);
      throw new PaymentError("PRICE_GUARD", guard.message, 409, guard);
    }
    amount = guard.livePrice;
    livePrice = guard.livePrice;
  }

  const requestId = sha256(`${item.id}:order:${item.paypal.orderId ?? ""}:${Date.now()}`);
  const ctx = ctxFor(item, Boolean(opts.simulated));
  try {
    const order = await paypalSdk.orders.create(
      {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: item.id,
            custom_id: project.id,
            description: `MilestoneOS escrow: ${item.title}`.slice(0, 127),
            amount: { ...usd(amount), breakdown: { item_total: usd(amount) } },
            items: [{ name: item.title.slice(0, 127), quantity: "1", unit_amount: usd(amount), sku: item.id }],
          },
        ],
      },
      ctx,
      requestId,
    );
    updateItem(item.id, (it) => {
      it.paypal = { ...it.paypal, orderId: order.id };
      if (it.kind === "PROCUREMENT") it.amount = amount;
    });
    return { orderId: order.id, amount, simulated: !!opts.simulated, priceGuard: livePrice === undefined ? undefined : { livePrice } };
  } catch (err) {
    return wrapPayPal(err);
  }
}

/** POST /api/paypal/authorize-order: funds are placed on hold, not captured. */
export async function authorizeFundingOrder(
  itemId: string,
  orderId: string,
  opts: { simulated?: boolean } = {},
): Promise<LedgerItem> {
  const { item, project } = load(itemId);
  if (item.paypal.orderId !== orderId) {
    throw new PaymentError("VALIDATION", "Order ID does not match the order created for this item", 422);
  }
  const reauth = needsReauthorization(item);
  if (!reauth && !["PENDING_FUNDING", "DRAFT", "READY_TO_ORDER"].includes(item.status)) {
    throw new PaymentError("INVALID_STATE", `Cannot authorize while ${item.status}`, 409);
  }
  const previousAuth = reauth ? item.paypal.authorizationId : undefined;
  const previousSim = item.simulatedAuth;

  return withLock(itemId, async () => {
    try {
      const { authorization } = await paypalSdk.orders.authorize(
        orderId,
        ctxFor(item, Boolean(opts.simulated)),
        { amount: item.amount.toFixed(2) },
        sha256(`${item.id}:authorize:${orderId}`),
      );
      const authorizedAt = authorization.create_time ?? new Date().toISOString();
      const expires = authorization.expiration_time ?? new Date(new Date(authorizedAt).getTime() + AUTH_EXPIRY_DAYS * 86_400_000).toISOString();
      const updated = updateItem(itemId, (it) => {
        it.status = "AUTHORIZED";
        it.simulatedAuth = Boolean(opts.simulated) || !paypalCredentials();
        it.paypal = { ...it.paypal, authorizationId: authorization.id, captureId: undefined, payoutBatchId: undefined };
        it.authorizedAt = authorizedAt;
        it.authorizationExpiresAt = expires;
        it.paymentError = null;
      });
      addAuditLog(project.id, itemId, "INFO", "ESCROW_AUTHORIZED", `$${item.amount.toFixed(2)} placed on hold. Authorization ${authorization.id}${opts.simulated ? " (sandbox simulation)" : ""}.`);

      if (previousAuth) {
        try {
          await paypalSdk.authorizations.void(previousAuth, sha256(`${item.id}:void:${previousAuth}`), ctxFor(item, previousSim));
          addAuditLog(project.id, itemId, "INFO", "OLD_AUTH_VOIDED", `Superseded authorization ${previousAuth} voided after re-authorization.`);
        } catch (err) {
          addAuditLog(project.id, itemId, "WARN", "OLD_AUTH_VOID_FAILED", `Could not void ${previousAuth}: ${(err as Error).message}`);
        }
      }
      return updated;
    } catch (err) {
      return wrapPayPal(err);
    }
  });
}

/** 1-click judge convenience: runs create-order + authorize through the sandbox simulator. */
export async function simulateAuthorization(itemId: string): Promise<LedgerItem> {
  const { orderId } = await createFundingOrder(itemId, { simulated: true });
  return authorizeFundingOrder(itemId, orderId, { simulated: true });
}

export type ReleaseMode = "AUDIT" | "SETTLEMENT" | "PROCUREMENT";

export interface ReleaseResult {
  item: LedgerItem;
  deduplicated: boolean;
  capturedAmount: number;
  releasedToClient: number;
}

/**
 * Captures the held authorization and (for services) pays out the freelancer.
 * Every step is idempotent: keys are derived from item + authorization IDs and the item row is locked.
 */
export async function releaseFunds(itemId: string, mode: ReleaseMode, emit: Emitter = noop): Promise<ReleaseResult> {
  const { item, project } = load(itemId);
  const authId = item.paypal.authorizationId;
  if (!authId) throw new PaymentError("NO_AUTHORIZATION", "No PayPal authorization exists for this item; fund escrow first", 409);

  let amount: number;
  let score = item.auditScore ?? 0;
  if (mode === "AUDIT") {
    if (item.kind !== "SERVICE") throw new PaymentError("INVALID_STATE", "Only service milestones use AI audit release", 409);
    const audit = item.lastAudit;
    if (!audit || audit.verdict !== "APPROVED" || audit.score < APPROVAL_THRESHOLD) {
      throw new PaymentError("NOT_APPROVED", "Release blocked: no passing AI audit is recorded for this milestone", 403);
    }
    amount = item.amount;
    score = audit.score;
  } else if (mode === "SETTLEMENT") {
    const s = item.settlement;
    if (!s || !s.clientAccepted || !s.freelancerAccepted) {
      throw new PaymentError("NOT_APPROVED", "Release blocked: both parties must accept the settlement", 403);
    }
    amount = s.amount;
  } else {
    if (item.kind !== "PROCUREMENT") throw new PaymentError("INVALID_STATE", "Not a procurement item", 409);
    amount = item.amount;
  }

  const key = sha256(item.id + authId);
  const alreadyDone = item.status === "PAID_OUT" || (mode === "PROCUREMENT" && item.status === "CAPTURED");
  if (alreadyDone) {
    await emit(`[IDEMPOTENCY] PayPal-Request-Id ${key.slice(0, 12)}... already processed. No duplicate capture or payout sent.`);
    return { item, deduplicated: true, capturedAmount: item.capturedAmount ?? amount, releasedToClient: item.releasedToClient ?? 0 };
  }
  if (!["AUTHORIZED", "AI_AUDITING", "REVISION_NEEDED", "CAPTURED"].includes(item.status)) {
    throw new PaymentError("INVALID_STATE", `Cannot release funds while status is ${item.status}`, 409);
  }
  const age = authorizationAgeDays(item);
  if (item.status !== "CAPTURED" && age !== null && age > AUTH_EXPIRY_DAYS) {
    throw new PaymentError("AUTH_EXPIRED", "The PayPal authorization has expired (29 days). Re-authorize before releasing funds.", 409);
  }

  return withLock(itemId, async () => {
    const ctx = ctxFor(item);
    const holdAmount = item.amount;
    const captureKey = `capture:${key}`;
    try {
      let capture = getIdempotent<{ id: string; amount: string }>(captureKey);
      if (capture) {
        await emit(`[IDEMPOTENCY] Capture for Auth ID ${authId} already completed (${capture.id}); skipping duplicate capture.`);
      } else {
        await emit(`[APIMATIC SDK] Calling PayPal Capture API for Auth ID: ${authId} (PayPal-Request-Id: ${key.slice(0, 16)}...)`);
        const res = await paypalSdk.authorizations.capture(
          authId,
          { amount: usd(amount), final_capture: true, invoice_id: `MOS-${item.id}`.slice(0, 127), note_to_payer: `MilestoneOS: ${item.title}`.slice(0, 255) },
          key,
          ctx,
        );
        capture = { id: res.id, amount: res.amount?.value ?? amount.toFixed(2) };
        putIdempotent(captureKey, capture);
      }
      const holdback = round2(holdAmount - amount);
      updateItem(itemId, (it) => {
        it.status = "CAPTURED";
        it.paypal = { ...it.paypal, captureId: capture?.id };
        it.capturedAmount = amount;
        it.releasedToClient = holdback > 0 ? holdback : 0;
        it.paymentError = null;
      });
      addAuditLog(project.id, itemId, "INFO", "FUNDS_CAPTURED", `Captured $${amount.toFixed(2)} (capture ${capture.id}).`);
      if (holdback > 0) {
        await emit(`[PAYPAL] final_capture=true for $${amount.toFixed(2)}: remaining $${holdback.toFixed(2)} hold released back to the client.`);
      }

      if (mode === "PROCUREMENT") {
        await emit(`[SUCCESS] Procurement funded. PayPal Capture ID: ${capture.id}`);
        return { item: getItem(itemId) as LedgerItem, deduplicated: false, capturedAmount: amount, releasedToClient: holdback };
      }

      const payoutKey = sha256(`${item.id}${authId}:payout`);
      const payoutIdemKey = `payout:${payoutKey}`;
      let payout = getIdempotent<{ batchId: string }>(payoutIdemKey);
      if (payout) {
        await emit(`[IDEMPOTENCY] Payout batch ${payout.batchId} already created; skipping duplicate payout.`);
      } else {
        await emit(`[APIMATIC SDK] Calling PayPal Payouts API -> ${project.freelancerEmail} ($${amount.toFixed(2)})...`);
        try {
          const res = await paypalSdk.payouts.create(
            {
              sender_batch_header: { sender_batch_id: payoutKey.slice(0, 32), email_subject: "You have a payout from PayPal MilestoneOS" },
              items: [
                {
                  recipient_type: "EMAIL",
                  receiver: project.freelancerEmail,
                  amount: usd(amount),
                  note: `PayPal MilestoneOS AI Verified Payout - Audit Score: ${score}%`,
                  sender_item_id: item.id,
                },
              ],
            },
            payoutKey,
            ctx,
          );
          payout = { batchId: res.batch_header.payout_batch_id };
          putIdempotent(payoutIdemKey, payout);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          updateItem(itemId, (it) => {
            it.paymentError = `Funds captured but payout failed: ${message}`;
          });
          addAuditLog(project.id, itemId, "ALERT", "PAYOUT_FAILED", `Capture succeeded but payout failed: ${message}. Retry is safe (idempotent).`);
          return wrapPayPal(err, "PAYOUT_FAILED");
        }
      }
      updateItem(itemId, (it) => {
        it.status = "PAID_OUT";
        it.paypal = { ...it.paypal, payoutBatchId: payout?.batchId };
        it.paymentError = null;
      });
      addAuditLog(project.id, itemId, "INFO", "PAID_OUT", `Paid $${amount.toFixed(2)} to ${project.freelancerEmail}. Payout batch ${payout.batchId}.`);
      await emit(`[SUCCESS] Funds released! PayPal Capture ID: ${capture.id} | Payout Batch ID: ${payout.batchId}`);
      return { item: getItem(itemId) as LedgerItem, deduplicated: false, capturedAmount: amount, releasedToClient: holdback };
    } catch (err) {
      if (!(err instanceof PaymentError)) {
        const message = err instanceof Error ? err.message : String(err);
        const current = getItem(itemId);
        if (current && current.status !== "CAPTURED") {
          updateItem(itemId, (it) => {
            it.paymentError = message;
          });
        }
      }
      return wrapPayPal(err);
    }
  });
}

/** Records one party's decision on a pro-rated settlement; captures once both accept. */
export async function recordSettlementDecision(
  itemId: string,
  party: "client" | "freelancer",
  accept: boolean,
  emit: Emitter = noop,
): Promise<{ item: LedgerItem; released: boolean }> {
  const { item, project } = load(itemId);
  const offer = item.lastAudit?.settlementOffer;
  if (item.status !== "REVISION_NEEDED" || !offer) {
    throw new PaymentError("INVALID_STATE", "No settlement offer is open for this milestone", 409);
  }
  if (!accept) {
    updateItem(itemId, (it) => {
      it.settlement = null;
    });
    addAuditLog(project.id, itemId, "INFO", "SETTLEMENT_DECLINED", `${party} declined the $${offer.amount.toFixed(2)} settlement. Funds remain in escrow.`);
    return { item: getItem(itemId) as LedgerItem, released: false };
  }
  const updated = updateItem(itemId, (it) => {
    const s = it.settlement ?? { amount: offer.amount, holdback: offer.holdback, clientAccepted: false, freelancerAccepted: false };
    if (party === "client") s.clientAccepted = true;
    else s.freelancerAccepted = true;
    it.settlement = s;
  });
  addAuditLog(project.id, itemId, "INFO", "SETTLEMENT_ACCEPTED", `${party} accepted the $${offer.amount.toFixed(2)} settlement.`);
  if (updated.settlement?.clientAccepted && updated.settlement.freelancerAccepted) {
    await emit(`[SETTLEMENT] Both parties accepted $${offer.amount.toFixed(2)} of $${item.amount.toFixed(2)}.`);
    const res = await releaseFunds(itemId, "SETTLEMENT", emit);
    return { item: res.item, released: true };
  }
  return { item: updated, released: false };
}

/** POST /api/paypal/void-or-refund */
export async function voidOrRefund(itemId: string, action: "VOID" | "REFUND", refundAmount?: number): Promise<LedgerItem> {
  const { item, project } = load(itemId);
  return withLock(itemId, async () => {
    try {
      if (action === "VOID") {
        const authId = item.paypal.authorizationId;
        if (!authId || item.capturedAmount !== null || ["PAID_OUT", "CAPTURED", "VOIDED", "REFUNDED"].includes(item.status)) {
          throw new PaymentError("INVALID_STATE", "Only an uncaptured authorization can be voided", 409);
        }
        await paypalSdk.authorizations.void(authId, sha256(`${item.id}:void:${authId}`), ctxFor(item));
        const updated = updateItem(itemId, (it) => {
          it.status = "VOIDED";
          it.releasedToClient = it.amount;
        });
        addAuditLog(project.id, itemId, "INFO", "AUTH_VOIDED", `Authorization ${authId} voided; $${item.amount.toFixed(2)} released back to the client.`);
        return updated;
      }

      const captureId = item.paypal.captureId;
      if (!captureId || item.capturedAmount === null || ["REFUNDED", "VOIDED"].includes(item.status)) {
        throw new PaymentError("INVALID_STATE", "Only a captured payment can be refunded", 409);
      }
      const amount = round2(refundAmount ?? item.capturedAmount);
      if (!(amount > 0) || amount > item.capturedAmount) {
        throw new PaymentError("VALIDATION", `Refund amount must be between 0.01 and ${item.capturedAmount.toFixed(2)}`, 422);
      }
      const res = await paypalSdk.captures.refund(
        captureId,
        { amount: usd(amount), note_to_payer: `MilestoneOS refund: ${item.title}`.slice(0, 255) },
        sha256(`${item.id}:refund:${captureId}:${amount}`),
        ctxFor(item),
      );
      const updated = updateItem(itemId, (it) => {
        it.status = "REFUNDED";
        it.paypal = { ...it.paypal, refundId: res.id };
        it.releasedToClient = round2((it.releasedToClient ?? 0) + amount);
      });
      addAuditLog(project.id, itemId, "INFO", "REFUNDED", `Refunded $${amount.toFixed(2)} (refund ${res.id}).`);
      return updated;
    } catch (err) {
      return wrapPayPal(err);
    }
  });
}

export interface Receipt {
  itemId: string;
  title: string;
  payee: string;
  status: LedgerItem["status"];
  amount: number;
  capturedAmount: number | null;
  releasedToClient: number | null;
  auditScore: number | null;
  paypal: LedgerItem["paypal"];
  authorizedAt: string | null;
  invoiceNote?: string;
}

/** Builds a receipt; creates (once) a PayPal Invoicing v2 draft for the paid item. */
export async function getReceipt(itemId: string): Promise<Receipt> {
  const { item, project } = load(itemId);
  if (!["PAID_OUT", "CAPTURED", "REFUNDED"].includes(item.status)) {
    throw new PaymentError("INVALID_STATE", "A receipt is available after funds are captured", 409);
  }
  let invoiceNote: string | undefined;
  if (!item.paypal.invoiceId) {
    try {
      const body: InvoiceDraftRequest = {
        detail: { invoice_number: `MOS-${item.id}`.slice(0, 25), currency_code: "USD", note: `Milestone: ${item.title}` },
        primary_recipients: [{ billing_info: { email_address: project.clientEmail } }],
        items: [{ name: item.title.slice(0, 200), quantity: "1", unit_amount: usd(item.capturedAmount ?? item.amount) }],
      };
      const invoice = await paypalSdk.invoicing.createDraft(body, sha256(`${item.id}:invoice`), ctxFor(item));
      updateItem(itemId, (it) => {
        it.paypal = { ...it.paypal, invoiceId: invoice.id };
      });
    } catch (err) {
      invoiceNote = `PayPal draft invoice could not be created: ${(err as Error).message}`;
    }
  }
  const fresh = getItem(itemId) as LedgerItem;
  return {
    itemId: fresh.id,
    title: fresh.title,
    payee: fresh.payee,
    status: fresh.status,
    amount: fresh.amount,
    capturedAmount: fresh.capturedAmount,
    releasedToClient: fresh.releasedToClient,
    auditScore: fresh.auditScore,
    paypal: fresh.paypal,
    authorizedAt: fresh.authorizedAt,
    invoiceNote,
  };
}
