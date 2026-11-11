import { getEnvStatus } from "./env";
import type { Product } from "../shared/types";
import { round2 } from "./utils";

const CHANNEL3_BASE = "https://api.trychannel3.com/v1";
const TIMEOUT_MS = 12_000;

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
  price?: { price?: number; currency?: string };
  availability?: string;
}
interface Channel3Product {
  id?: string;
  title?: string;
  brands?: Array<{ name?: string }>;
  images?: Array<{ url?: string; cleaned_url?: string | null; is_main_image?: boolean }>;
  offers?: Channel3Offer[];
}

function mapLiveProduct(p: Channel3Product): Product | null {
  const offer = (p.offers ?? [])
    .filter((o) => typeof o.price?.price === "number")
    .sort((a, b) => (a.price?.price ?? 0) - (b.price?.price ?? 0))[0];
  if (!p.id || !p.title || !offer) return null;
  const image = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    id: p.id,
    title: p.title,
    merchant: offer.domain ?? p.brands?.[0]?.name ?? "Unknown merchant",
    price: round2(offer.price?.price ?? 0),
    currency: offer.price?.currency ?? "USD",
    imageUrl: image?.cleaned_url ?? image?.url ?? null,
    url: offer.url ?? "",
    rating: null,
    inStock: offer.availability !== "OutOfStock",
    source: "channel3",
  };
}

export interface SearchResult {
  products: Product[];
  source: "channel3" | "fallback";
  note?: string;
}

export async function searchProducts(query: string, maxPrice: number | null, limit = 3): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { products: [], source: "fallback", note: "Empty query" };

  const apiKey = process.env.CHANNEL3_API_KEY?.trim();
  if (getEnvStatus().channel3 && apiKey) {
    try {
      const res = await fetch(`${CHANNEL3_BASE}/search`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          limit: Math.max(limit * 4, 12),
          filters: maxPrice === null ? {} : { price: { max_price: maxPrice }, availability: ["InStock"] },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Channel3 responded with HTTP ${res.status}`);
      const data = (await res.json()) as { products?: Channel3Product[] };
      const mapped = (data.products ?? [])
        .map(mapLiveProduct)
        .filter((p): p is Product => p !== null && p.inStock && (maxPrice === null || p.price <= maxPrice))
        .slice(0, limit);
      if (mapped.length > 0) return { products: mapped, source: "channel3" };
      return { products: searchFallback(q, maxPrice, limit), source: "fallback", note: "Channel3 returned no in-budget results; showing curated catalog." };
    } catch (err) {
      return {
        products: searchFallback(q, maxPrice, limit),
        source: "fallback",
        note: `Channel3 unavailable (${(err as Error).message}); showing curated catalog.`,
      };
    }
  }
  return { products: searchFallback(q, maxPrice, limit), source: "fallback" };
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
