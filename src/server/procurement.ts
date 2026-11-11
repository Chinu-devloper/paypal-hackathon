import { fetchLivePrice, searchProducts } from "./channel3";
import { getItem, updateItem, addAuditLog } from "./repo";
import { PaymentError } from "./errors";
import type { LedgerItem, Product } from "../shared/types";
import { round2 } from "./utils";

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
  const search = await searchProducts(item.searchQuery ?? item.product.title, maxBudget, 4);
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
