import type { LedgerItem, ScopePlan } from "../shared/types";
import { searchFallback } from "./channel3";
import { newId } from "./utils";

export function blankItem(overrides: Partial<LedgerItem> & Pick<LedgerItem, "id" | "projectId" | "kind" | "title" | "payee" | "amount">): LedgerItem {
  const today = new Date().toISOString().slice(0, 10);
  return {
    sortOrder: 0,
    startDate: today,
    endDate: today,
    dependencies: [],
    acceptanceCriteria: [],
    status: "DRAFT",
    auditScore: null,
    lastAudit: null,
    paypal: {},
    simulatedAuth: false,
    authorizedAt: null,
    authorizationExpiresAt: null,
    capturedAmount: null,
    releasedToClient: null,
    paymentError: null,
    settlement: null,
    isProcessingPayment: false,
    searchQuery: null,
    maxBudget: null,
    reason: null,
    candidates: [],
    product: null,
    livePriceOverride: null,
    ...overrides,
  };
}

/** Converts an AI scope plan into ledger rows (milestones first, then procurement). */
export function itemsFromPlan(projectId: string, plan: ScopePlan, freelancerEmail: string): LedgerItem[] {
  const idMap = new Map<string, string>();
  plan.milestones.forEach((m) => idMap.set(m.id, newId("ms")));

  const milestones = plan.milestones.map((m, i) =>
    blankItem({
      id: idMap.get(m.id) as string,
      projectId,
      kind: "SERVICE",
      sortOrder: i,
      title: m.title,
      payee: freelancerEmail,
      amount: m.amount,
      startDate: m.startDate,
      endDate: m.endDate,
      dependencies: m.dependencies.map((d) => idMap.get(d)).filter((d): d is string => Boolean(d)),
      acceptanceCriteria: m.acceptanceCriteria,
      status: "PENDING_FUNDING",
    }),
  );

  const lastEnd = plan.milestones.reduce((max, m) => (m.endDate > max ? m.endDate : max), plan.milestones[0].startDate);
  const firstStart = plan.milestones.reduce((min, m) => (m.startDate < min ? m.startDate : min), plan.milestones[0].startDate);

  const procurement = plan.procurementItems.map((p, i) =>
    blankItem({
      id: newId("proc"),
      projectId,
      kind: "PROCUREMENT",
      sortOrder: milestones.length + i,
      title: `Procurement: ${p.searchQuery}`,
      payee: "Channel3 merchant (pending selection)",
      amount: p.maxBudget,
      startDate: firstStart,
      endDate: lastEnd,
      status: "DRAFT",
      searchQuery: p.searchQuery,
      maxBudget: p.maxBudget,
      reason: p.reason,
      candidates: searchFallback(p.searchQuery, p.maxBudget, 3),
    }),
  );
  return [...milestones, ...procurement];
}
