"use client";

import { CheckCircle2, FileCode2, ShieldAlert, Terminal, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, Button, Modal, Pill, ScoreBar } from "./ui";
import { api, ApiError, fmtMoney } from "@/client/helpers";
import { buildSampleSubmissions } from "@/shared/samples";
import { APPROVAL_THRESHOLD, type AuditRecord, type LedgerItem } from "@/shared/types";
import { cn } from "@/shared/cn";

export type SampleKind = "passing" | "failing" | "partial" | "injection";

interface TermLine {
  id: number;
  text: string;
}

interface Props {
  item: LedgerItem;
  demoMode: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function lineClass(text: string): string {
  if (text.startsWith("[SUCCESS]")) return "font-semibold text-emerald-300";
  if (text.startsWith("[VERDICT]")) return text.includes("APPROVED FOR") ? "font-semibold text-emerald-300" : "font-semibold text-amber-300";
  if (text.startsWith("[SECURITY]") || text.startsWith("[ESCROW LOCK]") || text.startsWith("[ERROR]")) return "font-semibold text-red-300";
  if (text.startsWith("[SECURITY SCANNER] MATCH")) return "text-red-300";
  if (text.startsWith("[SECURITY SCANNER]")) return "text-cyan-300";
  if (text.startsWith("[CRITERION")) return text.includes(": PASS") ? "text-emerald-300" : "text-amber-300";
  if (text.startsWith("[APIMATIC SDK]")) return "text-sky-300";
  if (text.startsWith("[REVISION")) return "text-amber-200";
  if (text.startsWith("[SETTLEMENT]") || text.startsWith("[PAYPAL]")) return "text-violet-300";
  if (text.startsWith("[IDEMPOTENCY]")) return "text-fuchsia-300";
  return "text-slate-300";
}

export function AuditorModal({ item: initialItem, demoMode, onClose, onChanged }: Readonly<Props>) {
  const samples = useMemo(() => buildSampleSubmissions(initialItem.acceptanceCriteria), [initialItem.acceptanceCriteria]);
  const [item, setItem] = useState(initialItem);
  const [submission, setSubmission] = useState("");
  const [loadingSample, setLoadingSample] = useState(false);
  const [lines, setLines] = useState<TermLine[]>([]);
  const [running, setRunning] = useState(false);
  const [record, setRecord] = useState<AuditRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const lineId = useRef(0);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [lines]);

  const push = (text: string) => setLines((prev) => [...prev, { id: lineId.current++, text }]);

  async function loadSample(kind: SampleKind) {
    if (kind === "failing" || kind === "injection") return setSubmission(samples[kind]);
    setLoadingSample(true);
    try {
      const res = await api<{ submission: string }>("/api/samples", { body: { itemId: initialItem.id, kind } });
      setSubmission(res.submission);
    } catch {
      setSubmission(samples[kind]);
    } finally {
      setLoadingSample(false);
    }
  }

  async function run() {
    setRunning(true);
    setError(null);
    setRecord(null);
    setLines([]);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, submission }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? `Audit request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim()) continue;
          const event = JSON.parse(part) as
            | { type: "log"; line: string }
            | { type: "result"; item: LedgerItem; record: AuditRecord; released: boolean; error: { message: string } | null }
            | { type: "error"; error: { code: string; message: string } };
          if (event.type === "log") push(event.line);
          else if (event.type === "result") {
            setItem(event.item);
            setRecord(event.record);
            if (event.error) setError(event.error.message);
          } else {
            setError(event.error.message);
            push(`[ERROR] ${event.error.code}: ${event.error.message}`);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit failed");
    } finally {
      setRunning(false);
      onChanged();
    }
  }

  async function decide(party: "client" | "freelancer", accept: boolean) {
    setSettling(true);
    try {
      const res = await api<{ item: LedgerItem; released: boolean; logs: string[] }>(`/api/items/${item.id}/settlement`, { body: { party, accept } });
      res.logs.forEach(push);
      setItem(res.item);
      if (res.released) push(`[SUCCESS] Settlement released. Capture ${res.item.paypal.captureId} | Payout ${res.item.paypal.payoutBatchId}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Settlement failed");
    } finally {
      setSettling(false);
    }
  }

  const offer = record?.settlementOffer ?? null;
  const settlementOpen = Boolean(offer) && item.status === "REVISION_NEEDED";
  const finished = item.status === "PAID_OUT" || item.status === "CAPTURED";
  const locked = finished || item.status === "VOIDED" || item.status === "REFUNDED";

  return (
    <Modal wide title="AI Deliverable Auditor & Security" subtitle={`${item.title} - ${fmtMoney(item.amount)} held in PayPal escrow`} onClose={onClose}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Acceptance Criteria (contract)</h3>
            <ul className="flex flex-col gap-1.5">
              {item.acceptanceCriteria.map((c, i) => {
                const r = record?.criteria[i];
                return (
                  <li key={c} className="flex items-start gap-2 rounded-md border border-ink-600/50 bg-ink-800/60 px-3 py-2 text-xs text-slate-200">
                    {r ? (r.pass ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />) : <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-slate-500" />}
                    <span className="flex-1">{c}</span>
                    {r && <span className={cn("font-semibold tabular-nums", r.pass ? "text-emerald-300" : "text-red-300")}>{r.score}%</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          {demoMode && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Test submissions</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button size="sm" variant="success" disabled={running || locked} loading={loadingSample} onClick={() => void loadSample("passing")}>Load Passing Submission (Complete Code/Deliverable)</Button>
                <Button size="sm" variant="warn" disabled={running || locked} onClick={() => void loadSample("failing")}>Load Failing Submission (Incomplete Deliverable)</Button>
                <Button size="sm" variant="outline" disabled={running || locked} loading={loadingSample} onClick={() => void loadSample("partial")}>Load Partial Submission (Settlement)</Button>
                <Button size="sm" variant="danger" disabled={running || locked} onClick={() => void loadSample("injection")}>
                  <ShieldAlert className="h-3.5 w-3.5" /> Test Prompt Injection Attack
                </Button>
              </div>
            </div>
          )}

          <label className="flex flex-1 flex-col text-xs font-semibold uppercase tracking-wider text-slate-400">
            <span className="mb-2 flex items-center gap-1.5"><FileCode2 className="h-3.5 w-3.5" aria-hidden /> Deliverable (code, text, markdown or URL)</span>
            <textarea
              value={submission}
              onChange={(e) => setSubmission(e.target.value)}
              disabled={running || locked}
              rows={12}
              spellCheck={false}
              placeholder={demoMode ? "Paste the freelancer's deliverable here, or load a test submission above." : "Paste the freelancer's deliverable here (code, text, markdown or a link)."}
              className="min-h-[220px] w-full flex-1 rounded-md border border-ink-600 bg-ink-950/50 p-3 font-mono text-xs normal-case tracking-normal text-slate-200 focus:border-pp-blue focus:outline-none disabled:opacity-60"
            />
          </label>

          <Button onClick={run} loading={running} disabled={submission.trim().length === 0 || locked}>
            Submit Deliverable for AI Escrow Audit
          </Button>
          {locked && <Banner tone="success">This milestone is already settled; no further audits are possible.</Banner>}
        </div>

        <div className="flex min-h-[420px] flex-col gap-3">
          <div className="scope-dark flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink-600 bg-black">
            <div className="flex items-center gap-2 border-b border-ink-600/70 bg-ink-800 px-3 py-1.5 text-[11px] text-slate-400">
              <Terminal className="h-3.5 w-3.5" aria-hidden /> Live Agentic Terminal
              {running && <span className="ml-auto animate-pulse text-violet-300">agent running...</span>}
            </div>
            <div ref={termRef} className="h-80 flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed" aria-live="polite">
              {lines.length === 0 && !running && <p className="text-slate-600">Waiting for a deliverable. The agent will audit it criterion by criterion, then decide whether to call PayPal Capture and Payouts.</p>}
              {lines.map((l) => <div key={l.id} className={lineClass(l.text)}>{l.text}</div>)}
            </div>
          </div>

          {error && <Banner tone="error">{error}</Banner>}

          {record && (
            <div className={cn("rounded-xl border p-4", record.verdict === "APPROVED" ? "border-emerald-500/50 bg-emerald-500/10" : record.verdict === "SECURITY_FLAGGED" ? "border-red-500/60 bg-red-500/10" : "border-amber-500/50 bg-amber-500/10")}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <Pill className={record.verdict === "APPROVED" ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40" : record.verdict === "SECURITY_FLAGGED" ? "bg-red-500/20 text-red-300 ring-red-400/50" : "bg-amber-500/20 text-amber-300 ring-amber-400/40"}>
                  {record.verdict.replace("_", " ")}
                </Pill>
                <span className="text-[11px] text-slate-400">engine: {record.engine} - threshold {APPROVAL_THRESHOLD}</span>
              </div>
              <ScoreBar score={record.score} />
              {record.revisionChecklist.length > 0 && (
                <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-slate-200">
                  {record.revisionChecklist.map((r) => <li key={r}>{r}</li>)}
                </ol>
              )}
              {finished && <p className="mt-3 text-xs text-emerald-200">Funds released: capture {item.paypal.captureId}, payout batch {item.paypal.payoutBatchId}.</p>}
              {record.verdict === "SECURITY_FLAGGED" && <p className="mt-3 text-xs text-red-200">The adversarial submission was blocked. Escrow stays locked and a security alert was logged.</p>}
            </div>
          )}

          {settlementOpen && offer && (
            <div className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-4 text-xs text-violet-100">
              <div className="mb-1 text-sm font-semibold">Negotiated settlement offer</div>
              <p>
                Pay <b>{fmtMoney(offer.amount)}</b> of {fmtMoney(item.amount)} now (final capture). The remaining <b>{fmtMoney(offer.holdback)}</b> hold is released back to the client. Both parties must accept.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant={item.settlement?.clientAccepted ? "success" : "primary"} loading={settling} disabled={item.settlement?.clientAccepted} onClick={() => decide("client", true)}>
                  {item.settlement?.clientAccepted ? "Client accepted" : "Client accepts"}
                </Button>
                <Button size="sm" variant={item.settlement?.freelancerAccepted ? "success" : "primary"} loading={settling} disabled={item.settlement?.freelancerAccepted} onClick={() => decide("freelancer", true)}>
                  {item.settlement?.freelancerAccepted ? "Freelancer accepted" : "Freelancer accepts"}
                </Button>
                <Button size="sm" variant="ghost" disabled={settling} onClick={() => decide("client", false)}>Decline</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
