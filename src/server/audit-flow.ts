import { MAX_SUBMISSION_CHARS, runAudit } from "./ai/auditor";
import { PaymentError } from "./errors";
import { authorizationAgeDays, releaseFunds, type Emitter } from "./payments";
import { addAuditLog, getItem, getProject, updateItem } from "./repo";
import { AUTH_EXPIRY_DAYS, type AuditRecord, type LedgerItem } from "../shared/types";

const AUDITABLE: LedgerItem["status"][] = ["AUTHORIZED", "AI_AUDITING", "REVISION_NEEDED", "SECURITY_FLAGGED"];
const FINAL: LedgerItem["status"][] = ["CAPTURED", "PAID_OUT", "REFUNDED", "VOIDED"];

export interface AuditFlowResult {
  item: LedgerItem;
  record: AuditRecord;
  released: boolean;
  error: { code: string; message: string } | null;
}

/** Updates an item only while it is still open and not mid-payment (guards concurrent requests). */
function mutateIfOpen(itemId: string, fn: (item: LedgerItem) => void): LedgerItem {
  return updateItem(itemId, (it) => {
    if (FINAL.includes(it.status) || it.isProcessingPayment) {
      throw new PaymentError("IS_PROCESSING_PAYMENT", "Milestone is being paid or is already settled; audit result discarded", 409);
    }
    fn(it);
  });
}

export async function auditAndRelease(itemId: string, submission: string, emit: Emitter): Promise<AuditFlowResult> {
  const text = submission.trim();
  if (!text) throw new PaymentError("VALIDATION", "Submission is empty", 422);
  if (text.length > MAX_SUBMISSION_CHARS) throw new PaymentError("VALIDATION", `Submission exceeds ${MAX_SUBMISSION_CHARS} characters`, 413);

  const item = getItem(itemId);
  if (!item) throw new PaymentError("NOT_FOUND", "Item not found", 404);
  const project = getProject(item.projectId);
  if (!project) throw new PaymentError("NOT_FOUND", "Project not found", 404);
  if (item.kind !== "SERVICE") throw new PaymentError("INVALID_STATE", "Only service milestones can be audited", 409);
  if (!AUDITABLE.includes(item.status) || !item.paypal.authorizationId) {
    throw new PaymentError("INVALID_STATE", `Milestone must have funds held in escrow to be audited (status: ${item.status})`, 409);
  }
  if (item.isProcessingPayment) throw new PaymentError("IS_PROCESSING_PAYMENT", "A payment is already being processed for this milestone", 409);
  const age = authorizationAgeDays(item);
  if (age !== null && age > AUTH_EXPIRY_DAYS) {
    throw new PaymentError("AUTH_EXPIRED", "The PayPal authorization has expired. Re-authorize before auditing.", 409);
  }

  mutateIfOpen(itemId, (it) => {
    it.status = "AI_AUDITING";
    it.paymentError = null;
  });
  addAuditLog(project.id, itemId, "INFO", "AUDIT_STARTED", `Deliverable submitted for "${item.title}" (${text.length} chars).`);

  const record = await runAudit(
    { milestoneTitle: item.title, amount: item.amount, criteria: item.acceptanceCriteria, submission: text },
    emit,
  );

  if (record.verdict === "SECURITY_FLAGGED") {
    const updated = mutateIfOpen(itemId, (it) => {
      it.status = "SECURITY_FLAGGED";
      it.lastAudit = record;
      it.auditScore = 0;
      it.settlement = null;
    });
    addAuditLog(project.id, itemId, "ALERT", "PROMPT_INJECTION_BLOCKED", `Submission blocked: ${record.injectionFindings.join(" | ")}`);
    await emit(`[ESCROW LOCK] PayPal Capture and Payout APIs were NOT called. Authorization ${item.paypal.authorizationId} remains HELD.`);
    return { item: updated, record, released: false, error: null };
  }

  if (record.verdict === "REVISION_NEEDED") {
    const updated = mutateIfOpen(itemId, (it) => {
      it.status = "REVISION_NEEDED";
      it.lastAudit = record;
      it.auditScore = record.score;
      it.settlement = null;
    });
    addAuditLog(project.id, itemId, "WARN", "REVISION_NEEDED", `Score ${record.score}/100 is below the threshold of ${record.threshold}. Funds stay in escrow.`);
    for (const [i, fix] of record.revisionChecklist.entries()) await emit(`[REVISION ${i + 1}] ${fix}`);
    if (record.settlementOffer) {
      const s = record.settlementOffer;
      await emit(`[SETTLEMENT] Fair pro-rated settlement: $${s.amount.toFixed(2)} of $${item.amount.toFixed(2)} (client keeps $${s.holdback.toFixed(2)}). Requires acceptance from both parties.`);
    }
    await emit(`[ESCROW LOCK] PayPal Capture API NOT called. Authorization ${item.paypal.authorizationId} remains HELD.`);
    return { item: updated, record, released: false, error: null };
  }

  mutateIfOpen(itemId, (it) => {
    it.lastAudit = record;
    it.auditScore = record.score;
    it.settlement = null;
  });
  addAuditLog(project.id, itemId, "INFO", "AUDIT_APPROVED", `Score ${record.score}/100 approved for autonomous release.`);

  try {
    const res = await releaseFunds(itemId, "AUDIT", emit);
    return { item: res.item, record, released: !res.deduplicated, error: null };
  } catch (err) {
    const e = err instanceof PaymentError ? err : new PaymentError("PAYPAL_ERROR", (err as Error).message, 500);
    await emit(`[ERROR] ${e.code}: ${e.message}`);
    if (e.code === "IS_PROCESSING_PAYMENT") {
      await emit("[IDEMPOTENCY] Duplicate request rejected: milestone row is locked (IS_PROCESSING_PAYMENT). No second capture or payout was sent.");
    } else {
      const current = getItem(itemId);
      if (current?.status === "AI_AUDITING") {
        updateItem(itemId, (it) => {
          it.status = "AUTHORIZED";
          it.paymentError = e.message;
        });
      }
    }
    return { item: getItem(itemId) as LedgerItem, record, released: false, error: { code: e.code, message: e.message } };
  }
}
