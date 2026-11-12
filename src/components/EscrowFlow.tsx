"use client";

import { ArrowRight, BadgeCheck, Check, Lock, Send, ShieldAlert, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Button, Card } from "./ui";
import { cn } from "@/shared/cn";
import type { LedgerItem } from "@/shared/types";

const RELEASED = ["CAPTURED", "PAID_OUT", "REFUNDED"];
const AUDITABLE = ["AUTHORIZED", "AI_AUDITING", "REVISION_NEEDED", "SECURITY_FLAGGED"];

interface Props {
  items: LedgerItem[];
  onFund: (item: LedgerItem) => void;
  onAudit: (item: LedgerItem) => void;
  onChooseProduct: (item: LedgerItem) => void;
  onPurchase: (item: LedgerItem) => void;
}

interface Next {
  label: string;
  cta: string;
  run: () => void;
}

const STEPS = [
  { key: "plan", icon: Sparkles, title: "Plan", text: "AI Scope Architect splits the brief into milestones with acceptance criteria; Channel3 sources any equipment." },
  { key: "fund", icon: Lock, title: "1. Fund", text: "The client authorizes each milestone in PayPal. Money is held, not captured." },
  { key: "verify", icon: BadgeCheck, title: "2. Verify", text: "The freelancer submits work and the AI auditor scores it against the criteria." },
  { key: "release", icon: Send, title: "3. Release", text: "A score of 80 or more captures the funds and pays the freelancer automatically." },
] as const;

export function EscrowFlow({ items, onFund, onAudit, onChooseProduct, onPurchase }: Props) {
  const live = useMemo(() => items.filter((i) => i.status !== "VOIDED"), [items]);
  const total = live.length;

  const counts = useMemo(
    () => ({
      plan: total,
      fund: live.filter((i) => i.paypal.authorizationId || RELEASED.includes(i.status)).length,
      verify: live.filter((i) => i.lastAudit !== null || RELEASED.includes(i.status)).length,
      release: live.filter((i) => RELEASED.includes(i.status)).length,
    }),
    [live, total],
  );
  const blocked = live.filter((i) => i.status === "REVISION_NEEDED" || i.status === "SECURITY_FLAGGED").length;

  const next = useMemo<Next | null>(() => {
    for (const i of live) {
      if (RELEASED.includes(i.status)) continue;
      if (i.kind === "SERVICE") {
        if (AUDITABLE.includes(i.status) && i.paypal.authorizationId) return { label: `Submit work for "${i.title}"`, cta: "Run AI audit", run: () => onAudit(i) };
        if (i.status === "DRAFT" || i.status === "PENDING_FUNDING") return { label: `Hold funds for "${i.title}"`, cta: "Fund escrow", run: () => onFund(i) };
      } else {
        if (i.status === "DRAFT") return { label: `Pick a product for "${i.title}"`, cta: "Choose product", run: () => onChooseProduct(i) };
        if (i.status === "READY_TO_ORDER") return { label: `Hold funds for "${i.title}"`, cta: "Fund escrow", run: () => onFund(i) };
        if (i.status === "AUTHORIZED") return { label: `Buy "${i.title}"`, cta: "Confirm purchase", run: () => onPurchase(i) };
      }
    }
    return null;
  }, [live, onAudit, onFund, onChooseProduct, onPurchase]);

  if (total === 0) return null;

  const firstOpen = STEPS.findIndex((s) => counts[s.key] < total);

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">How the money moves</h2>
          <p className="text-xs text-slate-400">Live progress of this project through the escrow flow.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {next ? (
            <>
              <span className="text-xs text-slate-300">
                <span className="mr-1.5 text-slate-500">Next up</span>
                {next.label}
              </span>
              <Button size="sm" onClick={next.run}>
                {next.cta} <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Check className="h-4 w-4" aria-hidden /> Every milestone is settled
            </span>
          )}
        </div>
      </div>

      <ol className="grid gap-3 md:grid-cols-4">
        {STEPS.map((s, idx) => {
          const done = counts[s.key];
          const complete = done === total;
          const active = idx === firstOpen;
          const pct = Math.round((done / total) * 100);
          return (
            <li
              key={s.key}
              aria-current={active ? "step" : undefined}
              className={cn(
                "relative rounded-xl border p-4 transition duration-300",
                complete ? "border-emerald-500/30 bg-emerald-500/[0.06]" : active ? "border-pp-sky/50 bg-pp-sky/[0.07] shadow-[0_0_0_3px_rgb(0_156_222/0.08)]" : "border-white/10 bg-white/[0.02]",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                    complete ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40" : active ? "bg-pp-sky/20 text-sky-300 ring-sky-400/40" : "bg-white/5 text-slate-400 ring-white/10",
                  )}
                >
                  {complete ? <Check className="h-4 w-4" aria-hidden /> : <s.icon className="h-4 w-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white">{s.title}</div>
                  <div className="text-[11px] tabular-nums text-slate-400">{done} of {total} milestones</div>
                </div>
                {idx < STEPS.length - 1 && <ArrowRight className="hidden h-4 w-4 shrink-0 text-slate-600 md:block" aria-hidden />}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">{s.text}</p>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${s.title} progress`}>
                <div className={cn("h-full rounded-full transition-all duration-700 ease-out", complete ? "bg-emerald-500" : "bg-pp-sky")} style={{ width: `${pct}%` }} />
              </div>
              {s.key === "verify" && blocked > 0 && (
                <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> {blocked} blocked: funds stay locked until the work passes
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
