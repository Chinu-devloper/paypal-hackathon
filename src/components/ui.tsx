"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/cn";

type Variant = "primary" | "success" | "ghost" | "danger" | "warn" | "outline";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-gradient-to-b from-[#0a85cf] to-[#0070ba] text-[#fff] shadow-sm ring-1 ring-inset ring-black/10 hover:brightness-110",
  success: "bg-gradient-to-b from-[#12a37c] to-[#0c8a67] text-[#fff] shadow-sm ring-1 ring-inset ring-black/10 hover:brightness-110",
  warn: "bg-gradient-to-b from-[#fbbf24] to-[#f5a70b] text-[#1f1300] shadow-sm ring-1 ring-inset ring-black/10 hover:brightness-105",
  danger: "bg-gradient-to-b from-[#ef4444] to-[#d93636] text-[#fff] shadow-sm ring-1 ring-inset ring-black/10 hover:brightness-110",
  ghost: "bg-transparent text-slate-300 hover:bg-white/10 hover:text-white",
  outline: "border border-ink-600 bg-ink-800/70 text-slate-200 shadow-sm hover:border-pp-sky/50 hover:bg-ink-700 hover:text-white",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "xs" | "sm" | "md";
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition duration-200 hover:-translate-y-px active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-pp-sky disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
        size === "xs" && "px-2 py-1 text-[11px]",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      className={cn(
        "spotlight relative isolate rounded-2xl border border-white/[0.08] bg-ink-800/60 [box-shadow:var(--card-shadow)] backdrop-blur-xl transition-colors duration-300 hover:border-sky-400/25",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ring-inset", className)}>
      {children}
    </span>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn("my-6 w-full animate-scale-in rounded-2xl border border-white/10 bg-ink-900/95 [box-shadow:var(--pop-shadow)]", wide ? "max-w-6xl" : "max-w-2xl")}>
        <div className="flex items-start justify-between gap-4 border-b border-ink-600/60 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, width = "max-w-xl" }: { title: string; onClose: () => void; children: ReactNode; width?: string }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-40 flex animate-fade-in justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside
        className={cn("h-full w-full animate-slide-in-right overflow-y-auto border-l border-white/10 bg-ink-900/95 shadow-2xl", width)}
        onClick={(e) => e.stopPropagation()}
        role="complementary"
        aria-label={title}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-600/60 bg-ink-900/95 px-5 py-3 backdrop-blur">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </aside>
    </div>
  );
}

export function Banner({ tone, children }: { tone: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const tones = {
    info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    error: "border-red-500/40 bg-red-500/10 text-red-200",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  };
  return <div className={cn("rounded-lg border px-3 py-2 text-xs", tones[tone])}>{children}</div>;
}

export function ScoreBar({ score, compact }: { score: number; compact?: boolean }) {
  const tone = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";
  const text = score >= 80 ? "text-emerald-300" : score >= 50 ? "text-amber-300" : "text-red-300";
  return (
    <div className="w-full" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="AI audit score">
      <div className={cn("mb-0.5 font-semibold tabular-nums", text, compact ? "text-[11px]" : "text-xs")}>{score}/100</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className={cn("h-full rounded-full transition-all duration-1000 ease-out", tone)} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </div>
  );
}

export interface Toast {
  id: number;
  tone: "success" | "error" | "info" | "warn";
  text: string;
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex animate-slide-in-right items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur-md",
            t.tone === "success" && "border-emerald-500/40 bg-emerald-950 text-emerald-100",
            t.tone === "error" && "border-red-500/40 bg-red-950 text-red-100",
            t.tone === "warn" && "border-amber-500/40 bg-amber-950 text-amber-100",
            t.tone === "info" && "border-sky-500/40 bg-sky-950 text-sky-100",
          )}
        >
          <span>{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
