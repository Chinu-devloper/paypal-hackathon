"use client";

import { Activity, BadgeDollarSign, CalendarRange, Grid3x3, Lock, RotateCcw, ShieldCheck, ShoppingBag, Sparkles, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuditorModal } from "./AuditorModal";
import { EscrowLedgerGrid } from "./EscrowLedgerGrid";
import { FundingModal } from "./FundingModal";
import { MarketplaceTab } from "./MarketplaceTab";
import { TimelineView } from "./TimelineView";
import { NewProjectModal } from "./NewProjectModal";
import { EnvInfoModal, InspectorDrawer, ReceiptModal } from "./Panels";
import { AuditTrail, TelemetryPanel, TelemetryTab } from "./TelemetryTab";
import { Banner, Button, Card, Drawer, Toasts, type Toast } from "./ui";
import { api, ApiError, computeKpis, fmtMoney } from "@/client/helpers";
import { cn } from "@/shared/cn";
import type { ApiTelemetryEntry, AuditLogEntry, EnvStatus, LedgerItem, Product, Project } from "@/shared/types";

type TabKey = "ledger" | "timeline" | "market" | "inspector";
type Mode = "demo" | "user";

const MODE_STORAGE_KEY = "mos-mode";
const DEFAULT_MODE: Mode = process.env.NEXT_PUBLIC_DEFAULT_MODE === "user" ? "user" : "demo";

// Demo mode names the sponsor tools; end-user mode uses plain product language.
const TABS: Array<{ key: TabKey; demoLabel: string; userLabel: string; icon: typeof Grid3x3 }> = [
  { key: "ledger", demoLabel: "AG Grid Escrow & Procurement Matrix", userLabel: "Escrow Ledger", icon: Grid3x3 },
  { key: "timeline", demoLabel: "Bryntum Project & Payment Timeline", userLabel: "Timeline", icon: CalendarRange },
  { key: "market", demoLabel: "Channel3 Equipment Marketplace", userLabel: "Equipment Marketplace", icon: ShoppingBag },
  { key: "inspector", demoLabel: "APIMatic SDK & Webhook Inspector", userLabel: "Audit Trail", icon: Activity },
];

interface Bundle {
  project: Project;
  items: LedgerItem[];
  auditLog: AuditLogEntry[];
}

export function CommandCenter() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [calls, setCalls] = useState<ApiTelemetryEntry[]>([]);
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("ledger");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [fundId, setFundId] = useState<string | null>(null);
  const [audit, setAudit] = useState<{ id: string } | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showEnv, setShowEnv] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);
  const toastId = useRef(0);

  // Demo tools exist only when the server allows them; otherwise the app is always in end-user mode.
  const demoMode = (env?.demoTools ?? true) && mode === "demo";
  const demoRef = useRef(demoMode);
  demoRef.current = demoMode;

  useEffect(() => {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === "demo" || stored === "user") setMode(stored);
  }, []);

  const changeMode = (next: Mode) => {
    setMode(next);
    window.localStorage.setItem(MODE_STORAGE_KEY, next);
    setSelectedId(null);
    setInspectId(null);
  };

  const toast = useCallback((tone: Toast["tone"], text: string) => {
    const id = toastId.current++;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
  }, []);

  const reload = useCallback(
    async (idOverride?: string) => {
      const id = idOverride ?? projectId;
      try {
        const list = await api<{ projects: Project[] }>("/api/projects");
        setProjects(list.projects);
        const visible = demoRef.current ? list.projects : list.projects.filter((p) => !p.scenarioKey);
        const target = id && visible.some((p) => p.id === id) ? id : visible[0]?.id ?? null;
        setProjectId(target);
        if (target) {
          const [b, t] = await Promise.all([
            api<Bundle>(`/api/projects/${target}`),
            api<{ calls: ApiTelemetryEntry[] }>(`/api/telemetry?projectId=${target}`),
          ]);
          setBundle(b);
          setCalls(t.calls);
        } else {
          setBundle(null);
          setCalls([]);
        }
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setReady(true);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void api<{ env: EnvStatus; paypalClientId: string | null }>("/api/env")
      .then((r) => {
        setEnv(r.env);
        setClientId(r.paypalClientId);
      })
      .catch(() => undefined);
  }, []);

  // Reload whenever the mode (and therefore the visible projects) changes, including the first render.
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  const visibleProjects = useMemo(() => (demoMode ? projects : projects.filter((p) => !p.scenarioKey)), [demoMode, projects]);

  const items = bundle?.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const kpis = useMemo(() => computeKpis(items), [items]);

  const withBusy = useCallback(
    async (id: string, fn: () => Promise<void>) => {
      setBusyIds((s) => new Set(s).add(id));
      try {
        await fn();
      } catch (err) {
        toast("error", err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Action failed");
      } finally {
        setBusyIds((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        await reload();
      }
    },
    [reload, toast],
  );

  const purchaseOrRetry = (item: LedgerItem) =>
    withBusy(item.id, async () => {
      const res = await api<{ deduplicated: boolean; item: LedgerItem }>("/api/paypal/capture-and-payout", { body: { itemId: item.id } });
      toast("success", res.deduplicated ? "Already processed (idempotent): no duplicate payment sent." : item.kind === "PROCUREMENT" ? "Purchase confirmed and funds captured." : "Payout completed.");
    });

  const approveProduct = (item: LedgerItem, product: Product) =>
    withBusy(item.id, async () => {
      await api(`/api/items/${item.id}/approve-product`, { body: { productId: product.id } });
      toast("success", `Approved "${product.title}" at ${fmtMoney(product.price)}. Ready for PayPal checkout.`);
    });

  const resource = (item: LedgerItem, query: string) =>
    withBusy(item.id, async () => {
      const res = await api<{ note: string | null }>(`/api/items/${item.id}/candidates`, { body: { query } });
      if (res.note) toast("info", res.note);
    });

  const editAmount = async (item: LedgerItem, amount: number) => {
    try {
      await api(`/api/items/${item.id}/amount`, { body: { amount } });
      toast("success", `Milestone amount updated to ${fmtMoney(amount)}.`);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Could not update the amount");
    }
    await reload();
  };

  const voidAuth = (item: LedgerItem) => {
    if (!window.confirm(`Void the PayPal authorization for "${item.title}"? The held funds go back to the client.`)) return;
    return withBusy(item.id, async () => {
      await api("/api/paypal/void-or-refund", { body: { itemId: item.id, action: "VOID" } });
      toast("success", "Authorization voided. Funds released back to the client.");
    });
  };

  const refund = (item: LedgerItem) => {
    if (!window.confirm(`Refund the captured payment for "${item.title}"?`)) return;
    return withBusy(item.id, async () => {
      await api("/api/paypal/void-or-refund", { body: { itemId: item.id, action: "REFUND" } });
      toast("success", "Refund issued.");
    });
  };

  const resetDemo = async () => {
    if (!window.confirm("Reset all demo data (custom projects are deleted)?")) return;
    try {
      await api("/api/reset", { method: "POST", body: {} });
      setSelectedId(null);
      setInspectId(null);
      await reload("scn1");
      toast("success", "Demo data reset.");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Reset failed");
    }
  };

  const fundItem = fundId ? byId.get(fundId) : undefined;
  const auditItem = audit ? byId.get(audit.id) : undefined;
  const receiptItem = receiptId ? byId.get(receiptId) : undefined;
  const inspectItem = inspectId ? byId.get(inspectId) : undefined;
  const sandboxLive = env?.paypalLive ?? false;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col gap-4 px-4 pb-10 pt-4">
      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-600/60 bg-ink-800/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-pp-navy to-pp-sky text-white shadow-lg"><ShieldCheck className="h-5 w-5" aria-hidden /></div>
          <div className="leading-tight">
            <div className="text-base font-bold text-white">PayPal MilestoneOS</div>
            <div className="text-[11px] text-slate-400">AI-verified escrow, procurement & autonomous payouts</div>
          </div>
        </div>
        <span className={cn("ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", sandboxLive ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/40" : "bg-amber-500/10 text-amber-300 ring-amber-400/30")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", sandboxLive ? "bg-emerald-400" : "bg-amber-400")} aria-hidden />
          {sandboxLive ? "PayPal Sandbox Connected" : "PayPal Sandbox (Simulated)"}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {env?.demoTools && (
            <div role="group" aria-label="Application mode" className="inline-flex rounded-md border border-ink-600 bg-ink-900 p-0.5 text-xs font-medium">
              {([["demo", "Demo mode"], ["user", "End-user mode"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={(demoMode ? "demo" : "user") === key}
                  onClick={() => changeMode(key)}
                  className={cn("rounded px-3 py-1.5 transition", (demoMode ? "demo" : "user") === key ? "bg-pp-blue text-white" : "text-slate-400 hover:text-white")}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <label className="sr-only" htmlFor="scenario">Project</label>
          <select
            id="scenario"
            value={projectId ?? ""}
            onChange={(e) => {
              if (e.target.value === "__new") return setShowNew(true);
              setSelectedId(null);
              setInspectId(null);
              void reload(e.target.value);
            }}
            className="max-w-[280px] rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-white focus:border-pp-blue focus:outline-none"
          >
            {visibleProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.scenarioKey ? `Scenario ${p.scenarioKey.replace("scn", "")}: ${p.title}` : p.title}</option>
            ))}
            <option value="__new">+ New Project...</option>
          </select>

          {demoMode && <Button variant="outline" size="sm" onClick={() => setShowTelemetry(true)}><Activity className="h-4 w-4" /> APIMatic Live API Telemetry</Button>}
          <Button size="sm" onClick={() => setShowNew(true)}><Sparkles className="h-4 w-4" /> New Project</Button>
          {demoMode && <Button variant="ghost" size="sm" onClick={resetDemo} aria-label="Reset demo data" title="Reset demo data"><RotateCcw className="h-4 w-4" /></Button>}
        </div>
      </header>

      {env?.simulationMode && (
        <Banner tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Sandbox Simulation Mode Active (Add API keys in Settings or .env for Live Network Calls){env.missing.length ? `: ${env.missing.join(", ")}` : ""}</span>
            <button className="underline underline-offset-2 hover:text-white" onClick={() => setShowEnv(true)}>Details</button>
          </div>
        </Banner>
      )}
      {loadError && <Banner tone="error">{loadError}</Banner>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
        <Kpi icon={<BadgeDollarSign className="h-5 w-5" />} label="Total Contract Value" value={fmtMoney(kpis.contractValue)} hint={bundle?.project.title ?? ""} tone="blue" />
        <Kpi icon={<Lock className="h-5 w-5" />} label="Held in PayPal Escrow (Authorized)" value={fmtMoney(kpis.held)} hint="Authorized, not captured" tone="sky" />
        <Kpi icon={<Wallet className="h-5 w-5" />} label="AI-Verified & Released (Captured/Paid)" value={fmtMoney(kpis.released)} hint="Only after audit score >= 80" tone="emerald" />
        <Kpi icon={<ShieldCheck className="h-5 w-5" />} label="Disputes Prevented / Margin Saved" value={fmtMoney(kpis.protectedValue)} hint={`${kpis.blockedCount} release(s) blocked by guardrails`} tone="amber" />
      </section>

      <nav className="flex flex-wrap gap-1 border-b border-ink-600/60" role="tablist" aria-label="Workspace">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn("-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition", tab === t.key ? "border-pp-sky text-white" : "border-transparent text-slate-400 hover:text-slate-200")}
          >
            <t.icon className="h-4 w-4" aria-hidden /> {demoMode ? t.demoLabel : t.userLabel}
          </button>
        ))}
      </nav>

      <main role="tabpanel">
        {!bundle ? (
          ready && !loadError && visibleProjects.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 p-10 text-center">
              <h2 className="text-lg font-semibold text-white">No projects yet</h2>
              <p className="max-w-md text-sm text-slate-400">Describe a project and the AI will break it into milestones with acceptance criteria, then hold your payment in PayPal escrow until the work is verified.</p>
              <Button onClick={() => setShowNew(true)}><Sparkles className="h-4 w-4" /> Create your first project</Button>
            </Card>
          ) : (
            <Card className="p-8 text-center text-sm text-slate-400">{loadError ? "Could not load the project." : "Loading project..."}</Card>
          )
        ) : tab === "ledger" ? (
          <EscrowLedgerGrid
            items={items}
            selectedId={selectedId}
            busyIds={busyIds}
            onSelect={setSelectedId}
            onInspect={(id) => { setSelectedId(id); setInspectId(id); }}
            onFund={(i) => setFundId(i.id)}
            onAudit={(i) => setAudit({ id: i.id })}
            onReceipt={(i) => setReceiptId(i.id)}
            onPurchase={purchaseOrRetry}
            onChooseProduct={() => setTab("market")}
            onAmountEdit={editAmount}
          />
        ) : tab === "timeline" ? (
          <TimelineView items={items} selectedId={selectedId} onSelect={setSelectedId} onInspect={(id) => { setSelectedId(id); setInspectId(id); }} />
        ) : tab === "market" ? (
          <MarketplaceTab items={items} busyIds={busyIds} onApprove={approveProduct} onResource={resource} />
        ) : demoMode ? (
          <TelemetryTab calls={calls} auditLog={bundle.auditLog} />
        ) : (
          <Card className="p-4">
            <h3 className="mb-1 text-sm font-semibold text-white">Audit Trail</h3>
            <p className="mb-3 text-xs text-slate-400">Every payment movement, AI audit decision and security alert for this project.</p>
            <AuditTrail entries={bundle.auditLog} />
          </Card>
        )}
      </main>

      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={(project, _items, note, engine) => {
            setShowNew(false);
            setSelectedId(null);
            toast("success", `AI Scope Architect (${engine}) created "${project.title}".${note ? ` ${note}` : ""}`);
            void reload(project.id);
          }}
        />
      )}

      {fundItem && (
        <FundingModal
          key={`${fundItem.id}:${fundItem.product?.id ?? ""}`}
          item={fundItem}
          clientId={clientId}
          demoMode={demoMode}
          onClose={() => setFundId(null)}
          onFunded={(updated) => {
            setFundId(null);
            toast("success", `$${updated.amount.toFixed(2)} authorized and held in escrow (${updated.paypal.authorizationId}).`);
            void reload();
          }}
          onSwapProduct={approveProduct}
        />
      )}

      {auditItem && audit && (
        <AuditorModal key={audit.id} item={auditItem} demoMode={demoMode} onClose={() => setAudit(null)} onChanged={() => void reload()} />
      )}

      {receiptItem && <ReceiptModal item={receiptItem} onClose={() => setReceiptId(null)} onChanged={() => void reload()} />}

      {inspectItem && bundle && (
        <InspectorDrawer
          item={inspectItem}
          auditLog={bundle.auditLog}
          busy={busyIds.has(inspectItem.id)}
          onClose={() => setInspectId(null)}
          onFund={(i) => { setInspectId(null); setFundId(i.id); }}
          onAudit={(i) => { setInspectId(null); setAudit({ id: i.id }); }}
          onVoid={voidAuth}
          onRefund={refund}
          onReceipt={(i) => { setInspectId(null); setReceiptId(i.id); }}
          onRetryPayout={purchaseOrRetry}
        />
      )}

      {showEnv && env && <EnvInfoModal env={env} onClose={() => setShowEnv(false)} />}

      {showTelemetry && (
        <Drawer title="APIMatic Live API Telemetry" width="max-w-3xl" onClose={() => setShowTelemetry(false)}>
          <TelemetryPanel calls={calls} />
        </Drawer>
      )}

      <Toasts toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

function Kpi({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint: string; tone: "blue" | "sky" | "emerald" | "amber" }) {
  const tones = {
    blue: "from-pp-navy/60 to-ink-800 text-sky-300",
    sky: "from-sky-900/50 to-ink-800 text-sky-300",
    emerald: "from-emerald-900/50 to-ink-800 text-emerald-300",
    amber: "from-amber-900/40 to-ink-800 text-amber-300",
  };
  return (
    <Card className={cn("bg-gradient-to-br p-4", tones[tone])}>
      <div className="flex items-center justify-between text-xs font-medium text-slate-300">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-white">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-slate-400">{hint}</div>
    </Card>
  );
}
