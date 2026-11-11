"use client";

import { Package, RefreshCw, ShoppingCart, Star, Store } from "lucide-react";
import { useState } from "react";
import { Button, Card, Pill } from "./ui";
import { fmtMoney, STATUS_META } from "@/client/helpers";
import type { LedgerItem, Product } from "@/shared/types";

interface Props {
  items: LedgerItem[];
  busyIds: Set<string>;
  onApprove: (item: LedgerItem, product: Product) => Promise<void>;
  onResource: (item: LedgerItem, query: string) => Promise<void>;
}

function ProductCard({ product, item, approved, busy, onApprove }: { product: Product; item: LedgerItem; approved: boolean; busy: boolean; onApprove: () => void }) {
  const overBudget = item.maxBudget !== null && product.price > item.maxBudget;
  const canApprove = ["DRAFT", "READY_TO_ORDER"].includes(item.status) && !approved && !overBudget && product.inStock;
  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border bg-ink-900/70 ${approved ? "border-emerald-500/60" : "border-ink-600/50"}`}>
      <div className="flex h-28 items-center justify-center bg-gradient-to-br from-ink-700 to-ink-800">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.title} className="h-full w-full object-contain p-2" loading="lazy" />
        ) : (
          <Package className="h-10 w-10 text-slate-500" aria-hidden />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h4 className="line-clamp-2 text-sm font-medium text-white" title={product.title}>{product.title}</h4>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-1"><Store className="h-3 w-3" aria-hidden /> {product.merchant}</span>
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3 text-amber-400" aria-hidden />
            {product.rating !== null ? product.rating.toFixed(1) : "n/a"}
          </span>
        </div>
        <div className="mt-auto flex items-end justify-between">
          <span className={`text-lg font-bold tabular-nums ${overBudget ? "text-red-300" : "text-white"}`}>{fmtMoney(product.price)}</span>
          {approved && <Pill className="bg-emerald-500/20 text-emerald-300 ring-emerald-400/40">APPROVED</Pill>}
          {overBudget && <Pill className="bg-red-500/20 text-red-300 ring-red-400/40">OVER CAP</Pill>}
        </div>
        <Button size="sm" variant={approved ? "outline" : "success"} disabled={!canApprove} loading={busy} onClick={onApprove}>
          <ShoppingCart className="h-3.5 w-3.5" /> {approved ? "Added to PayPal order" : "Approve & Add to PayPal Order"}
        </Button>
      </div>
    </div>
  );
}

function ProcurementPanel({ item, busy, onApprove, onResource }: { item: LedgerItem; busy: boolean; onApprove: Props["onApprove"]; onResource: Props["onResource"] }) {
  const [query, setQuery] = useState(item.searchQuery ?? "");
  const editable = ["DRAFT", "READY_TO_ORDER"].includes(item.status);
  const source = item.candidates[0]?.source;
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{item.title}</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            AI procurement agent: {item.reason ?? "Equipment required for the project"} - stipend cap <b className="text-slate-200">{fmtMoney(item.maxBudget ?? item.amount)}</b>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill className={STATUS_META[item.status].className}>{STATUS_META[item.status].label}</Pill>
          {source && (
            <Pill className={source === "channel3" ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40" : "bg-slate-500/20 text-slate-300 ring-slate-400/30"}>
              {source === "channel3" ? "LIVE CHANNEL3" : "CURATED CATALOG"}
            </Pill>
          )}
        </div>
      </div>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim().length >= 2) void onResource(item, query.trim());
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!editable}
          aria-label="Product search query"
          className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!editable || query.trim().length < 2} loading={busy}>
          <RefreshCw className="h-3.5 w-3.5" /> Re-source
        </Button>
      </form>
      {item.candidates.length === 0 ? (
        <p className="text-sm text-slate-400">No in-budget products found. Try a broader search query.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {item.candidates.map((p) => (
            <ProductCard key={p.id} product={p} item={item} busy={busy} approved={item.product?.id === p.id} onApprove={() => void onApprove(item, p)} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function MarketplaceTab({ items, busyIds, onApprove, onResource }: Props) {
  const procurement = items.filter((i) => i.kind === "PROCUREMENT");
  if (procurement.length === 0) {
    return <Card className="p-6 text-sm text-slate-400">This project has no equipment procurement items.</Card>;
  }
  return (
    <div className="flex flex-col gap-4">
      {procurement.map((item) => (
        <ProcurementPanel key={item.id + (item.searchQuery ?? "")} item={item} busy={busyIds.has(item.id)} onApprove={onApprove} onResource={onResource} />
      ))}
    </div>
  );
}
