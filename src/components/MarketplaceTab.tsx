"use client";

import { Bot, ExternalLink, Link2, Package, RefreshCw, Shuffle, ShoppingCart, Sparkles, Star, Store, TrendingDown } from "lucide-react";
import { useState } from "react";
import { Button, Card, Pill } from "./ui";
import { fmtMoney, STATUS_META } from "@/client/helpers";
import type { LedgerItem, PriceInsight, Product } from "@/shared/types";

interface Props {
  items: LedgerItem[];
  busyIds: Set<string>;
  onApprove: (item: LedgerItem, product: Product) => Promise<void>;
  onResource: (item: LedgerItem, query: string) => Promise<void>;
  onSimilar: (item: LedgerItem, product: Product) => Promise<void>;
  onAddLink: (item: LedgerItem, url: string) => Promise<void>;
}

const INSIGHT_META: Record<PriceInsight["status"], { label: string; className: string; stroke: string }> = {
  low: { label: "LOW PRICE", className: "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40", stroke: "#34d399" },
  typical: { label: "TYPICAL PRICE", className: "bg-sky-500/20 text-sky-300 ring-sky-400/40", stroke: "#38bdf8" },
  high: { label: "HIGH PRICE", className: "bg-amber-500/20 text-amber-300 ring-amber-400/40", stroke: "#fbbf24" },
};

/** 90-day Channel3 price history with the current price marked. */
function Sparkline({ insight }: { insight: PriceInsight }) {
  const w = 132;
  const h = 34;
  const prices = insight.points.map((p) => p.price);
  const lo = Math.min(...prices, insight.current);
  const hi = Math.max(...prices, insight.current);
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, prices.length - 1)) * (w - 6) + 3;
  const y = (v: number) => h - 4 - ((v - lo) / span) * (h - 8);
  const path = prices.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const meta = INSIGHT_META[insight.status];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" role="img" aria-label={`90-day price history, currently ${insight.status}`}>
      <line x1="3" x2={w - 3} y1={y(insight.mean)} y2={y(insight.mean)} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={meta.stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(prices.length - 1)} cy={y(insight.current)} r="3" fill={meta.stroke} />
    </svg>
  );
}

function ProductCard({
  product,
  item,
  approved,
  best,
  busy,
  onApprove,
  onSimilar,
}: {
  product: Product;
  item: LedgerItem;
  approved: boolean;
  best: boolean;
  busy: boolean;
  onApprove: () => void;
  onSimilar: () => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const overBudget = item.maxBudget !== null && product.price > item.maxBudget;
  const editable = ["DRAFT", "READY_TO_ORDER"].includes(item.status);
  const canApprove = editable && !approved && !overBudget && product.inStock;
  const insight = product.priceInsight ?? null;
  const merchants = product.offers?.length ?? 0;
  const off = product.compareAtPrice ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;
  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border bg-ink-900/70 ${approved ? "border-emerald-500/60" : best ? "border-violet-400/60 shadow-lg" : "border-ink-600/50"}`}>
      <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-ink-700 to-ink-800">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.title} className="h-full w-full object-contain p-2" loading="lazy" />
        ) : (
          <Package className="h-10 w-10 text-slate-500" aria-hidden />
        )}
        {best && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            <Sparkles className="h-3 w-3" aria-hidden /> Agent pick
          </span>
        )}
        {product.pick && (
          <span className="absolute right-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white" title="Procurement agent score out of 100">
            {product.pick.score}/100
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h4 className="line-clamp-2 text-sm font-medium text-white" title={product.title}>{product.title}</h4>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="flex min-w-0 items-center gap-1 truncate"><Store className="h-3 w-3 shrink-0" aria-hidden /> {product.merchant}</span>
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3 text-amber-400" aria-hidden />
            {product.rating !== null ? product.rating.toFixed(1) : "n/a"}
            {product.ratingCount ? <span className="text-slate-500">({product.ratingCount.toLocaleString("en-US")})</span> : null}
          </span>
        </div>
        {merchants > 1 && product.offers && (
          <p className="text-[11px] text-slate-400">
            {merchants} merchants, {fmtMoney(product.offers[0].price)} - {fmtMoney(product.offers[product.offers.length - 1].price)}
          </p>
        )}
        {insight && (
          <div className="rounded-md border border-ink-600/40 bg-ink-800/60 p-2 text-slate-300">
            <div className="mb-1 flex items-center justify-between">
              <Pill className={INSIGHT_META[insight.status].className}>{INSIGHT_META[insight.status].label}</Pill>
              <span className="text-[10px] text-slate-500">{insight.days}d: {fmtMoney(insight.min)} - {fmtMoney(insight.max)}</span>
            </div>
            <Sparkline insight={insight} />
          </div>
        )}
        <div className="mt-auto flex items-end justify-between">
          <span className="flex items-baseline gap-1.5">
            <span className={`text-lg font-bold tabular-nums ${overBudget ? "text-red-300" : "text-white"}`}>{fmtMoney(product.price)}</span>
            {off > 0 && (
              <>
                <span className="text-xs tabular-nums text-slate-500 line-through">{fmtMoney(product.compareAtPrice ?? 0)}</span>
                <span className="text-[11px] font-semibold text-emerald-300">-{off}%</span>
              </>
            )}
          </span>
          {approved && <Pill className="bg-emerald-500/20 text-emerald-300 ring-emerald-400/40">APPROVED</Pill>}
          {overBudget && <Pill className="bg-red-500/20 text-red-300 ring-red-400/40">OVER CAP</Pill>}
        </div>
        {product.pick && (
          <>
            <button type="button" onClick={() => setShowWhy((v) => !v)} className="text-left text-[11px] font-medium text-violet-300 hover:underline" aria-expanded={showWhy}>
              {showWhy ? "Hide agent reasoning" : "Why this score?"}
            </button>
            {showWhy && (
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-300">
                {product.pick.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
          </>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant={approved ? "outline" : "success"} className="flex-1" disabled={!canApprove} loading={busy} onClick={onApprove}>
            <ShoppingCart className="h-3.5 w-3.5" /> {approved ? "Added to PayPal order" : "Approve & Add"}
          </Button>
          {editable && product.source === "channel3" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onSimilar} title="Find in-budget alternatives with Channel3 similar-products" aria-label="Find similar products">
              <Shuffle className="h-3.5 w-3.5" />
            </Button>
          )}
          {product.url && (
            <a href={product.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md border border-ink-600 px-2 text-slate-300 hover:text-white" aria-label="Open merchant page" title="Open merchant page (tracked with your project id)">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ProcurementPanel({ item, busy, onApprove, onResource, onSimilar, onAddLink }: { item: LedgerItem; busy: boolean } & Omit<Props, "items" | "busyIds">) {
  const [query, setQuery] = useState(item.searchQuery ?? "");
  const [link, setLink] = useState("");
  const editable = ["DRAFT", "READY_TO_ORDER"].includes(item.status);
  const source = item.candidates[0]?.source;
  const rec = item.recommendation ?? null;
  const live = source === "channel3";
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
            <Pill className={live ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40" : "bg-slate-500/20 text-slate-300 ring-slate-400/30"}>
              {live ? "LIVE CHANNEL3" : "CURATED CATALOG"}
            </Pill>
          )}
        </div>
      </div>

      {rec && (
        <div className="mb-3 flex gap-2.5 rounded-lg border border-violet-400/30 bg-violet-500/10 p-3">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden />
          <div className="text-xs leading-relaxed text-slate-200">
            <span className="mb-0.5 flex flex-wrap items-center gap-1.5 font-semibold text-violet-200">
              Procurement agent recommendation
              <Pill className="bg-violet-500/20 text-violet-200 ring-violet-400/40">{rec.engine === "openai" ? "AI MODEL" : "RULES"}</Pill>
              {live && (
                <span className="flex items-center gap-1 text-[10px] font-normal text-slate-400">
                  <TrendingDown className="h-3 w-3" aria-hidden /> scored on Channel3 offers, ratings and 90-day price history
                </span>
              )}
            </span>
            {rec.summary}
          </div>
        </div>
      )}

      <form
        className="mb-2 flex gap-2"
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
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) void onAddLink(item, link.trim()).then(() => setLink(""));
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" aria-hidden />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={!editable}
            type="url"
            placeholder="Or paste any retailer product link: Channel3 prices and scores it"
            aria-label="Product link"
            className="w-full rounded-md border border-ink-600 bg-ink-800 py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-slate-500 disabled:opacity-50"
          />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={!editable || !link.trim()} loading={busy}>
          Add link
        </Button>
      </form>

      {item.candidates.length === 0 ? (
        <p className="text-sm text-slate-400">No in-budget products found. Try a broader search query.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {item.candidates.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              item={item}
              busy={busy}
              approved={item.product?.id === p.id}
              best={rec?.productId === p.id}
              onApprove={() => void onApprove(item, p)}
              onSimilar={() => void onSimilar(item, p)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

export function MarketplaceTab({ items, busyIds, onApprove, onResource, onSimilar, onAddLink }: Props) {
  const procurement = items.filter((i) => i.kind === "PROCUREMENT");
  if (procurement.length === 0) {
    return <Card className="p-6 text-sm text-slate-400">This project has no equipment procurement items.</Card>;
  }
  return (
    <div className="flex flex-col gap-4">
      {procurement.map((item) => (
        <ProcurementPanel
          key={item.id + (item.searchQuery ?? "") + item.candidates.map((c) => c.id).join(",")}
          item={item}
          busy={busyIds.has(item.id)}
          onApprove={onApprove}
          onResource={onResource}
          onSimilar={onSimilar}
          onAddLink={onAddLink}
        />
      ))}
    </div>
  );
}
