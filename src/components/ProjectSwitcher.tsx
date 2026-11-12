"use client";

import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/cn";
import type { Project } from "@/shared/types";

interface Props {
  readonly projects: readonly Project[];
  readonly value: string | null;
  readonly onSelect: (id: string) => void;
  readonly onNew: () => void;
}

const label = (p: Project) => (p.scenarioKey ? `Scenario ${p.scenarioKey.replace("scn", "")}: ${p.title}` : p.title);

export function ProjectSwitcher({ projects, value, onSelect, onNew }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = projects.find((p) => p.id === value);
  const samples = projects.filter((p) => p.scenarioKey);
  const mine = projects.filter((p) => !p.scenarioKey);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    panel.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      root.current?.querySelector<HTMLElement>("button")?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = Array.from(panel.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length;
    rows[next]?.focus();
  };

  const row = (p: Project) => {
    const active = p.id === value;
    return (
      <button
        key={p.id}
        type="button"
        role="option"
        data-row
        aria-selected={active}
        onClick={() => {
          setOpen(false);
          if (!active) onSelect(p.id);
        }}
        className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus:outline-none", active ? "bg-pp-sky/15 text-white" : "text-slate-200 hover:bg-white/[0.07] focus:bg-white/[0.07]")}
      >
        <span className="min-w-0 flex-1 truncate" title={label(p)}>{p.scenarioKey ? p.title : label(p)}</span>
        {p.scenarioKey && <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">S{p.scenarioKey.replace("scn", "")}</span>}
        {active && <Check className="h-4 w-4 shrink-0 text-pp-sky" aria-hidden />}
      </button>
    );
  };

  const heading = (text: string) => <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{text}</div>;

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex w-[230px] items-center gap-2 rounded-lg border bg-ink-950/50 px-3 py-2 text-left text-sm text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-pp-sky/40", open ? "border-pp-sky" : "border-white/10 hover:border-white/25")}
      >
        <span className="min-w-0 flex-1 truncate">{current ? label(current) : "Select a project"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div ref={panel} role="listbox" aria-label="Project" className="absolute right-0 top-full z-50 mt-2 w-[min(380px,90vw)] animate-scale-in rounded-xl border border-white/10 bg-ink-900/95 p-1.5 backdrop-blur-xl [box-shadow:var(--pop-shadow)]">
          <div className="max-h-[320px] overflow-y-auto">
            {mine.length > 0 && <>{heading("Your projects")}{mine.map(row)}</>}
            {samples.length > 0 && <>{heading("Sample scenarios")}{samples.map(row)}</>}
            {projects.length === 0 && <p className="px-2.5 py-3 text-xs text-slate-400">No projects yet.</p>}
          </div>
          <div className="mt-1 border-t border-white/10 pt-1">
            <button
              type="button"
              data-row
              onClick={() => {
                setOpen(false);
                onNew();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-pp-sky transition-colors hover:bg-white/[0.07] focus:bg-white/[0.07] focus:outline-none"
            >
              <Sparkles className="h-4 w-4" aria-hidden /> New project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
