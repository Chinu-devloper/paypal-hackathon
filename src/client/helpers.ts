import { APPROVAL_THRESHOLD, AUTH_WARNING_DAYS, type ItemStatus, type LedgerItem } from "../shared/types";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("NETWORK", "Network error: could not reach the server", 0);
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? `Request failed (${res.status})`, res.status, data?.error?.details ?? null);
  }
  return data as T;
}

export const fmtMoney = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export interface StatusMeta {
  label: string;
  className: string;
}

export const STATUS_META: Record<ItemStatus, StatusMeta> = {
  DRAFT: { label: "DRAFT", className: "bg-slate-500/20 text-slate-300 ring-slate-400/30" },
  PENDING_FUNDING: { label: "PENDING FUNDING", className: "bg-slate-500/20 text-slate-200 ring-slate-400/30" },
  READY_TO_ORDER: { label: "READY TO ORDER", className: "bg-sky-500/20 text-sky-300 ring-sky-400/30" },
  AUTHORIZED: { label: "AUTHORIZED (HELD)", className: "bg-blue-500/20 text-blue-300 ring-blue-400/40" },
  AI_AUDITING: { label: "AI AUDITING", className: "bg-violet-500/20 text-violet-300 ring-violet-400/40 animate-pulse" },
  REVISION_NEEDED: { label: "REVISION NEEDED", className: "bg-amber-500/20 text-amber-300 ring-amber-400/40" },
  SECURITY_FLAGGED: { label: "SECURITY FLAGGED", className: "bg-red-500/20 text-red-300 ring-red-400/50" },
  CAPTURED: { label: "VERIFIED & CAPTURED", className: "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40" },
  PAID_OUT: { label: "PAID OUT", className: "bg-emerald-500/25 text-emerald-200 ring-emerald-400/50" },
  REFUNDED: { label: "REFUNDED", className: "bg-fuchsia-500/20 text-fuchsia-300 ring-fuchsia-400/40" },
  VOIDED: { label: "VOIDED", className: "bg-slate-600/30 text-slate-300 ring-slate-400/30" },
};

const HELD: ItemStatus[] = ["AUTHORIZED", "AI_AUDITING", "REVISION_NEEDED", "SECURITY_FLAGGED"];
const RELEASED: ItemStatus[] = ["CAPTURED", "PAID_OUT"];

export function isHeld(item: LedgerItem): boolean {
  return HELD.includes(item.status) && Boolean(item.paypal.authorizationId);
}

export function authAgeDays(item: LedgerItem): number | null {
  return item.authorizedAt ? (Date.now() - new Date(item.authorizedAt).getTime()) / 86_400_000 : null;
}

export function authNeedsReauth(item: LedgerItem): boolean {
  const age = authAgeDays(item);
  return item.status === "AUTHORIZED" && age !== null && age > AUTH_WARNING_DAYS;
}

export interface Kpis {
  contractValue: number;
  held: number;
  released: number;
  protectedValue: number;
  blockedCount: number;
}

export function computeKpis(items: LedgerItem[]): Kpis {
  let contractValue = 0;
  let held = 0;
  let released = 0;
  let protectedValue = 0;
  let blockedCount = 0;
  for (const it of items) {
    if (!["VOIDED"].includes(it.status)) contractValue += it.amount;
    if (isHeld(it)) held += it.amount;
    if (RELEASED.includes(it.status)) released += it.capturedAmount ?? it.amount;
    if (it.status === "REVISION_NEEDED" || it.status === "SECURITY_FLAGGED") {
      protectedValue += it.amount;
      blockedCount += 1;
    }
    if (RELEASED.includes(it.status) && (it.releasedToClient ?? 0) > 0) protectedValue += it.releasedToClient ?? 0;
  }
  return { contractValue, held, released, protectedValue, blockedCount };
}

export function scoreTone(score: number): string {
  return score >= APPROVAL_THRESHOLD ? "emerald" : score >= 50 ? "amber" : "red";
}

export function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}
