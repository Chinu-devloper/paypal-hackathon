export type ItemKind = "SERVICE" | "PROCUREMENT";

export type ItemStatus =
  | "DRAFT"
  | "PENDING_FUNDING"
  | "READY_TO_ORDER"
  | "AUTHORIZED"
  | "AI_AUDITING"
  | "REVISION_NEEDED"
  | "SECURITY_FLAGGED"
  | "CAPTURED"
  | "PAID_OUT"
  | "REFUNDED"
  | "VOIDED";

export const APPROVAL_THRESHOLD = 80;
export const SETTLEMENT_FLOOR = 50;
export const AUTH_WARNING_DAYS = 25;
export const AUTH_EXPIRY_DAYS = 29;

export interface PayPalRefs {
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  payoutBatchId?: string;
  invoiceId?: string;
  refundId?: string;
}

export interface ProductOfferInfo {
  merchant: string;
  price: number;
  compareAt: number | null;
  inStock: boolean;
  url: string;
}

/** Where today's price sits against the product's own 90-day history (Channel3 price tracking). */
export interface PriceInsight {
  status: "low" | "typical" | "high";
  mean: number;
  min: number;
  max: number;
  current: number;
  days: number;
  points: Array<{ t: string; price: number }>;
}

/** Explainable ranking from the procurement agent: every point of the score has a stated reason. */
export interface ProductPick {
  score: number;
  reasons: string[];
}

export interface Product {
  id: string;
  title: string;
  merchant: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  url: string;
  rating: number | null;
  inStock: boolean;
  source: "channel3" | "fallback";
  ratingCount?: number | null;
  brand?: string | null;
  description?: string | null;
  features?: string[];
  /** Every merchant selling it, cheapest first. */
  offers?: ProductOfferInfo[];
  compareAtPrice?: number | null;
  priceInsight?: PriceInsight | null;
  pick?: ProductPick | null;
}

export interface ProductRecommendation {
  productId: string;
  summary: string;
  engine: "openai" | "rules";
}

/** A verbatim quote from a submitted file that backs a scoring decision. */
export interface Citation {
  file: string;
  line: number;
  quote: string;
}

export interface CriterionResult {
  criterion: string;
  score: number;
  pass: boolean;
  evidence: string;
  citations?: Citation[];
}

/** info is context; warn is suspicious; review caps the score below the release threshold; block stops the audit. */
export interface IntegrityFlag {
  id: string;
  severity: "info" | "warn" | "review" | "block";
  message: string;
}

export interface SourceSummary {
  kind: "repository" | "upload" | "text";
  label: string;
  files: number;
  sourceFiles: number;
  codeLines: number;
  testFiles: number;
  languages: Array<{ name: string; lines: number }>;
  skipped: number;
  commits: number | null;
}

export type AuditVerdict = "APPROVED" | "REVISION_NEEDED" | "SECURITY_FLAGGED";

export interface SettlementOffer {
  amount: number;
  holdback: number;
  rationale: string;
}

export interface AuditRecord {
  id: string;
  at: string;
  score: number;
  threshold: number;
  verdict: AuditVerdict;
  criteria: CriterionResult[];
  revisionChecklist: string[];
  settlementOffer: SettlementOffer | null;
  engine: "openai" | "demo-engine" | "security-scanner";
  injectionFindings: string[];
  submissionPreview: string;
  /** Present for repository and folder submissions. */
  source?: SourceSummary;
  integrity?: IntegrityFlag[];
}

export interface Settlement {
  amount: number;
  holdback: number;
  clientAccepted: boolean;
  freelancerAccepted: boolean;
}

export interface LedgerItem {
  id: string;
  projectId: string;
  kind: ItemKind;
  sortOrder: number;
  title: string;
  payee: string;
  amount: number;
  startDate: string;
  endDate: string;
  dependencies: string[];
  acceptanceCriteria: string[];
  status: ItemStatus;
  auditScore: number | null;
  lastAudit: AuditRecord | null;
  paypal: PayPalRefs;
  /** True when the authorization was created by the 1-click sandbox simulator. */
  simulatedAuth: boolean;
  authorizedAt: string | null;
  authorizationExpiresAt: string | null;
  capturedAmount: number | null;
  releasedToClient: number | null;
  paymentError: string | null;
  settlement: Settlement | null;
  isProcessingPayment: boolean;
  searchQuery: string | null;
  maxBudget: number | null;
  reason: string | null;
  candidates: Product[];
  product: Product | null;
  recommendation?: ProductRecommendation | null;
  /** The dates the AI originally planned, kept so schedule slippage can be shown as a baseline. */
  plannedStartDate?: string;
  plannedEndDate?: string;
  /** Demo hook: simulated live price after a Channel3 price spike. */
  livePriceOverride: number | null;
}

export interface ScopeRequirement {
  text: string;
  /** True when the client did not say it but the project cannot work without it. */
  implied: boolean;
  /** Titles of the milestones that deliver this requirement. */
  milestones: string[];
}

/** How the Scope Architect understood the brief and which self-checks the plan passed. */
export interface ScopeInsight {
  engine: "openai" | "demo-engine";
  summary: string;
  requirements: ScopeRequirement[];
  checks: string[];
  note: string | null;
}

export interface Project {
  id: string;
  scenarioKey: string | null;
  title: string;
  prompt: string;
  totalBudget: number;
  clientEmail: string;
  freelancerEmail: string;
  createdAt: string;
  scope?: ScopeInsight;
}

export interface ProjectBundle {
  project: Project;
  items: LedgerItem[];
}

export interface AuditLogEntry {
  id: number;
  projectId: string;
  itemId: string | null;
  ts: string;
  level: "INFO" | "WARN" | "ALERT";
  kind: string;
  message: string;
}

export interface ApiTelemetryEntry {
  id: number;
  projectId: string | null;
  itemId: string | null;
  ts: string;
  operation: string;
  simulated: boolean;
  source?: "official-sdk" | "rest" | "simulator";
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  status: number;
  responseBody: unknown;
  latencyMs: number;
  requestId: string | null;
}

export interface ScopeMilestone {
  id: string;
  title: string;
  type: "DELIVERABLE";
  amount: number;
  startDate: string;
  endDate: string;
  dependencies: string[];
  acceptanceCriteria: string[];
}

export interface ScopeProcurementItem {
  id: string;
  searchQuery: string;
  maxBudget: number;
  reason: string;
}

export interface ScopePlan {
  projectTitle: string;
  totalBudget: number;
  milestones: ScopeMilestone[];
  procurementItems: ScopeProcurementItem[];
}

export interface EnvStatus {
  paypalLive: boolean;
  openai: boolean;
  channel3: boolean;
  paypalEnv: "sandbox" | "live";
  simulationMode: boolean;
  /** False when the server runs with ENABLE_DEMO_TOOLS=false (production). */
  demoTools: boolean;
  missing: string[];
}
