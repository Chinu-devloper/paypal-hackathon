import { paypalLikeId } from "./apimatic-paypal/transport";
import { searchFallback } from "./channel3";
import { blankItem } from "./items";
import { addAuditLog, insertProject, listProjects } from "./repo";
import { buildRecord } from "./ai/auditor";
import { demoToolsEnabled } from "./env";
import type { LedgerItem, Project } from "../shared/types";
import { addDays, isoDate } from "./utils";

export const SCENARIO_PROMPTS = {
  scn1: "Hire a frontend engineer to build a responsive SaaS pricing page with dark mode, a monthly/annual toggle, and 3 pricing tiers for $950, plus $250 equipment stipend for a 4K test monitor.",
  scn2: "Commission a creator to write scripts and film 2 product showcase videos for our smart coffee mug ($650), plus source a portable LED ring light and wireless lapel mic ($200).",
  scn3: "Audit our payment router module, provide a vulnerability report with severity ratings, and supply unit tests.",
} as const;

const CLIENT = "sb-client@business.example.com";
const FREELANCER = "sb-freelancer@personal.example.com";

function ids(seed: string) {
  return {
    orderId: paypalLikeId("order", seed),
    authorizationId: paypalLikeId("auth", paypalLikeId("order", seed)),
  };
}

function authorized(item: LedgerItem, daysAgo: number): LedgerItem {
  const at = addDays(new Date(), -daysAgo);
  return {
    ...item,
    status: "AUTHORIZED",
    simulatedAuth: true,
    paypal: ids(item.id),
    authorizedAt: at.toISOString(),
    authorizationExpiresAt: addDays(at, 29).toISOString(),
  };
}

function paidOut(item: LedgerItem, daysAgo: number, score: number): LedgerItem {
  const base = authorized(item, daysAgo + 4);
  const audit = buildRecord({
    score,
    criteria: item.acceptanceCriteria.map((criterion) => ({ criterion, score, pass: true, evidence: "Verified in submitted deliverable" })),
    fixes: [],
    verdict: "APPROVED",
    engine: "demo-engine",
    injectionFindings: [],
    submission: "Historical approved submission",
    amount: item.amount,
  });
  return {
    ...base,
    status: "PAID_OUT",
    auditScore: score,
    lastAudit: audit,
    capturedAmount: item.amount,
    releasedToClient: 0,
    paypal: {
      ...base.paypal,
      captureId: paypalLikeId("cap", item.id),
      payoutBatchId: paypalLikeId("payout", item.id, 13),
    },
  };
}

function project(key: keyof typeof SCENARIO_PROMPTS, title: string, totalBudget: number): Project {
  return {
    id: key,
    scenarioKey: key,
    title,
    prompt: SCENARIO_PROMPTS[key],
    totalBudget,
    clientEmail: CLIENT,
    freelancerEmail: FREELANCER,
    createdAt: new Date().toISOString(),
  };
}

function seedScenario1(): { project: Project; items: LedgerItem[] } {
  const today = new Date();
  const d = (n: number) => isoDate(addDays(today, n));
  const pid = "scn1";
  const monitorQuery = "27 inch 4K USB-C Monitor";
  const monitor = searchFallback(monitorQuery, 250, 3);

  const m1 = paidOut(
    blankItem({
      id: "scn1_m1", projectId: pid, kind: "SERVICE", sortOrder: 0, title: "Design System & Hero Section", payee: FREELANCER, amount: 350,
      startDate: d(-12), endDate: d(-7),
      acceptanceCriteria: ["Must define reusable design tokens (colors, spacing, typography)", "Must include a responsive hero section with a clear call to action", "Must be accessible with semantic HTML and visible focus states"],
    }),
    6,
    96,
  );
  const m2 = authorized(
    blankItem({
      id: "scn1_m2", projectId: pid, kind: "SERVICE", sortOrder: 1, title: "Interactive Pricing Table with Monthly/Annual Toggle & Dark Mode", payee: FREELANCER, amount: 600,
      startDate: d(-6), endDate: d(2), dependencies: ["scn1_m1"],
      acceptanceCriteria: ["Must include at least 3 distinct pricing tiers (Starter, Pro, Enterprise)", "Must implement a working Monthly vs Annual billing toggle with discount calculation", "Must include dark mode classes or CSS variables"],
    }),
    3,
  );
  const m3 = blankItem({
    id: "scn1_m3", projectId: pid, kind: "PROCUREMENT", sortOrder: 2, title: `Procurement: ${monitorQuery}`, payee: monitor[0]?.merchant ?? "Dell",
    amount: monitor[0]?.price ?? 249.99, startDate: d(-6), endDate: d(2), dependencies: ["scn1_m1"],
    status: "READY_TO_ORDER", searchQuery: monitorQuery, maxBudget: 250, reason: "Required for high-DPI cross-browser visual QA",
    candidates: monitor, product: monitor[0] ?? null,
  });
  return { project: project("scn1", "SaaS Pricing Page & Hardware Setup", 1200), items: [m1, m2, m3] };
}

function seedScenario2(): { project: Project; items: LedgerItem[] } {
  const today = new Date();
  const d = (n: number) => isoDate(addDays(today, n));
  const pid = "scn2";
  const query = "wireless lavalier lapel mic and LED ring light kit";
  const kit = searchFallback(query, 200, 3);

  const m1 = authorized(
    blankItem({
      id: "scn2_m1", projectId: pid, kind: "SERVICE", sortOrder: 0, title: "2 Hook-Driven Video Scripts & Storyboards", payee: FREELANCER, amount: 250,
      startDate: d(-3), endDate: d(3),
      acceptanceCriteria: ["Must deliver 2 distinct scripts that each open with a hook in the first 3 seconds", "Must include a storyboard with shot list for every script", "Must include a clear product call to action in each script"],
    }),
    2,
  );
  const m2 = blankItem({
    id: "scn2_m2", projectId: pid, kind: "SERVICE", sortOrder: 1, title: "Final 60fps Vertical Video Cut with Captions", payee: FREELANCER, amount: 400,
    startDate: d(4), endDate: d(12), dependencies: ["scn2_m1"], status: "PENDING_FUNDING",
    acceptanceCriteria: ["Must deliver 2 finished 9:16 vertical videos at 60fps", "Must include burned-in captions that match the script", "Must show the product clearly within the first 5 seconds"],
  });
  const m3 = blankItem({
    id: "scn2_m3", projectId: pid, kind: "PROCUREMENT", sortOrder: 2, title: `Procurement: ${query}`, payee: "Channel3 merchant (pending selection)", amount: 200,
    startDate: d(-3), endDate: d(4), status: "DRAFT", searchQuery: query, maxBudget: 200, reason: "Clean audio and lighting for the product showcase shoot",
    candidates: kit,
  });
  return { project: project("scn2", "Smart Coffee Mug TikTok Ad Campaign", 850), items: [m1, m2, m3] };
}

function seedScenario3(): { project: Project; items: LedgerItem[] } {
  const today = new Date();
  const d = (n: number) => isoDate(addDays(today, n));
  const pid = "scn3";
  const query = "hardware security key FIDO2";
  const keys = searchFallback(query, 60, 3);

  const m1 = authorized(
    blankItem({
      id: "scn3_m1", projectId: pid, kind: "SERVICE", sortOrder: 0, title: "Threat Model & Scope Review", payee: FREELANCER, amount: 600,
      startDate: d(-2), endDate: d(3),
      acceptanceCriteria: ["Must document the attack surface and trust boundaries of the module", "Must list assumptions and out-of-scope components"],
    }),
    1,
  );
  const m2 = blankItem({
    id: "scn3_m2", projectId: pid, kind: "SERVICE", sortOrder: 1, title: "Vulnerability Report with Severity Ratings", payee: FREELANCER, amount: 800,
    startDate: d(4), endDate: d(10), dependencies: ["scn3_m1"], status: "PENDING_FUNDING",
    acceptanceCriteria: ["Must rate every finding with a severity (Critical, High, Medium, Low)", "Must include a reproduction or proof of concept for each High or Critical finding", "Must include a concrete remediation recommendation per finding"],
  });
  const m3 = blankItem({
    id: "scn3_m3", projectId: pid, kind: "SERVICE", sortOrder: 2, title: "Unit Test Suite & Remediation Verification", payee: FREELANCER, amount: 540,
    startDate: d(11), endDate: d(16), dependencies: ["scn3_m2"], status: "PENDING_FUNDING",
    acceptanceCriteria: ["Must supply runnable unit tests with at least 4 test cases", "Must include tests covering failure paths and edge cases"],
  });
  const m4 = blankItem({
    id: "scn3_m4", projectId: pid, kind: "PROCUREMENT", sortOrder: 3, title: `Procurement: ${query}`, payee: "Channel3 merchant (pending selection)", amount: 60,
    startDate: d(-2), endDate: d(3), status: "DRAFT", searchQuery: query, maxBudget: 60, reason: "Hardware 2FA for repository and signing access during the audit",
    candidates: keys,
  });
  return { project: project("scn3", "Payment Router Security Audit", 2000), items: [m1, m2, m3, m4] };
}

export function seedDemoData(): void {
  for (const { project: p, items } of [seedScenario1(), seedScenario2(), seedScenario3()]) {
    insertProject(p, items);
    addAuditLog(p.id, null, "INFO", "PROJECT_SEEDED", `Demo scenario "${p.title}" loaded.`);
  }
}

let seeding = false;
export function seedIfEmpty(): void {
  if (seeding || !demoToolsEnabled()) return;
  seeding = true;
  try {
    if (listProjects().length === 0) seedDemoData();
  } finally {
    seeding = false;
  }
}
