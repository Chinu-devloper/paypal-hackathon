"use client";

import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Card, Pill } from "./ui";
import { fmtDateTime } from "@/client/helpers";
import type { ApiTelemetryEntry, AuditLogEntry } from "@/shared/types";
import { cn } from "@/shared/cn";

const WEBHOOK_EVENTS: Record<string, string> = {
  "orders.create": "CHECKOUT.ORDER.CREATED",
  "orders.authorize": "PAYMENT.AUTHORIZATION.CREATED",
  "authorizations.capture": "PAYMENT.CAPTURE.COMPLETED",
  "authorizations.void": "PAYMENT.AUTHORIZATION.VOIDED",
  "captures.refund": "PAYMENT.CAPTURE.REFUNDED",
  "payouts.create": "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "invoicing.createDraft": "INVOICING.INVOICE.CREATED",
};

function CallRow({ call }: { call: ApiTelemetryEntry }) {
  const [open, setOpen] = useState(false);
  const ok = call.status >= 200 && call.status < 300;
  return (
    <div className="rounded-lg border border-ink-600/50 bg-ink-900/60">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <Pill className={ok ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40" : "bg-red-500/20 text-red-300 ring-red-400/40"}>{call.status || "ERR"}</Pill>
        <span className="font-mono font-semibold text-sky-300">{call.method}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-slate-300">{call.url.replace("https://api-m.sandbox.paypal.com", "")}</span>
        <Pill className={call.source === "official-sdk" ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40" : call.simulated ? "bg-slate-500/20 text-slate-300 ring-slate-400/30" : "bg-sky-500/20 text-sky-300 ring-sky-400/40"}>
          {call.source === "official-sdk" ? "PAYPAL SERVER SDK" : call.simulated ? "SIMULATED" : "LIVE SANDBOX (REST)"}
        </Pill>
        <span className="text-slate-500">{call.latencyMs}ms</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-ink-600/40 p-3 text-[11px]">
          <div className="flex flex-wrap gap-2 text-slate-400">
            <span>SDK: <b className="text-slate-200">paypalSdk.{call.operation}()</b></span>
            {WEBHOOK_EVENTS[call.operation] && <span>Webhook event: <b className="text-amber-300">{WEBHOOK_EVENTS[call.operation]}</b></span>}
            <span>{fmtDateTime(call.ts)}</span>
          </div>
          {call.requestId && (
            <div className="rounded bg-ink-800 px-2 py-1 font-mono">
              <span className="text-slate-500">PayPal-Request-Id: </span>
              <span className="break-all text-emerald-300">{call.requestId}</span>
            </div>
          )}
          <div className="grid gap-2 lg:grid-cols-2">
            <div>
              <div className="mb-1 font-semibold uppercase tracking-wider text-slate-500">Request</div>
              <pre className="max-h-64 overflow-auto rounded bg-ink-950/60 p-2 font-mono text-slate-300">{JSON.stringify({ headers: call.requestHeaders, body: call.requestBody }, null, 2)}</pre>
            </div>
            <div>
              <div className="mb-1 font-semibold uppercase tracking-wider text-slate-500">Response</div>
              <pre className="max-h-64 overflow-auto rounded bg-ink-950/60 p-2 font-mono text-slate-300">{JSON.stringify(call.responseBody, null, 2) ?? "(empty body)"}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function TelemetryPanel({ calls }: { calls: ApiTelemetryEntry[] }) {
  if (calls.length === 0) {
    return <p className="text-sm text-slate-400">No PayPal API calls yet. Fund a milestone or run an AI audit to see requests and responses here.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {calls.map((c) => <CallRow key={c.id} call={c} />)}
    </div>
  );
}

export function AuditTrail({ entries }: { entries: AuditLogEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-slate-400">Audit trail is empty.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map((e) => (
        <li
          key={e.id}
          className={cn(
            "rounded-md border px-3 py-1.5 text-xs",
            e.level === "ALERT" && "border-red-500/50 bg-red-500/10 text-red-100",
            e.level === "WARN" && "border-amber-500/40 bg-amber-500/10 text-amber-100",
            e.level === "INFO" && "border-ink-600/40 bg-ink-900/50 text-slate-300",
          )}
        >
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            {e.level === "ALERT" && <ShieldAlert className="h-3 w-3 text-red-400" aria-hidden />}
            <b>{e.kind}</b>
            <span>{fmtDateTime(e.ts)}</span>
          </div>
          <div>{e.message}</div>
        </li>
      ))}
    </ul>
  );
}

export function TelemetryTab({ calls, auditLog }: { calls: ApiTelemetryEntry[]; auditLog: AuditLogEntry[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
      <Card className="p-4">
        <h3 className="mb-1 text-sm font-semibold text-white">APIMatic SDK - PayPal REST Inspector</h3>
        <p className="mb-3 text-xs text-slate-400">Every call goes through the typed SDK layer. Webhook events show what PayPal would emit for each call.</p>
        <TelemetryPanel calls={calls} />
      </Card>
      <Card className="p-4">
        <h3 className="mb-1 text-sm font-semibold text-white">Security & Audit Trail</h3>
        <p className="mb-3 text-xs text-slate-400">Immutable log of money movements, guardrail blocks and security alerts.</p>
        <AuditTrail entries={auditLog} />
      </Card>
    </div>
  );
}
