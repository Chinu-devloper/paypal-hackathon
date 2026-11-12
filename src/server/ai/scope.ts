import { z } from "zod";
import { getEnvStatus } from "../env";
import type { ScopeInsight, ScopePlan } from "../../shared/types";
import { addDays, isoDate, round2 } from "../utils";
import { planWithAgent } from "./scope-agent";
import { describeLlmError } from "./llm";

export const MAX_PROMPT_CHARS = 4000;
export const MIN_BUDGET = 20;
export const MAX_BUDGET = 250_000;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const planSchema = z.object({
  projectTitle: z.string().min(3).max(140),
  totalBudget: z.number().positive(),
  milestones: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(3).max(200),
        type: z.literal("DELIVERABLE").default("DELIVERABLE"),
        amount: z.number().positive(),
        startDate: isoDateSchema,
        endDate: isoDateSchema,
        dependencies: z.array(z.string()).default([]),
        acceptanceCriteria: z.array(z.string().min(5).max(300)).min(1).max(8),
      }),
    )
    .min(1)
    .max(8),
  procurementItems: z
    .array(
      z.object({
        id: z.string().min(1),
        searchQuery: z.string().min(2).max(120),
        maxBudget: z.number().positive(),
        reason: z.string().max(300).default(""),
      }),
    )
    .max(4)
    .default([]),
});

export interface ScopeRequest {
  prompt: string;
  totalBudget: number | null;
}

interface Template {
  match: RegExp;
  milestones: Array<{ title: string; weight: number; days: number; criteria: string[] }>;
}

const TEMPLATES: Template[] = [
  {
    match: /pricing|saas page|landing page/i,
    milestones: [
      { title: "Design System & Hero Section", weight: 0.37, days: 4, criteria: ["Must define reusable design tokens (colors, spacing, typography)", "Must include a responsive hero section with a clear call to action", "Must be accessible with semantic HTML and visible focus states"] },
      { title: "Interactive Pricing Table with Monthly/Annual Toggle & Dark Mode", weight: 0.63, days: 5, criteria: ["Must include at least 3 distinct pricing tiers (Starter, Pro, Enterprise)", "Must implement a working Monthly vs Annual billing toggle with discount calculation", "Must include dark mode classes or CSS variables"] },
    ],
  },
  {
    match: /video|tiktok|creator|reel|film/i,
    milestones: [
      { title: "Hook-Driven Video Scripts & Storyboards", weight: 0.38, days: 4, criteria: ["Must deliver 2 distinct scripts that each open with a hook in the first 3 seconds", "Must include a storyboard with shot list for every script", "Must include a clear product call to action in each script"] },
      { title: "Final Vertical Video Cut with Captions", weight: 0.62, days: 7, criteria: ["Must deliver 2 finished 9:16 vertical videos at 60fps", "Must include burned-in captions that match the script", "Must show the product clearly within the first 5 seconds"] },
    ],
  },
  {
    match: /audit|vulnerab|security|smart contract|pentest/i,
    milestones: [
      { title: "Threat Model & Scope Review", weight: 0.25, days: 3, criteria: ["Must document the attack surface and trust boundaries of the module", "Must list assumptions and out-of-scope components"] },
      { title: "Vulnerability Report with Severity Ratings", weight: 0.45, days: 6, criteria: ["Must rate every finding with a severity (Critical, High, Medium, Low)", "Must include a reproduction or proof of concept for each High or Critical finding", "Must include a concrete remediation recommendation per finding"] },
      { title: "Unit Test Suite & Remediation Verification", weight: 0.3, days: 5, criteria: ["Must supply runnable unit tests with at least 4 test cases", "Must include tests covering failure paths and edge cases"] },
    ],
  },
  {
    match: /article|blog|copywrit|content|write|whitepaper/i,
    milestones: [
      { title: "Outline & Research Brief", weight: 0.25, days: 3, criteria: ["Must provide a structured outline with section headings", "Must cite at least 5 credible sources"] },
      { title: "Full Draft", weight: 0.5, days: 6, criteria: ["Must cover every outline section with substantive content", "Must follow the requested tone and target audience"] },
      { title: "Final Edit & Delivery", weight: 0.25, days: 3, criteria: ["Must incorporate all review feedback", "Must be free of spelling and grammar errors"] },
    ],
  },
];

const GENERIC_TEMPLATE: Template = {
  match: /./,
  milestones: [
    { title: "Discovery & Plan", weight: 0.2, days: 3, criteria: ["Must document requirements and a delivery plan", "Must list risks and open questions"] },
    { title: "Core Build", weight: 0.5, days: 7, criteria: ["Must implement the core functionality described in the brief", "Must include documentation for how to use the work"] },
    { title: "Final Delivery & Handoff", weight: 0.3, days: 4, criteria: ["Must incorporate all review feedback", "Must include all source files and a handoff summary"] },
  ],
};

const EQUIPMENT_WORDS = /stipend|equipment|source|gear|hardware|device|monitor|mic(rophone)?|light|camera|laptop|keyboard|webcam|security key|yubikey/i;

const SOFTWARE_BRIEF = /\b(apps?|application|web ?app|web ?site|website|e-?commerce|online (store|shop)|marketplace|portal|dashboard)\b/i;

type MilestoneSpec = Template["milestones"][number];

/** Splits a software brief into milestones named after the features it actually asks for. */
function softwareTemplate(prompt: string): Template | null {
  if (!SOFTWARE_BRIEF.test(prompt)) return null;
  const has = (re: RegExp) => re.test(prompt);
  const admin = has(/\b(admin|back ?office|staff)\b/i);
  const accounts = admin || has(/\b(log ?in|sign ?(in|up)|auth\w*|accounts?|register\w*)\b/i);
  const commerce = has(/\b(sell\w*|e-?commerce|shop|store|cart|checkout|orders?|products?|catalog|menu)\b/i);
  const inventory = has(/\b(inventory|stock|warehouse)\b/i);
  const reporting = has(/\b(profit|loss|reports?|reporting|analytics?|revenue|sales)\b/i);

  const features: MilestoneSpec[] = [];
  if (accounts) {
    features.push({
      title: admin ? "User & Admin Login with Role-Based Access" : "User Accounts & Login",
      weight: 0.2,
      days: 5,
      criteria: [
        "Must let customers register and log in with email and password",
        ...(admin ? ["Must provide a separate admin login whose screens are blocked for non-admin users"] : []),
        "Must hash stored passwords and expire sessions on logout",
      ],
    });
  }
  if (commerce) {
    features.push({
      title: "Product Catalog, Cart & Checkout",
      weight: 0.25,
      days: 6,
      criteria: [
        "Must list products with name, price and image and support search or filtering",
        "Must support adding, removing and changing quantities in a cart",
        "Must create an order record at checkout and confirm it to the customer",
      ],
    });
  }
  if (inventory) {
    features.push({
      title: "Admin Inventory Management",
      weight: 0.2,
      days: 5,
      criteria: [
        "Must let an admin add, edit and delete products and their stock levels",
        "Must reduce stock automatically when an order is placed",
        "Must flag products whose stock falls below a set threshold",
      ],
    });
  }
  if (reporting) {
    features.push({
      title: "Sales, Profit & Loss Reporting",
      weight: 0.2,
      days: 5,
      criteria: [
        "Must record cost price and selling price for every product",
        "Must show revenue, cost and profit or loss per product and in total",
        "Must let the user filter the report by date range",
      ],
    });
  }
  if (features.length === 0) {
    features.push({ title: "Core Features Build", weight: 0.5, days: 7, criteria: ["Must implement the core functionality described in the brief", "Must include documentation for how to use the work"] });
  }

  return {
    match: SOFTWARE_BRIEF,
    milestones: [
      {
        title: "Requirements, UX Flows & Data Model",
        weight: 0.15,
        days: 3,
        criteria: ["Must document the user roles and main user journeys", "Must provide wireframes or a clickable prototype of the key screens", "Must define the data model for the entities named in the brief"],
      },
      ...features,
      {
        title: "Testing, Deployment & Handoff",
        weight: 0.15,
        days: 4,
        criteria: ["Must include automated or documented tests for the main flows", "Must be deployed to a reachable URL with setup instructions", "Must include all source files and a handoff summary"],
      },
    ],
  };
}

function projectTitle(prompt: string): string {
  const sentence = prompt.replace(/\s+/g, " ").trim().split(/[.!?]/)[0] ?? "";
  const stripped = sentence.replace(/^(i|we)\s+(want|need|would like)\s+(to\s+(build|create|make)\s+)?/i, "").replace(/^(a|an|the)\s+/i, "");
  let title = stripped || "Custom Project";
  if (title.length > 70) title = `${title.slice(0, 70).replace(/\s+\S*$/, "")}...`;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function procurementQuery(segment: string): string {
  const s = segment.toLowerCase();
  if (/mic|lapel|lavalier/.test(s) && /light|ring/.test(s)) return "wireless lavalier lapel mic and LED ring light kit";
  if (/monitor|display|screen/.test(s)) return "27 inch 4K USB-C Monitor";
  if (/security key|yubikey|2fa/.test(s)) return "hardware security key FIDO2";
  if (/webcam/.test(s)) return "1080p webcam";
  if (/keyboard/.test(s)) return "wireless mechanical keyboard";
  const m = s.match(/(?:for|source|buy|purchase)\s+(?:a|an|the)?\s*([^.,;$]{3,60})/);
  return (m?.[1] ?? "project equipment").trim().replace(/\s+/g, " ");
}

function buildDemoPlan(req: ScopeRequest): ScopePlan {
  const prompt = req.prompt.trim();
  const amountRe = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
  const parseAmounts = (text: string) => [...text.matchAll(amountRe)].map((m) => Number(m[1].replace(/,/g, "")));

  // Equipment is the later clause (after "plus" / ";") that mentions gear and carries its own amount.
  const clauses = prompt.split(/\bplus\b|;/i);
  let procurementAmount = 0;
  let procurementSegment = "";
  let serviceAmounts = 0;
  clauses.forEach((clause, i) => {
    const values = parseAmounts(clause);
    if (i > 0 && values.length > 0 && EQUIPMENT_WORDS.test(clause)) {
      procurementAmount += values[values.length - 1];
      procurementSegment = clause;
    } else {
      serviceAmounts += values.reduce((s, v) => s + v, 0);
    }
  });

  const total = req.totalBudget ?? (serviceAmounts + procurementAmount > 0 ? serviceAmounts + procurementAmount : 1000);
  const serviceBudget = round2(Math.max(total - procurementAmount, total * 0.1));

  const template = softwareTemplate(prompt) ?? TEMPLATES.find((t) => t.match.test(prompt)) ?? GENERIC_TEMPLATE;
  const weightSum = template.milestones.reduce((s, m) => s + m.weight, 0);
  let cursor = addDays(new Date(), 1);
  let allocated = 0;
  const milestones = template.milestones.map((m, i) => {
    const isLast = i === template.milestones.length - 1;
    const amount = isLast ? round2(serviceBudget - allocated) : round2((serviceBudget * m.weight) / weightSum);
    allocated = round2(allocated + amount);
    const start = cursor;
    const end = addDays(start, m.days);
    cursor = addDays(end, 1);
    return {
      id: `ms_${i + 1}`,
      title: m.title,
      type: "DELIVERABLE" as const,
      amount,
      startDate: isoDate(start),
      endDate: isoDate(end),
      dependencies: i === 0 ? [] : [`ms_${i}`],
      acceptanceCriteria: m.criteria,
    };
  });

  const procurementItems =
    procurementAmount > 0
      ? [{ id: "proc_1", searchQuery: procurementQuery(procurementSegment), maxBudget: round2(procurementAmount), reason: "Equipment required to complete and QA the deliverables" }]
      : [];

  return { projectTitle: projectTitle(prompt), totalBudget: round2(total), milestones, procurementItems };
}

/** Rescales milestone amounts so that milestones + procurement caps sum exactly to the budget. */
function normalizePlan(plan: ScopePlan, requestedBudget: number | null): ScopePlan {
  const procurementTotal = plan.procurementItems.reduce((s, p) => s + p.maxBudget, 0);
  const total = requestedBudget ?? plan.totalBudget;
  const serviceBudget = round2(total - procurementTotal);
  const current = plan.milestones.reduce((s, m) => s + m.amount, 0);

  let milestones = plan.milestones;
  if (serviceBudget > 0 && Math.abs(current - serviceBudget) > 0.009) {
    let allocated = 0;
    milestones = plan.milestones.map((m, i) => {
      const isLast = i === plan.milestones.length - 1;
      const amount = isLast ? round2(serviceBudget - allocated) : round2((m.amount / current) * serviceBudget);
      allocated = round2(allocated + amount);
      return { ...m, amount };
    });
  }
  const ids = new Set(milestones.map((m) => m.id));
  milestones = milestones.map((m) => ({
    ...m,
    dependencies: m.dependencies.filter((d) => ids.has(d) && d !== m.id),
    endDate: m.endDate < m.startDate ? m.startDate : m.endDate,
  }));
  return { ...plan, totalBudget: round2(total), milestones };
}

export interface ScopeResult {
  plan: ScopePlan;
  engine: "openai" | "demo-engine";
  note?: string;
  insight: ScopeInsight;
}

function templateInsight(note: string | null): ScopeInsight {
  return {
    engine: "demo-engine",
    summary: "Built with the rule-based planner, which matches your brief against known project types.",
    requirements: [],
    checks: [],
    note: note ?? "No AI model is configured, so these milestones come from templates. Add an AI model key to get milestones tailored to your brief.",
  };
}

export async function generateScope(req: ScopeRequest): Promise<ScopeResult> {
  if (getEnvStatus().openai) {
    try {
      const { plan, insight } = await planWithAgent(req);
      return { plan: normalizePlan(planSchema.parse(plan) as ScopePlan, req.totalBudget), engine: "openai", insight };
    } catch (err) {
      const note = `The AI model was unavailable (${describeLlmError(err)}), so the rule-based planner was used.`;
      return { plan: normalizePlan(buildDemoPlan(req), req.totalBudget), engine: "demo-engine", note, insight: templateInsight(note) };
    }
  }
  return { plan: normalizePlan(buildDemoPlan(req), req.totalBudget), engine: "demo-engine", insight: templateInsight(null) };
}
