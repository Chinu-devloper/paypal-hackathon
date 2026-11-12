import { fetchLivePrice, searchProducts } from "./channel3";
import { chatJson } from "./ai/llm";
import { getItem, updateItem, addAuditLog } from "./repo";
import { PaymentError } from "./errors";
import type { LedgerItem, Product, ProductRecommendation } from "../shared/types";
import { round2 } from "./utils";

/**
 * The procurement agent's verdict: best in-budget, in-stock candidate by explainable score.
 * With an LLM configured the reasoning is rewritten as a short briefing grounded ONLY in the scored facts;
 * without one (or on any failure) the rule-based summary is used.
 */
export function rulesRecommendation(item: Pick<LedgerItem, "maxBudget">, products: Product[]): ProductRecommendation | null {
  const eligible = products.filter((p) => p.inStock && (item.maxBudget === null || p.price <= item.maxBudget));
  const ranked = [...eligible].sort((a, b) => (b.pick?.score ?? 0) - (a.pick?.score ?? 0));
  const best = ranked[0];
  if (!best) return null;
  const runnerUp = ranked[1];
  const reasons = (best.pick?.reasons ?? []).slice(0, 3).join("; ");
  const summary =
    `${best.title.slice(0, 70)} from ${best.merchant} (${best.pick?.score ?? 0}/100): ${reasons || "best value inside the stipend cap"}.` +
    (runnerUp ? ` Runner-up: ${runnerUp.title.slice(0, 45)} at $${runnerUp.price.toFixed(2)} (${runnerUp.pick?.score ?? 0}/100).` : "");
  return { productId: best.id, summary, engine: "rules" };
}

export async function recommendProduct(item: Pick<LedgerItem, "title" | "maxBudget" | "acceptanceCriteria">, products: Product[], useLlm: boolean): Promise<ProductRecommendation | null> {
  const fallback = rulesRecommendation(item, products);
  if (!fallback || !useLlm || !process.env.OPENAI_API_KEY?.trim()) return fallback;
  const ranked = products
    .filter((p) => p.inStock && (item.maxBudget === null || p.price <= item.maxBudget))
    .sort((a, b) => (b.pick?.score ?? 0) - (a.pick?.score ?? 0));
  const best = ranked[0];

  try {
    const facts = ranked.slice(0, 3).map((p) => ({
      id: p.id,
      title: p.title.slice(0, 80),
      merchant: p.merchant,
      price: p.price,
      score: p.pick?.score,
      reasons: p.pick?.reasons,
    }));
    const out = (await chatJson(
      [
        {
          role: "system",
          content:
            "You are a procurement agent for freelance project equipment. Using ONLY the scored facts supplied, write a 2 sentence recommendation for the client explaining which product to buy and why it beats the alternatives. Do not invent specs, prices or ratings. Return JSON: {\"summary\": string}.",
        },
        { role: "user", content: JSON.stringify({ need: item.title, stipendCap: item.maxBudget, criteria: item.acceptanceCriteria.slice(0, 3), candidates: facts }) },
      ],
      { timeoutMs: 12_000, temperature: 0.2 },
    )) as { summary?: unknown };
    if (typeof out.summary === "string" && out.summary.trim().length > 10) {
      return { productId: best.id, summary: out.summary.trim().slice(0, 420), engine: "openai" };
    }
  } catch {
    // fall back to rules summary
  }
  return fallback;
}

export interface PriceGuardResult {
  ok: boolean;
  livePrice: number;
  maxBudget: number;
  inStock: boolean;
  alternatives: Product[];
  message: string;
}

export function requireProcurementItem(itemId: string): LedgerItem {
  const item = getItem(itemId);
  if (!item) throw new PaymentError("NOT_FOUND", "Item not found", 404);
  if (item.kind !== "PROCUREMENT") throw new PaymentError("INVALID_STATE", "Item is not a Channel3 procurement row", 409);
  return item;
}

/** Edge case 6: re-verify the live price/stock against the approved cap before any PayPal order is created. */
export async function checkPriceGuard(item: LedgerItem): Promise<PriceGuardResult> {
  if (!item.product || item.maxBudget === null) {
    throw new PaymentError("INVALID_STATE", "Approve a product before funding this procurement item", 409);
  }
  const live = await fetchLivePrice(item.product);
  const livePrice = round2(item.livePriceOverride ?? live.price);
  const maxBudget = item.maxBudget;
  const inStock = live.inStock;
  const ok = inStock && livePrice <= maxBudget;
  if (ok) {
    return { ok, livePrice, maxBudget, inStock, alternatives: [], message: `Live price $${livePrice.toFixed(2)} is within the $${maxBudget.toFixed(2)} stipend cap.` };
  }
  const search = await searchProducts(item.searchQuery ?? item.product.title, maxBudget, 4, item.projectId);
  const alternatives = search.products.filter((p) => p.id !== item.product?.id && p.price <= maxBudget).slice(0, 3);
  return {
    ok,
    livePrice,
    maxBudget,
    inStock,
    alternatives,
    message: !inStock
      ? "Item is out of stock. Auto-checkout blocked."
      : `Live price $${livePrice.toFixed(2)} exceeds the approved stipend cap of $${maxBudget.toFixed(2)}. Auto-checkout blocked.`,
  };
}

export function approveProduct(itemId: string, productId: string): LedgerItem {
  const item = requireProcurementItem(itemId);
  if (!["DRAFT", "READY_TO_ORDER"].includes(item.status)) {
    throw new PaymentError("INVALID_STATE", `Cannot change the product while the item is ${item.status}`, 409);
  }
  const product = item.candidates.find((p) => p.id === productId);
  if (!product) throw new PaymentError("NOT_FOUND", "Product is not among the sourced candidates", 404);
  if (item.maxBudget !== null && product.price > item.maxBudget) {
    throw new PaymentError("OVER_BUDGET", `Product price $${product.price.toFixed(2)} exceeds the stipend cap $${item.maxBudget.toFixed(2)}`, 422);
  }
  if (!product.inStock) throw new PaymentError("OUT_OF_STOCK", "Product is out of stock", 422);

  const updated = updateItem(itemId, (it) => {
    it.product = product;
    it.amount = product.price;
    it.payee = product.merchant;
    it.status = "READY_TO_ORDER";
    it.livePriceOverride = null;
    it.paypal = {};
  });
  addAuditLog(updated.projectId, itemId, "INFO", "PRODUCT_APPROVED", `Approved "${product.title}" from ${product.merchant} at $${product.price.toFixed(2)}.`);
  return updated;
}
