import { getEnvStatus } from "./env";
import { PaymentError } from "./errors";
import type { PriceInsight, Product, ProductOfferInfo, ProductPick } from "../shared/types";
import { round2 } from "./utils";

const CHANNEL3_ROOT = "https://api.trychannel3.com";
const CHANNEL3_BASE = `${CHANNEL3_ROOT}/v1`;
const TIMEOUT_MS = 25_000;
const HISTORY_TIMEOUT_MS = 8_000;

function liveKey(): string | null {
  const key = process.env.CHANNEL3_API_KEY?.trim();
  return getEnvStatus().channel3 && key ? key : null;
}

/** `x-user-id` makes Channel3 append our project id to buy URLs so clicks and commissions are attributable. */
function headers(apiKey: string, userId?: string): Record<string, string> {
  const h: Record<string, string> = { "x-api-key": apiKey, "Content-Type": "application/json" };
  if (userId) h["x-user-id"] = userId;
  return h;
}

interface CatalogEntry {
  id: string;
  title: string;
  merchant: string;
  price: number;
  rating: number;
  url: string;
  tags: string[];
}

const CATALOG: CatalogEntry[] = [
  { id: "demo_mon_01", title: 'Dell S2722QC 27" 4K UHD USB-C IPS Monitor', merchant: "Dell", price: 249.99, rating: 4.5, url: "https://www.dell.com", tags: ["monitor", "27", "4k", "ips", "usb-c", "display", "uhd"] },
  { id: "demo_mon_02", title: 'LG 27UP550N-W 27" 4K UHD IPS HDR Monitor', merchant: "Best Buy", price: 239.99, rating: 4.4, url: "https://www.bestbuy.com", tags: ["monitor", "27", "4k", "ips", "display", "hdr", "uhd"] },
  { id: "demo_mon_03", title: 'KOORUI 27" 4K IPS Monitor, 60Hz, sRGB 99%', merchant: "Amazon", price: 189.99, rating: 4.3, url: "https://www.amazon.com", tags: ["monitor", "27", "4k", "ips", "display", "uhd"] },
  { id: "demo_mon_04", title: 'Samsung ViewFinity S8 27" 4K UHD Monitor', merchant: "Samsung", price: 299.99, rating: 4.6, url: "https://www.samsung.com", tags: ["monitor", "27", "4k", "ips", "display", "uhd", "usb-c"] },
  { id: "demo_mic_01", title: "Hollyland Lark M2 Wireless Lavalier Microphone System", merchant: "B&H Photo", price: 139.0, rating: 4.6, url: "https://www.bhphotovideo.com", tags: ["mic", "microphone", "lavalier", "lapel", "wireless", "lav"] },
  { id: "demo_mic_02", title: "RODE Wireless GO II Single Channel Wireless Mic System", merchant: "Adorama", price: 199.0, rating: 4.8, url: "https://www.adorama.com", tags: ["mic", "microphone", "lavalier", "lapel", "wireless", "rode", "lav"] },
  { id: "demo_kit_01", title: 'Creator Kit: 18" LED Ring Light + Wireless Lavalier Mic Bundle', merchant: "Amazon", price: 124.99, rating: 4.4, url: "https://www.amazon.com", tags: ["kit", "ring", "light", "led", "mic", "lavalier", "lapel", "wireless", "bundle"] },
  { id: "demo_light_01", title: 'Neewer 18" LED Ring Light Kit with Stand', merchant: "Neewer", price: 59.99, rating: 4.5, url: "https://www.neewer.com", tags: ["ring", "light", "led", "kit", "lighting", "portable"] },
  { id: "demo_light_02", title: "Godox LR160 LED Ring Light Portable Key Light", merchant: "B&H Photo", price: 94.99, rating: 4.5, url: "https://www.bhphotovideo.com", tags: ["ring", "light", "led", "key", "portable", "lighting"] },
  { id: "demo_key_01", title: "YubiKey 5 NFC Hardware Security Key", merchant: "Yubico", price: 50.0, rating: 4.8, url: "https://www.yubico.com", tags: ["security", "key", "yubikey", "2fa", "hardware", "fido2"] },
  { id: "demo_key_02", title: "Google Titan Security Key (USB-C/NFC)", merchant: "Google Store", price: 30.0, rating: 4.4, url: "https://store.google.com", tags: ["security", "key", "titan", "2fa", "hardware", "fido2"] },
  { id: "demo_kb_01", title: "Keychron K2 Wireless Mechanical Keyboard", merchant: "Keychron", price: 89.0, rating: 4.6, url: "https://www.keychron.com", tags: ["keyboard", "mechanical", "wireless"] },
  { id: "demo_cam_01", title: "Logitech C920s Pro HD 1080p Webcam", merchant: "Best Buy", price: 69.99, rating: 4.5, url: "https://www.bestbuy.com", tags: ["webcam", "camera", "1080p", "hd"] },
  { id: "demo_ssd_01", title: "Samsung T7 Portable SSD 1TB", merchant: "Amazon", price: 94.99, rating: 4.8, url: "https://www.amazon.com", tags: ["ssd", "storage", "portable", "drive", "1tb"] },
];

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/["”“]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !["the", "and", "for", "with", "inch", "a", "an", "of", "to"].includes(t));
}

function toProduct(e: CatalogEntry): Product {
  return {
    id: e.id,
    title: e.title,
    merchant: e.merchant,
    price: e.price,
    currency: "USD",
    imageUrl: null,
    url: e.url,
    rating: e.rating,
    inStock: true,
    source: "fallback",
  };
}

function syntheticAlternatives(query: string, maxPrice: number | null): Product[] {
  const cap = maxPrice ?? 100;
  const label = query.trim().slice(0, 60) || "Project equipment";
  return [
    { f: 0.95, name: "Pro Pick", merchant: "Amazon", rating: 4.5 },
    { f: 0.75, name: "Best Value", merchant: "Best Buy", rating: 4.3 },
    { f: 0.55, name: "Budget Option", merchant: "Walmart", rating: 4.1 },
  ].map((t, i) => ({
    id: `demo_syn_${i}_${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
    title: `${label} (${t.name})`,
    merchant: t.merchant,
    price: round2(cap * t.f),
    currency: "USD",
    imageUrl: null,
    url: "https://www.example.com/product",
    rating: t.rating,
    inStock: true,
    source: "fallback" as const,
  }));
}

export function searchFallback(query: string, maxPrice: number | null, limit: number): Product[] {
  const tokens = tokenize(query);
  const scored = CATALOG.map((e) => {
    const haystack = new Set([...e.tags, ...tokenize(e.title)]);
    const hits = tokens.filter((t) => haystack.has(t)).length;
    return { e, hits };
  })
    .filter((s) => s.hits >= Math.min(2, tokens.length) && s.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.e.rating - a.e.rating);

  const within = scored.filter((s) => maxPrice === null || s.e.price <= maxPrice).map((s) => toProduct(s.e));
  if (within.length > 0) return within.slice(0, limit);
  if (scored.length > 0 && maxPrice === null) return scored.slice(0, limit).map((s) => toProduct(s.e));
  return syntheticAlternatives(query, maxPrice).slice(0, limit);
}

interface Channel3Offer {
  url?: string;
  domain?: string;
  price?: { price?: number; compare_at_price?: number | null; currency?: string };
  availability?: string;
}
export interface Channel3Product {
  id?: string;
  title?: string;
  description?: string | null;
  brands?: Array<{ name?: string }>;
  images?: Array<{ url?: string; cleaned_url?: string | null; is_main_image?: boolean }>;
  key_features?: string[] | null;
  offers?: Channel3Offer[];
  ratings?: { value?: number; count?: number } | null;
}

export function mapLiveProduct(p: Channel3Product): Product | null {
  const priced = (p.offers ?? []).filter((o) => typeof o.price?.price === "number");
  if (!p.id || !p.title || priced.length === 0) return null;
  const byPrice = (a: Channel3Offer, b: Channel3Offer) => (a.price?.price ?? 0) - (b.price?.price ?? 0);
  const inStockOffers = priced.filter((o) => o.availability !== "OutOfStock");
  const offer = [...(inStockOffers.length > 0 ? inStockOffers : priced)].sort(byPrice)[0];
  const image = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  const offers: ProductOfferInfo[] = [...priced]
    .sort(byPrice)
    .slice(0, 6)
    .map((o) => ({
      merchant: o.domain ?? "merchant",
      price: round2(o.price?.price ?? 0),
      compareAt: typeof o.price?.compare_at_price === "number" ? round2(o.price.compare_at_price) : null,
      inStock: o.availability !== "OutOfStock",
      url: o.url ?? "",
    }));
  const compareAt = offer.price?.compare_at_price;
  return {
    id: p.id,
    title: p.title,
    merchant: offer.domain ?? p.brands?.[0]?.name ?? "Unknown merchant",
    price: round2(offer.price?.price ?? 0),
    currency: offer.price?.currency ?? "USD",
    imageUrl: image?.cleaned_url ?? image?.url ?? null,
    url: offer.url ?? "",
    rating: typeof p.ratings?.value === "number" && p.ratings.value > 0 ? Math.round(p.ratings.value * 10) / 10 : null,
    ratingCount: typeof p.ratings?.count === "number" ? p.ratings.count : null,
    brand: p.brands?.[0]?.name ?? null,
    description: p.description ? p.description.slice(0, 280) : null,
    features: (p.key_features ?? []).slice(0, 4),
    offers,
    compareAtPrice: typeof compareAt === "number" && compareAt > (offer.price?.price ?? 0) ? round2(compareAt) : null,
    inStock: inStockOffers.length > 0,
    source: "channel3",
  };
}

// ---------------------------------------------------------------------------
// Procurement agent: explainable ranking of candidates against the stipend cap
// ---------------------------------------------------------------------------

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Scores one candidate out of 100. Every component adds a human-readable reason. */
export function scoreProduct(p: Product, maxPrice: number | null): ProductPick {
  const reasons: string[] = [];
  let score = 0;

  // Budget fit (25): cheaper inside the cap is better, over the cap scores nothing.
  if (maxPrice === null) {
    score += 15;
  } else if (p.price <= maxPrice) {
    score += 25 * (1 - 0.6 * (p.price / maxPrice));
    reasons.push(`${usd(maxPrice - p.price)} under the ${usd(maxPrice)} stipend cap`);
  } else {
    reasons.push(`${usd(p.price - maxPrice)} OVER the ${usd(maxPrice)} stipend cap`);
  }

  // Social proof (25): rating weighted by how many reviews back it.
  if (p.rating !== null) {
    const confidence = p.ratingCount ? Math.min(1, p.ratingCount / 50) : 0.4;
    score += 25 * (p.rating / 5) * (0.5 + 0.5 * confidence);
    reasons.push(p.ratingCount ? `Rated ${p.rating.toFixed(1)}/5 across ${p.ratingCount.toLocaleString("en-US")} reviews` : `Rated ${p.rating.toFixed(1)}/5`);
  } else {
    score += 8;
  }

  // Price position against its own 90-day history (20).
  const ins = p.priceInsight;
  if (ins) {
    const pct = ins.mean > 0 ? Math.round(Math.abs(1 - p.price / ins.mean) * 100) : 0;
    if (ins.status === "low") {
      score += 20;
      reasons.push(`Priced low: ${usd(p.price)} vs ${usd(ins.mean)} 90-day average${pct > 0 ? ` (${pct}% below)` : ""}`);
    } else if (ins.status === "typical") {
      score += 12;
      reasons.push(`Typical price for the last ${ins.days} days (${usd(ins.min)}-${usd(ins.max)})`);
    } else {
      score += 4;
      reasons.push(`Priced high vs its ${usd(ins.mean)} 90-day average; consider waiting`);
    }
  } else {
    score += 10;
  }

  // Merchant depth (10): several sellers means price competition and a fallback.
  const merchants = p.offers?.length ?? 1;
  score += Math.min(merchants, 5) * 2;
  if (merchants > 1 && p.offers) {
    reasons.push(`Sold by ${merchants} merchants, cheapest ${usd(p.offers[0].price)} at ${p.offers[0].merchant}`);
  }

  // Availability (10).
  if (p.inStock) score += 10;
  else reasons.push("Out of stock");

  // Active discount (10).
  if (p.compareAtPrice && p.compareAtPrice > p.price) {
    const off = Math.round((1 - p.price / p.compareAtPrice) * 100);
    score += Math.min(10, off / 2);
    reasons.push(`${off}% off the ${usd(p.compareAtPrice)} list price`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/** Attaches a pick score to every product and returns them best-first. */
export function rankProducts(products: Product[], maxPrice: number | null): Product[] {
  return products
    .map((p) => ({ ...p, pick: scoreProduct(p, maxPrice) }))
    .sort((a, b) => (b.pick?.score ?? 0) - (a.pick?.score ?? 0));
}

interface PriceHistoryResponse {
  history?: Array<{ timestamp: string; price: number }>;
  statistics?: {
    mean: number;
    min_price: number;
    max_price: number;
    current_price: number;
    current_status: "low" | "typical" | "high";
  } | null;
}

/** Channel3 price tracking: 90 days of history plus a low/typical/high verdict for today's price. */
export async function fetchPriceInsight(apiKey: string, productId: string): Promise<PriceInsight | null> {
  try {
    const res = await fetch(`${CHANNEL3_ROOT}/v0/price-tracking/history/${encodeURIComponent(productId)}?days=90`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PriceHistoryResponse;
    const s = data.statistics;
    const history = data.history ?? [];
    if (!s || history.length < 2) return null;
    const step = Math.max(1, Math.ceil(history.length / 30));
    const points = history.filter((_, i) => i % step === 0 || i === history.length - 1).map((h) => ({ t: h.timestamp, price: round2(h.price) }));
    return {
      status: s.current_status,
      mean: round2(s.mean),
      min: round2(s.min_price),
      max: round2(s.max_price),
      current: round2(s.current_price),
      days: 90,
      points,
    };
  } catch {
    return null;
  }
}

/** Rank, enrich the leaders with price history, then re-rank with the history signal included. */
async function rankAndEnrich(products: Product[], maxPrice: number | null, limit: number, apiKey: string | null): Promise<Product[]> {
  const first = rankProducts(products, maxPrice).slice(0, limit);
  if (!apiKey || first.every((p) => p.source !== "channel3")) return first;
  const enriched = await Promise.all(
    first.map(async (p) => (p.source === "channel3" ? { ...p, priceInsight: await fetchPriceInsight(apiKey, p.id) } : p)),
  );
  return rankProducts(enriched, maxPrice);
}

export interface SearchResult {
  products: Product[];
  source: "channel3" | "fallback";
  note?: string;
}

function fallbackResult(q: string, maxPrice: number | null, limit: number, note?: string): SearchResult {
  return { products: rankProducts(searchFallback(q, maxPrice, limit), maxPrice), source: "fallback", note };
}

function inBudgetLive(list: Channel3Product[] | undefined, maxPrice: number | null): Product[] {
  return (list ?? [])
    .map(mapLiveProduct)
    .filter((p): p is Product => p !== null && p.inStock && (maxPrice === null || p.price <= maxPrice));
}

function priceFilters(maxPrice: number | null): Record<string, unknown> {
  return maxPrice === null ? {} : { price: { max_price: maxPrice }, availability: ["InStock"] };
}

export async function searchProducts(query: string, maxPrice: number | null, limit = 3, userId?: string): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { products: [], source: "fallback", note: "Empty query" };

  const apiKey = liveKey();
  if (apiKey) {
    try {
      const res = await fetch(`${CHANNEL3_BASE}/search`, {
        method: "POST",
        headers: headers(apiKey, userId),
        body: JSON.stringify({
          query: q,
          limit: Math.min(30, Math.max(limit * 4, 12)),
          filters: priceFilters(maxPrice),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Channel3 responded with HTTP ${res.status}`);
      const data = (await res.json()) as { products?: Channel3Product[] };
      const mapped = inBudgetLive(data.products, maxPrice);
      if (mapped.length > 0) return { products: await rankAndEnrich(mapped, maxPrice, limit, apiKey), source: "channel3" };
      return fallbackResult(q, maxPrice, limit, "Channel3 returned no in-budget results; showing curated catalog.");
    } catch (err) {
      return fallbackResult(q, maxPrice, limit, `Channel3 unavailable (${(err as Error).message}); showing curated catalog.`);
    }
  }
  return fallbackResult(q, maxPrice, limit);
}

/** Channel3 /v1/similar: in-budget alternatives to a product (out of stock, over budget, or simply not liked). */
export async function findSimilarProducts(product: Product, maxPrice: number | null, limit = 4, userId?: string): Promise<SearchResult> {
  const apiKey = liveKey();
  if (apiKey && product.source === "channel3") {
    try {
      const res = await fetch(`${CHANNEL3_BASE}/similar`, {
        method: "POST",
        headers: headers(apiKey, userId),
        body: JSON.stringify({ product_id: product.id, limit: 20, filters: priceFilters(maxPrice) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Channel3 responded with HTTP ${res.status}`);
      const data = (await res.json()) as { products?: Channel3Product[] };
      const mapped = inBudgetLive(data.products, maxPrice).filter((p) => p.id !== product.id);
      if (mapped.length > 0) return { products: await rankAndEnrich(mapped, maxPrice, limit, apiKey), source: "channel3" };
      return { products: [], source: "channel3", note: "Channel3 found no similar in-budget products." };
    } catch (err) {
      return { products: [], source: "fallback", note: `Channel3 similar-products lookup failed (${(err as Error).message}).` };
    }
  }
  const alt = searchFallback(product.title, maxPrice, limit + 1).filter((p) => p.id !== product.id).slice(0, limit);
  return { products: rankProducts(alt, maxPrice), source: "fallback", note: "Curated catalog alternatives (Channel3 key not configured)." };
}

/** Channel3 /v1/lookup: paste any retailer product link and get structured data plus offers at other retailers. */
export async function lookupProductByUrl(rawUrl: string, userId?: string): Promise<Product> {
  const apiKey = liveKey();
  if (!apiKey) throw new PaymentError("VALIDATION", "Product link lookup needs the Channel3 API key (not configured).", 503);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PaymentError("VALIDATION", "Enter a valid product link.", 422);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PaymentError("VALIDATION", "Only http(s) product links are supported.", 422);
  const res = await fetch(`${CHANNEL3_BASE}/lookup`, {
    method: "POST",
    headers: headers(apiKey, userId),
    body: JSON.stringify({ url: url.toString() }),
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  }).catch(() => null);
  if (!res) throw new PaymentError("VALIDATION", "Channel3 did not respond in time.", 504);
  if (!res.ok) {
    throw new PaymentError("NOT_FOUND", res.status === 422 ? "That link is not a product page." : `Channel3 could not read that link (HTTP ${res.status}).`, res.status === 422 ? 422 : 404);
  }
  const data = (await res.json()) as { product?: Channel3Product };
  const mapped = data.product ? mapLiveProduct(data.product) : null;
  if (!mapped) throw new PaymentError("NOT_FOUND", "Channel3 found no price for that product.", 404);
  return mapped;
}

/** Used by the lookup route: scores a single pasted product against the cap and attaches price history. */
export async function enrichSingle(product: Product, maxPrice: number | null): Promise<Product> {
  const apiKey = liveKey();
  const withInsight = apiKey && product.source === "channel3" ? { ...product, priceInsight: await fetchPriceInsight(apiKey, product.id) } : product;
  return { ...withInsight, pick: scoreProduct(withInsight, maxPrice) };
}

/** Re-checks the current price of an approved product just before checkout. */
export async function fetchLivePrice(product: Product): Promise<{ price: number; inStock: boolean }> {
  const apiKey = process.env.CHANNEL3_API_KEY?.trim();
  if (product.source === "channel3" && apiKey) {
    try {
      const res = await fetch(`${CHANNEL3_BASE}/products/${encodeURIComponent(product.id)}`, {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        const mapped = mapLiveProduct((await res.json()) as Channel3Product);
        if (mapped) return { price: mapped.price, inStock: mapped.inStock };
      }
    } catch {
      // fall through to stored price
    }
  }
  return { price: product.price, inStock: product.inStock };
}
