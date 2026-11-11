"use client";

import { useEffect, useState } from "react";
import { Banner, Button, Drawer, Modal, Pill, ScoreBar } from "./ui";
import { AuditTrail } from "./TelemetryTab";
import { api, ApiError, authAgeDays, authNeedsReauth, fmtDateTime, fmtMoney, STATUS_META } from "@/client/helpers";
import type { AuditLogEntry, EnvStatus, LedgerItem } from "@/shared/types";

interface ReceiptData {
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

export function ReceiptModal({ item, onClose, onChanged }: { item: LedgerItem; onClose: () => void; onChanged: () => void }) {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ receipt: ReceiptData }>("/api/paypal/receipt", { body: { itemId: item.id } })
      .then((res) => {
        if (!cancelled) {
          setReceipt(res.receipt);
          onChanged();
        }
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load the receipt"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const rows: Array<[string, string | undefined]> = receipt
    ? [
        ["Order ID", receipt.paypal.orderId],
        ["Authorization ID", receipt.paypal.authorizationId],
        ["Capture ID", receipt.paypal.captureId],
        ["Payout Batch ID", receipt.paypal.payoutBatchId],
        ["Invoice ID", receipt.paypal.invoiceId],
        ["Refund ID", receipt.paypal.refundId],
      ]
    : [];

  return (
    <Modal title="Receipt" subtitle={item.title} onClose={onClose}>
      {error && <Banner tone="error">{error}</Banner>}
      {!receipt && !error && <p className="text-sm text-slate-400">Generating receipt and PayPal draft invoice...</p>}
      {receipt && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-ink-600/60 bg-ink-800/60 p-4">
            <div><div className="text-xs text-slate-500">Payee</div><div className="text-white">{receipt.payee}</div></div>
            <div><div className="text-xs text-slate-500">Status</div><Pill className={STATUS_META[receipt.status].className}>{STATUS_META[receipt.status].label}</Pill></div>
            <div><div className="text-xs text-slate-500">Escrow amount</div><div className="font-semibold text-white">{fmtMoney(receipt.amount)}</div></div>
            <div><div className="text-xs text-slate-500">Captured</div><div className="font-semibold text-emerald-300">{receipt.capturedAmount !== null ? fmtMoney(receipt.capturedAmount) : "-"}</div></div>
            <div><div className="text-xs text-slate-500">Returned to client</div><div className="text-white">{fmtMoney(receipt.releasedToClient ?? 0)}</div></div>
            <div><div className="text-xs text-slate-500">AI audit score</div><div className="w-32">{receipt.auditScore !== null ? <ScoreBar score={receipt.auditScore} /> : "-"}</div></div>
          </div>
          <dl className="divide-y divide-ink-600/40 rounded-lg border border-ink-600/60 text-xs">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-slate-400">{k}</dt>
                <dd className="break-all font-mono text-slate-100">{v}</dd>
              </div>
            ))}
          </dl>
          {receipt.invoiceNote && <Banner tone="warn">{receipt.invoiceNote}</Banner>}
          <div className="flex justify-end"><Button variant="outline" onClick={() => window.print()}>Print</Button></div>
        </div>
      )}
    </Modal>
  );
}

export function EnvInfoModal({ env, onClose }: { env: EnvStatus; onClose: () => void }) {
  const row = (label: string, ok: boolean, detail: string) => (
    <li className="flex items-start justify-between gap-3 rounded-md border border-ink-600/50 bg-ink-800/60 px-3 py-2 text-xs">
      <div>
        <div className="font-medium text-white">{label}</div>
        <div className="text-slate-400">{detail}</div>
      </div>
      <Pill className={ok ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40" : "bg-amber-500/20 text-amber-300 ring-amber-400/40"}>{ok ? "LIVE" : "SIMULATED"}</Pill>
    </li>
  );
  return (
    <Modal title="Integration status" subtitle="Each integration falls back to a built-in simulator when its keys are not configured." onClose={onClose}>
      <ul className="flex flex-col gap-2">
        {row("PayPal Sandbox (Orders v2, Payouts, Invoicing)", env.paypalLive, env.paypalLive ? `Live ${env.paypalEnv} REST calls.` : "Spec-compliant PayPal v2 JSON with simulated latency and deterministic IDs.")}
        {row("OpenAI (Scope Architect and Auditor)", env.openai, env.openai ? "LLM-backed with schema validation." : "Deterministic Demo AI Fallback Engine with streaming analysis.")}
        {row("Channel3 (equipment sourcing)", env.channel3, env.channel3 ? "Live product search." : "Curated fallback catalog.")}
      </ul>
      <p className="mt-3 text-xs text-slate-400">Add keys in a .env file (see .env.example) and restart to switch to live network calls.</p>
    </Modal>
  );
}

interface InspectorProps {
  item: LedgerItem;
  auditLog: AuditLogEntry[];
  busy: boolean;
  onClose: () => void;
  onFund: (item: LedgerItem) => void;
  onAudit: (item: LedgerItem) => void;
  onVoid: (item: LedgerItem) => void;
  onRefund: (item: LedgerItem) => void;
  onReceipt: (item: LedgerItem) => void;
  onRetryPayout: (item: LedgerItem) => void;
}

export function InspectorDrawer({ item, auditLog, busy, onClose, onFund, onAudit, onVoid, onRefund, onReceipt, onRetryPayout }: InspectorProps) {
  const meta = STATUS_META[item.status];
  const age = authAgeDays(item);
  const canVoid = Boolean(item.paypal.authorizationId) && item.capturedAmount === null && ["AUTHORIZED", "REVISION_NEEDED", "SECURITY_FLAGGED"].includes(item.status);
  const canRefund = Boolean(item.paypal.captureId) && ["PAID_OUT", "CAPTURED"].includes(item.status);
  return (
    <Drawer title="Milestone Inspector" onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <div>
          <h3 className="text-base font-semibold text-white">{item.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Pill className={meta.className}>{meta.label}</Pill>
            <Pill className="bg-slate-500/20 text-slate-300 ring-slate-400/30">{item.kind === "SERVICE" ? "SERVICE ESCROW" : "CHANNEL3 PRODUCT"}</Pill>
            <span className="text-lg font-bold tabular-nums text-white">{fmtMoney(item.amount)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">Payee: {item.payee} - {item.startDate} to {item.endDate}</p>
        </div>

        {authNeedsReauth(item) && age !== null && <Banner tone="warn">Authorization is {Math.floor(age)} days old. PayPal authorizations expire after 29 days. Re-authorize to keep funds protected.</Banner>}
        {item.paymentError && <Banner tone="error">{item.paymentError}</Banner>}
        {item.status === "SECURITY_FLAGGED" && <Banner tone="error">Prompt-injection attempt blocked. PayPal Capture and Payout APIs were not called.</Banner>}

        {item.acceptanceCriteria.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Acceptance criteria</h4>
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-300">{item.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        )}

        {item.product && (
          <section className="rounded-lg border border-ink-600/50 bg-ink-800/60 p-3 text-xs">
            <h4 className="mb-1 font-semibold text-white">{item.product.title}</h4>
            <div className="text-slate-400">{item.product.merchant} - {fmtMoney(item.product.price)} (cap {item.maxBudget !== null ? fmtMoney(item.maxBudget) : "n/a"})</div>
            {item.livePriceOverride !== null && <div className="mt-1 text-amber-300">Live price now {fmtMoney(item.livePriceOverride)}</div>}
          </section>
        )}

        {item.lastAudit && (
          <section>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Latest AI audit ({item.lastAudit.engine})</h4>
            <ScoreBar score={item.lastAudit.score} />
            <ul className="mt-2 space-y-1 text-xs text-slate-300">
              {item.lastAudit.criteria.map((c) => (
                <li key={c.criterion} className="rounded bg-ink-800/60 px-2 py-1">
                  <span className={c.pass ? "text-emerald-300" : "text-amber-300"}>{c.score}%</span> {c.criterion}
                  <div className="text-[11px] text-slate-500">{c.evidence}</div>
                </li>
              ))}
            </ul>
            {item.lastAudit.injectionFindings.length > 0 && (
              <pre className="mt-2 overflow-auto rounded bg-red-950/50 p-2 text-[11px] text-red-200">{item.lastAudit.injectionFindings.join("\n")}</pre>
            )}
          </section>
        )}

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">PayPal references</h4>
          <dl className="space-y-1 font-mono text-[11px] text-slate-300">
            {([["Order", item.paypal.orderId], ["Authorization", item.paypal.authorizationId], ["Capture", item.paypal.captureId], ["Payout batch", item.paypal.payoutBatchId], ["Invoice", item.paypal.invoiceId]] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="break-all">{v ?? "-"}</dd></div>
            ))}
            {item.authorizedAt && <div className="flex justify-between gap-3"><dt className="text-slate-500">Authorized</dt><dd>{fmtDateTime(item.authorizedAt)}</dd></div>}
          </dl>
        </section>

        <div className="flex flex-wrap gap-2">
          {["PENDING_FUNDING", "DRAFT", "READY_TO_ORDER"].includes(item.status) && (item.kind === "SERVICE" || item.product) && <Button size="sm" onClick={() => onFund(item)} loading={busy}>Fund Escrow</Button>}
          {authNeedsReauth(item) && <Button size="sm" variant="warn" onClick={() => onFund(item)} loading={busy}>Re-Authorize via PayPal</Button>}
          {item.kind === "SERVICE" && ["AUTHORIZED", "REVISION_NEEDED", "SECURITY_FLAGGED"].includes(item.status) && <Button size="sm" variant="success" onClick={() => onAudit(item)}>Run AI Audit</Button>}
          {item.status === "CAPTURED" && item.paymentError && <Button size="sm" variant="warn" onClick={() => onRetryPayout(item)} loading={busy}>Retry Payout (idempotent)</Button>}
          {canVoid && <Button size="sm" variant="danger" onClick={() => onVoid(item)} loading={busy}>Void Authorization</Button>}
          {canRefund && <Button size="sm" variant="outline" onClick={() => onRefund(item)} loading={busy}>Refund</Button>}
          {["PAID_OUT", "CAPTURED", "REFUNDED"].includes(item.status) && <Button size="sm" variant="outline" onClick={() => onReceipt(item)}>View Receipt</Button>}
        </div>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Audit trail</h4>
          <AuditTrail entries={auditLog.filter((e) => e.itemId === item.id)} />
        </section>
      </div>
    </Drawer>
  );
}
