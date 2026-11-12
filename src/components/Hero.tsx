"use client";

import { ArrowRight, BadgeCheck, Lock, Send, Sparkles } from "lucide-react";
import { Button } from "./ui";
import { fmtMoney } from "@/client/helpers";
import { useCountUp } from "./motion";

const STEPS = [
  { icon: Lock, title: "Fund", text: "Client funds are authorized and held in PayPal escrow." },
  { icon: BadgeCheck, title: "Verify", text: "AI audits the deliverable against the acceptance criteria." },
  { icon: Send, title: "Release", text: "Only a passing audit captures funds and triggers the payout." },
];

export function Hero({ held, released, onOpenWorkspace, onNewProject }: { held: number; released: number; onOpenWorkspace: () => void; onNewProject: () => void }) {
  const heldShown = useCountUp(held);
  const releasedShown = useCountUp(released);

  return (
    <div className="grid items-center gap-10 py-10 lg:min-h-[calc(100vh-9rem)] lg:grid-cols-[1.1fr_0.9fr] lg:py-6">
      <div className="animate-fade-up">
        <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
          Pay for proof,
          <br />
          <span className="text-gradient animate-gradient-x">not promises.</span>
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-400">
          Break any project into milestones, hold the money in escrow, and let the AI auditor release each payment only when the work passes.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button size="md" className="px-5" onClick={onOpenWorkspace}>
            Open workspace <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="md" className="px-5" onClick={onNewProject}>
            <Sparkles className="h-4 w-4" /> New project
          </Button>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-md animate-fade-up [animation-delay:150ms]">
        <div className="absolute left-[27px] top-10 h-[calc(100%-5rem)] w-px bg-gradient-to-b from-sky-400/60 via-violet-400/40 to-emerald-400/60" aria-hidden />
        <ol className="relative space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="animate-float" style={{ animationDelay: `${i * -2}s` }}>
              <div className="glass flex items-start gap-4 rounded-2xl p-4 transition duration-300 hover:-translate-y-0.5 hover:border-sky-400/40">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pp-blue to-pp-sky text-[#fff] shadow-lg shadow-sky-500/30">
                  <s.icon className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">
                    <span className="mr-1.5 text-slate-500">0{i + 1}</span>
                    {s.title}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{s.text}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="glass mt-4 grid grid-cols-2 divide-x divide-white/10 rounded-2xl p-4 text-center">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">In escrow</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-sky-300">{fmtMoney(heldShown)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Released</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-300">{fmtMoney(releasedShown)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
