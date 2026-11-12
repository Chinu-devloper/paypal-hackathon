import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { lintPlan, planWithAgent } = await import("../src/server/ai/scope-agent");
const { describeLlmError } = await import("../src/server/ai/llm");

describe("model error messages", () => {
  it("never repeats provider text, which can contain pieces of the API key", () => {
    const leaky = Object.assign(new Error("401 Incorrect API key provided: AIzaSyAx****WZcl. You can find your API key at https://platform.openai.com"), { status: 401 });
    const text = describeLlmError(leaky);
    assert.doesNotMatch(text, /AIza|platform\.openai|WZcl/);
    assert.match(text, /OPENAI_API_KEY/);
    assert.match(describeLlmError(Object.assign(new Error("x"), { status: 503 })), /busy/);
    assert.match(describeLlmError(Object.assign(new Error("x"), { status: 404 })), /OPENAI_MODEL/);
    assert.match(describeLlmError(new Error("Request timed out.")), /too long/);
  });
});

type Plan = Parameters<typeof lintPlan>[0];

const REQS = [
  { id: "r1", text: "User login", implied: false },
  { id: "r2", text: "Admin login", implied: false },
  { id: "r3", text: "Inventory management", implied: false },
  { id: "r4", text: "Cart and checkout", implied: true },
  { id: "r5", text: "Deployment", implied: true },
];

const ms = (id: string, title: string, amount: number, covers: string[], criteria?: string[]) => ({
  id,
  title,
  amount,
  startDate: "2026-12-01",
  endDate: "2026-12-06",
  dependencies: [] as string[],
  covers,
  acceptanceCriteria: criteria ?? ["Must let customers register and log in with email and password", "Must hash stored passwords with bcrypt before saving them"],
});

const GOOD: Plan = {
  projectTitle: "Milk shop",
  totalBudget: 2000,
  milestones: [
    ms("ms_1", "Requirements, flows and data model", 200, ["r1", "r2", "r3", "r4"]),
    ms("ms_2", "Customer accounts and product catalog", 450, ["r1"]),
    ms("ms_3", "Admin login and inventory management", 500, ["r2", "r3"]),
    ms("ms_4", "Cart, checkout and order records", 500, ["r4"]),
    ms("ms_5", "Testing, deployment and handoff", 350, ["r5"]),
  ],
  procurementItems: [],
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("plan review", () => {
  it("passes a well-split plan", () => {
    assert.deepEqual(lintPlan(GOOD, REQS), []);
  });

  it("flags requirements that no milestone delivers", () => {
    const plan = clone(GOOD);
    plan.milestones[0]!.covers = ["r1", "r2", "r3"];
    plan.milestones[3]!.covers = [];
    const issues = lintPlan(plan, REQS);
    assert.ok(issues.some((i) => i.category === "coverage" && /Cart and checkout/.test(i.message)));
  });

  it("flags a plan that lumps everything into one or two big payments", () => {
    const lumped: Plan = { ...GOOD, milestones: [ms("ms_1", "Build the whole application", 1500, ["r1", "r2", "r3", "r4", "r5"]), ms("ms_2", "Final delivery", 500, [])] };
    const issues = lintPlan(lumped, REQS);
    assert.ok(issues.some((i) => i.category === "count"));
    assert.ok(issues.some((i) => i.category === "granularity"));
    assert.ok(issues.some((i) => i.category === "titles"));
  });

  it("flags lopsided payments and oversized testing milestones", () => {
    const plan = clone(GOOD);
    plan.milestones[4]!.amount = 1200;
    const issues = lintPlan(plan, REQS);
    assert.ok(issues.some((i) => i.category === "size" && /Testing, deployment/.test(i.message)));
  });

  it("rejects vague or non-verifiable acceptance criteria", () => {
    const plan = clone(GOOD);
    plan.milestones[1]!.acceptanceCriteria = ["The login system must work properly", "Must be user-friendly and robust", "Must do it"];
    const issues = lintPlan(plan, REQS).filter((i) => i.category === "criteria");
    assert.ok(issues.length >= 3, issues.map((i) => i.message).join("\n"));
  });
});

const understanding = { summary: "A milk shop with customer and admin areas.", requirements: REQS };

describe("scope agent", () => {
  it("sends a failing plan back with the exact problems and keeps the repaired plan", async () => {
    const lumped: Plan = { ...GOOD, milestones: [ms("ms_1", "Build the whole application", 1500, ["r1", "r2", "r3", "r4", "r5"]), ms("ms_2", "Final delivery and handoff", 500, [])] };
    const calls: string[] = [];
    const answers = [understanding, lumped, GOOD];
    const out = await planWithAgent(
      { prompt: "I want a milk shop with user login, admin login and inventory management", totalBudget: 2000 },
      {
        now: () => new Date("2026-11-12T00:00:00Z"),
        chat: async (messages) => {
          calls.push(messages[0]!.content.slice(0, 40));
          return answers.shift();
        },
      },
    );
    assert.equal(calls.length, 3, "understand, plan, one repair");
    assert.match(calls[2]!, /repairing/);
    assert.equal(out.plan.milestones.length, 5);
    assert.ok(out.insight.checks.some((c) => /Self-corrected/.test(c)));
    assert.equal(out.insight.note, null);
    const cart = out.insight.requirements.find((r) => r.text === "Cart and checkout");
    assert.ok(cart?.milestones.includes("Cart, checkout and order records"));
    assert.equal(out.insight.requirements.find((r) => r.text === "Cart and checkout")?.implied, true);
  });

  it("lays out a contiguous schedule from tomorrow with a valid dependency chain", async () => {
    const answers = [understanding, GOOD];
    const out = await planWithAgent({ prompt: "milk shop with login and inventory", totalBudget: 2000 }, { now: () => new Date("2026-11-12T00:00:00Z"), chat: async () => answers.shift() });
    const [first, second] = out.plan.milestones;
    assert.equal(first!.startDate, "2026-11-13");
    assert.ok(second!.startDate > first!.endDate);
    assert.deepEqual(first!.dependencies, []);
    assert.deepEqual(second!.dependencies, ["ms_1"]);
    assert.deepEqual(out.plan.milestones.map((m) => m.id), ["ms_1", "ms_2", "ms_3", "ms_4", "ms_5"]);
  });

  it("reports what is still wrong when repairs cannot fix it", async () => {
    const lumped: Plan = { ...GOOD, milestones: [ms("ms_1", "Build the whole application", 1500, ["r1", "r2", "r3", "r4", "r5"]), ms("ms_2", "Final delivery and handoff", 500, [])] };
    const answers = [understanding, lumped, lumped, lumped];
    const out = await planWithAgent({ prompt: "milk shop with login and inventory", totalBudget: 2000 }, { chat: async () => answers.shift() });
    assert.match(out.insight.note ?? "", /still flagged/);
  });

  it("falls back to the first plan when a repair attempt returns garbage", async () => {
    const lumped: Plan = { ...GOOD, milestones: [ms("ms_1", "Build the whole application", 1500, ["r1", "r2", "r3", "r4", "r5"]), ms("ms_2", "Final delivery and handoff", 500, [])] };
    const answers: unknown[] = [understanding, lumped, { nonsense: true }, { nonsense: true }];
    const out = await planWithAgent({ prompt: "milk shop with login and inventory", totalBudget: 2000 }, { chat: async () => answers.shift() });
    assert.equal(out.plan.milestones.length, 2);
    assert.ok(out.insight.note);
  });
});
