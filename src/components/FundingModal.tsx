"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { ShieldCheck, Zap } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Modal, Pill } from "./ui";
import { api, ApiError, authNeedsReauth, fmtMoney } from "@/client/helpers";
import type { LedgerItem, Product } from "@/shared/types";

interface PriceGuardDetails {
  message: string;
  livePrice: number;
  maxBudget: number;
  alternatives: Product[];
}

interface Props {
  item: LedgerItem;
  clientId: string | null;
  demoMode: boolean;
  onClose: () => void;
  onFunded: (item: LedgerItem) => void;
  onSwapProduct: (item: LedgerItem, product: Product) => Promise<void>;
}

export function FundingModal({ item, clientId, demoMode, onClose, onFunded, onSwapProduct }: Readonly<Props>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guard, setGuard] = useState<PriceGuardDetails | null>(null);
  const reauth = authNeedsReauth(item);

  function handleError(err: unknown) {
    if (err instanceof ApiError && err.code === "PRICE_GUARD") {
      setGuard(err.details as PriceGuardDetails);
      setError(null);
    } else {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Payment failed");
    }
  }

  async function simulate() {
    setBusy(true);
    setError(null);
    setGuard(null);
    try {
      const res = await api<{ item: LedgerItem }>("/api/paypal/simulate-authorization", { body: { itemId: item.id } });
      onFunded(res.item);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={reauth ? "Re-Authorize Escrow via PayPal" : "Fund Escrow via PayPal"} subtitle="Funds are authorized (held), not captured. They are only captured when the AI audit approves the work." onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-ink-600/60 bg-ink-800/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">{item.title}</div>
              <div className="mt-0.5 text-xs text-slate-400">Payee: {item.payee}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums text-white">{fmtMoney(item.amount)}</div>
              <Pill className="bg-blue-500/20 text-blue-300 ring-blue-400/40">intent: AUTHORIZE</Pill>
            </div>
          </div>
          {reauth && <div className="mt-3"><Banner tone="warn">The existing authorization is older than 25 days and nears PayPal's 29-day expiry. A new authorization replaces it and the old hold is voided.</Banner></div>}
          {item.kind === "PROCUREMENT" && item.maxBudget !== null && (
            <div className="mt-3"><Banner tone="info">Price guard: live price is re-verified against the {fmtMoney(item.maxBudget)} stipend cap before the PayPal order is created.</Banner></div>
          )}
        </div>

        {guard && (
          <div className="flex flex-col gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
            <div className="text-sm font-semibold text-red-200">Auto-checkout blocked</div>
            <p className="text-xs text-red-100">{guard.message} AI suggests in-budget alternatives:</p>
            {guard.alternatives.length === 0 ? (
              <p className="text-xs text-slate-300">No in-budget alternatives found. Re-source from the Channel3 Marketplace tab.</p>
            ) : (
              guard.alternatives.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-md bg-ink-900/70 p-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white">{p.title}</div>
                    <div className="text-slate-400">{p.merchant} - {fmtMoney(p.price)}</div>
                  </div>
                  <Button
                    size="xs"
                    variant="success"
                    loading={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onSwapProduct(item, p);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Swap & Continue
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {error && <Banner tone="error">{error}</Banner>}

        <div className="flex flex-col gap-3">
          {clientId ? (
            <div className="rounded-lg border border-ink-600/60 bg-white p-3">
              <PayPalScriptProvider options={{ clientId, intent: "authorize", currency: "USD", components: "buttons" }}>
                <PayPalButtons
                  style={{ layout: "vertical", color: "blue", shape: "rect", label: "pay" }}
                  disabled={busy}
                  createOrder={async () => {
                    setError(null);
                    setGuard(null);
                    try {
                      const res = await api<{ id: string }>("/api/paypal/create-order", { body: { itemId: item.id } });
                      return res.id;
                    } catch (err) {
                      handleError(err);
                      throw err;
                    }
                  }}
                  onApprove={async (data) => {
                    setBusy(true);
                    try {
                      const res = await api<{ item: LedgerItem }>("/api/paypal/authorize-order", { body: { itemId: item.id, orderId: data.orderID } });
                      onFunded(res.item);
                    } catch (err) {
                      handleError(err);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  onError={(err) => setError((prev) => prev ?? (err instanceof Error ? err.message : "PayPal reported an error"))}
                />
              </PayPalScriptProvider>
            </div>
          ) : demoMode ? (
            <Banner tone="info">PayPal Sandbox credentials are not configured, so the official PayPal button is disabled. Use the sandbox simulation below, or add keys to .env.</Banner>
          ) : (
            <Banner tone="warn">Payments are not available because PayPal is not configured on this server. Contact your administrator.</Banner>
          )}
          {demoMode && (
            <>
              <Button variant="outline" onClick={simulate} loading={busy} className="w-full">
                <Zap className="h-4 w-4 text-amber-300" /> Simulate Sandbox Authorization (1-Click)
              </Button>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> No real money moves in sandbox. Judge convenience mode runs the same Orders v2 authorize flow through the SDK simulator.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
