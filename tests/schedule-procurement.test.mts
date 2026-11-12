import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { validateReschedule } = await import("../src/shared/schedule");
const { rankProducts, scoreProduct, mapLiveProduct } = await import("../src/server/channel3");

type Item = Parameters<typeof validateReschedule>[0];
type Prod = Parameters<typeof scoreProduct>[0];

const item = (id: string, status: string, startDate: string, endDate: string, dependencies: string[] = []) =>
  ({ id, title: `Milestone ${id}`, status, startDate, endDate, dependencies }) as unknown as Item;

const a = item("a", "DRAFT", "2026-12-01", "2026-12-05");
const b = item("b", "PENDING_FUNDING", "2026-12-06", "2026-12-10", ["a"]);
const c = item("c", "AUTHORIZED", "2026-12-11", "2026-12-15", ["b"]);
const all = [a, b, c];

describe("validateReschedule", () => {
  it("allows a move inside the dependency window", () => {
    assert.equal(validateReschedule(b, all, "2026-12-07", "2026-12-09"), null);
  });
  it("locks funded milestones", () => {
    assert.match(validateReschedule(c, all, "2026-12-12", "2026-12-16") ?? "", /locked/);
  });
  it("rejects starting before a prerequisite finishes", () => {
    assert.match(validateReschedule(b, all, "2026-12-03", "2026-12-10") ?? "", /Cannot start before/);
  });
  it("rejects finishing after a dependent starts", () => {
    assert.match(validateReschedule(b, all, "2026-12-06", "2026-12-12") ?? "", /Cannot finish after/);
  });
  it("rejects inverted and malformed dates", () => {
    assert.match(validateReschedule(a, all, "2026-12-05", "2026-12-01") ?? "", /before it starts/);
    assert.match(validateReschedule(a, all, "12/01/2026", "2026-12-05") ?? "", /YYYY-MM-DD/);
  });
});

const product = (over: Partial<Prod>): Prod =>
  ({
    id: "p",
    title: "Chair",
    merchant: "shop.example",
    price: 100,
    currency: "USD",
    imageUrl: null,
    url: "https://shop.example/p",
    rating: 4.5,
    inStock: true,
    source: "channel3",
    ...over,
  }) as Prod;

describe("procurement ranking", () => {
  it("scores within 0-100 and explains itself", () => {
    const pick = scoreProduct(product({ ratingCount: 900 }), 200);
    assert.ok(pick.score >= 0 && pick.score <= 100);
    assert.ok(pick.reasons.some((r) => /under the \$200\.00 stipend cap/.test(r)));
  });
  it("penalises products over the cap", () => {
    const over = scoreProduct(product({ price: 250 }), 200);
    assert.ok(over.reasons.some((r) => /OVER/.test(r)));
    assert.ok(over.score < scoreProduct(product({ price: 150 }), 200).score);
  });
  it("prefers a historically low price and ranks best-first", () => {
    const insight = { status: "low", mean: 140, min: 100, max: 160, current: 100, days: 90, points: [] } as unknown as Prod["priceInsight"];
    const ranked = rankProducts([product({ id: "plain" }), product({ id: "deal", priceInsight: insight })], 200);
    assert.equal(ranked[0].id, "deal");
    assert.ok(ranked[0].pick?.reasons.some((r) => /Priced low/.test(r)));
  });
  it("maps a live Channel3 product to the cheapest in-stock offer", () => {
    const mapped = mapLiveProduct({
      id: "x1",
      title: "Desk",
      offers: [
        { domain: "a.com", url: "https://a.com", price: { price: 90 }, availability: "OutOfStock" },
        { domain: "b.com", url: "https://b.com", price: { price: 120 }, availability: "InStock" },
        { domain: "c.com", url: "https://c.com", price: { price: 110, compare_at_price: 150 }, availability: "InStock" },
      ],
    });
    assert.equal(mapped?.merchant, "c.com");
    assert.equal(mapped?.price, 110);
    assert.equal(mapped?.compareAtPrice, 150);
    assert.equal(mapped?.offers?.length, 3);
  });
});
