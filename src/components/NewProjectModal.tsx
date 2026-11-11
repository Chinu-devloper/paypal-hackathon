"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Modal } from "./ui";
import { api, ApiError } from "@/client/helpers";
import { EMAIL_RE } from "@/shared/cn";
import type { LedgerItem, Project } from "@/shared/types";

const EXAMPLES = [
  { label: "SaaS pricing page", text: "Hire a frontend engineer to build a responsive SaaS pricing page with dark mode, a monthly/annual toggle, and 3 pricing tiers for $950, plus $250 equipment stipend for a 4K test monitor.", budget: 1200 },
  { label: "Creator video ads", text: "Commission a creator to write scripts and film 2 product showcase videos for our smart coffee mug ($650), plus source a portable LED ring light and wireless lapel mic ($200).", budget: 850 },
  { label: "Security audit", text: "Audit our payment router module, provide a vulnerability report with severity ratings, and supply unit tests.", budget: 2000 },
];

interface Props {
  onClose: () => void;
  onCreated: (project: Project, items: LedgerItem[], note: string | null, engine: string) => void;
}

export function NewProjectModal({ onClose, onCreated }: Props) {
  const [prompt, setPrompt] = useState("");
  const [budget, setBudget] = useState("");
  const [client, setClient] = useState("sb-client@business.example.com");
  const [freelancer, setFreelancer] = useState("sb-freelancer@personal.example.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const budgetNum = budget.trim() === "" ? null : Number(budget);
  const budgetInvalid = budgetNum !== null && (!Number.isFinite(budgetNum) || budgetNum < 20 || budgetNum > 250000);
  const valid = prompt.trim().length >= 15 && !budgetInvalid && EMAIL_RE.test(client) && EMAIL_RE.test(freelancer);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ project: Project; items: LedgerItem[]; engine: string; note: string | null }>("/api/projects", {
        body: { prompt: prompt.trim(), totalBudget: budgetNum, clientEmail: client.trim(), freelancerEmail: freelancer.trim() },
      });
      onCreated(res.project, res.items, res.note, res.engine);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate the project scope");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-pp-blue focus:outline-none";

  return (
    <Modal title="AI Scope Architect" subtitle="Describe the project. The AI turns it into milestones, acceptance criteria, a schedule and sourced equipment." onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex.label} onClick={() => { setPrompt(ex.text); setBudget(String(ex.budget)); }} className="rounded-full border border-ink-600 px-3 py-1 text-xs text-slate-300 hover:border-pp-blue hover:text-white">
              {ex.label}
            </button>
          ))}
        </div>
        <label className="text-xs font-medium text-slate-300">
          Project brief
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={4000} placeholder="e.g. Hire a designer to create a brand kit for $800, plus $150 for a graphics tablet." className={`${field} mt-1`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-slate-300">
            Total budget (USD, optional)
            <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="infer from brief" className={`${field} mt-1`} />
          </label>
          <label className="text-xs font-medium text-slate-300">
            Client PayPal email
            <input value={client} onChange={(e) => setClient(e.target.value)} type="email" className={`${field} mt-1`} />
          </label>
          <label className="text-xs font-medium text-slate-300">
            Freelancer sandbox email
            <input value={freelancer} onChange={(e) => setFreelancer(e.target.value)} type="email" className={`${field} mt-1`} />
          </label>
        </div>
        {budgetInvalid && <Banner tone="warn">Budget must be between $20 and $250,000.</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!valid} loading={busy}>
            <Sparkles className="h-4 w-4" /> {busy ? "Architecting..." : "Generate Milestones & Procurement"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
