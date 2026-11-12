"use client";

import { Brain, Check, ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { Card, Pill } from "./ui";
import { cn } from "@/shared/cn";
import type { ScopeInsight } from "@/shared/types";

/** Shows how the Scope Architect read the brief, so the client can see nothing they asked for was dropped. */
export function ScopeInsightCard({ insight }: { insight: ScopeInsight }) {
  const [open, setOpen] = useState(false);
  const ai = insight.engine === "openai";
  const uncovered = insight.requirements.filter((r) => r.milestones.length === 0).length;

  return (
    <Card className="p-5">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", ai ? "bg-violet-500/15 text-violet-300 ring-violet-400/40" : "bg-slate-500/15 text-slate-300 ring-slate-400/30")}>
          <Brain className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
            How the AI planned this project
            <Pill className={ai ? "bg-violet-500/15 text-violet-300 ring-violet-400/40" : "bg-slate-500/15 text-slate-300 ring-slate-400/30"}>{ai ? "AI MODEL" : "TEMPLATE PLANNER"}</Pill>
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-400">{insight.summary}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="mt-4 grid animate-fade-up gap-5 lg:grid-cols-[1.4fr_1fr]">
          <section aria-label="Requirements and the milestones that deliver them">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">What you asked for, and where it is delivered</h3>
            {insight.requirements.length === 0 ? (
              <p className="text-xs text-slate-400">The template planner does not itemize requirements.</p>
            ) : (
              <ul className="space-y-2">
                {insight.requirements.map((r) => (
                  <li key={r.text} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-slate-200">
                      <span className="font-medium">{r.text}</span>
                      {r.implied && <Pill className="bg-sky-500/15 text-sky-300 ring-sky-400/40">ADDED BY AI: NEEDED FOR IT TO WORK</Pill>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.milestones.length === 0 ? (
                        <span className="text-amber-300">Not assigned to a milestone</span>
                      ) : (
                        r.milestones.map((m) => (
                          <span key={m} className="rounded-md bg-pp-blue/15 px-2 py-0.5 text-[11px] text-sky-300 ring-1 ring-inset ring-pp-blue/30">{m}</span>
                        ))
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Plan checks">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Checks the plan passed</h3>
            {insight.checks.length > 0 ? (
              <ul className="space-y-1.5">
                {insight.checks.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-xs leading-snug text-slate-200">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden /> {c}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">No automated plan review ran.</p>
            )}
            {uncovered > 0 && <p className="mt-2 text-xs text-amber-300">{uncovered} requirement(s) are not assigned to a milestone.</p>}
            {insight.note && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-snug text-amber-200">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {insight.note}
              </p>
            )}
          </section>
        </div>
      )}
    </Card>
  );
}
