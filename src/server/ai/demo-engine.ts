import { keywords } from "../../shared/keywords";

export interface CriterionEvaluation {
  criterion: string;
  score: number;
  evidence: string;
  fix: string;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const TIER_NAMES = [
  "starter", "basic", "free", "hobby", "pro", "professional", "business", "team", "growth", "premium", "plus", "enterprise", "scale",
];

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

function requiredCount(criterion: string, fallback: number): number {
  const m = criterion.match(/\b(\d+|one|two|three|four|five|six)\b\s+(?:distinct\s+|different\s+|separate\s+)?(?:pricing\s+)?(?:tiers?|plans?|videos?|scripts?|findings?|sections?)/i);
  if (!m) return fallback;
  const raw = m[1].toLowerCase();
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return n && n > 0 ? n : fallback;
}

function evalTiers(criterion: string, text: string): CriterionEvaluation {
  const need = requiredCount(criterion, 3);
  const lower = text.toLowerCase();
  const found = TIER_NAMES.filter((n) => new RegExp(`\\b${n}\\b`).test(lower));
  const score = clamp((Math.min(found.length, need) / need) * 100);
  return {
    criterion,
    score,
    evidence: `${found.length} pricing tier(s) found${found.length ? `: ${found.join(", ")}` : ""} (need ${need})`,
    fix: found.length >= need ? "" : `Add ${need - found.length} more distinct pricing tier card(s) (e.g. Starter, Pro, Enterprise) with their own price and feature list.`,
  };
}

function evalBillingToggle(criterion: string, text: string): CriterionEvaluation {
  const lower = text.toLowerCase();
  let score = 0;
  const parts: string[] = [];
  const missing: string[] = [];
  if (/\bmonthly\b/.test(lower)) { score += 15; parts.push("monthly"); } else missing.push("a Monthly option");
  if (/\b(annual|annually|yearly)\b/.test(lower)) { score += 15; parts.push("annual"); } else missing.push("an Annual option");
  if (/usestate|onclick|onchange|checked|role=["']switch["']|type=["']checkbox["']|addeventlistener|\bv-model\b|\bngmodel\b/.test(lower)) {
    score += 30; parts.push("toggle state/handler");
  } else missing.push("a toggle control with state (e.g. useState + onClick)");
  if (/discount|save\s*\d+\s*%|\b0\.[5-9]\d?\s*\*|\*\s*0\.[5-9]\d?|\b\d{1,2}\s*%\s*(off|discount)|\*\s*12/.test(lower)) {
    score += 25; parts.push("discount calculation");
  } else missing.push("an annual discount calculation (e.g. monthly * 12 * 0.8)");
  if (/(isannual|annual|yearly|billing|interval|cycle)\s*(\?|===|==|&&)/.test(lower) || /\?\s*[^:]{0,60}(annual|yearly)/.test(lower)) {
    score += 15; parts.push("price switches on toggle");
  } else missing.push("prices that change when the toggle changes");
  return {
    criterion,
    score: clamp(score),
    evidence: parts.length ? `Verified: ${parts.join(", ")}` : "No billing toggle logic detected",
    fix: missing.length ? `Billing toggle is missing ${missing.join("; ")}.` : "",
  };
}

function evalDarkMode(criterion: string, text: string): CriterionEvaluation {
  const darkClasses = countMatches(text, /\bdark:[\w[\]#:/.-]+/g);
  const prefers = /prefers-color-scheme\s*:\s*dark/i.test(text) || /classList\.(add|toggle)\(\s*["']dark["']/i.test(text) || /class(Name)?=["'][^"']*\bdark\b(?!:)/i.test(text);
  const cssVars = /var\(--[\w-]+\)/.test(text) || /^\s*--[\w-]+\s*:/m.test(text);
  let score = Math.min(70, darkClasses * 14);
  if (prefers) score += 15;
  if (cssVars) score += 15;
  const parts = [`${darkClasses} dark: utility class(es)`];
  if (prefers) parts.push("dark mode switch/media query");
  if (cssVars) parts.push("CSS variables");
  return {
    criterion,
    score: clamp(score),
    evidence: darkClasses || prefers || cssVars ? `Found ${parts.join(", ")}` : "No dark mode classes or CSS variables detected",
    fix: score >= 80 ? "" : "Add dark mode support: add `dark:` Tailwind variants (e.g. dark:bg-slate-900 dark:text-white) to the page, cards and buttons, or define CSS variables for a dark theme.",
  };
}

function evalSeverity(criterion: string, text: string): CriterionEvaluation {
  const levels = ["critical", "high", "medium", "low", "informational"].filter((l) => new RegExp(`\\b${l}\\b`, "i").test(text));
  const score = clamp((Math.min(levels.length, 3) / 3) * 100);
  return {
    criterion,
    score,
    evidence: `${levels.length} severity level(s) used${levels.length ? `: ${levels.join(", ")}` : ""}`,
    fix: levels.length >= 3 ? "" : "Rate every finding with an explicit severity (Critical / High / Medium / Low) and use at least three levels.",
  };
}

function evalUnitTests(criterion: string, text: string): CriterionEvaluation {
  const framework = /\b(describe|jest|vitest|mocha|pytest|forge|hardhat|chai)\b/i.test(text);
  const cases = countMatches(text, /\b(it|test)\s*\(|\bdef test_|function test[A-Z_]/g);
  const asserts = countMatches(text, /\b(expect|assert\w*)\s*[.(]/g);
  const score = clamp((framework ? 30 : 0) + Math.min(40, cases * 10) + Math.min(30, asserts * 6));
  return {
    criterion,
    score,
    evidence: `${cases} test case(s), ${asserts} assertion(s)${framework ? ", test framework detected" : ""}`,
    fix: score >= 80 ? "" : "Provide runnable unit tests: use a test framework, add at least 4 test cases and assert on expected results (including failure paths).",
  };
}

function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/i, "");
}

function evalGeneric(criterion: string, text: string): CriterionEvaluation {
  const kws = keywords(criterion);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (kws.length === 0 || words < 5) {
    return { criterion, score: 0, evidence: "Deliverable is too short to evaluate", fix: `Provide substantive content addressing: "${criterion}".` };
  }
  const lower = text.toLowerCase();
  const hit = kws.filter((k) => lower.includes(stem(k)));
  const coverage = hit.length / kws.length;
  const lengthFactor = Math.min(1, words / 40);
  const score = clamp(Math.min(95, coverage * 100) * (0.5 + 0.5 * lengthFactor));
  const miss = kws.filter((k) => !hit.includes(k));
  return {
    criterion,
    score,
    evidence: `${hit.length}/${kws.length} key requirement terms addressed${miss.length ? ` (missing: ${miss.slice(0, 5).join(", ")})` : ""}`,
    fix: score >= 80 ? "" : `Address "${criterion}" explicitly${miss.length ? ` - cover: ${miss.slice(0, 5).join(", ")}` : ""}.`,
  };
}

/** Deterministic rule-based criterion evaluator used when no LLM key is configured. */
export function evaluateCriterionDemo(criterion: string, submission: string): CriterionEvaluation {
  const c = criterion.toLowerCase();
  if (/\btiers?\b/.test(c) && /pricing|plan/.test(c)) return evalTiers(criterion, submission);
  if (/toggle|monthly|annual/.test(c)) return evalBillingToggle(criterion, submission);
  if (/dark mode|dark:|css variables?/.test(c)) return evalDarkMode(criterion, submission);
  if (/severity/.test(c)) return evalSeverity(criterion, submission);
  if (/unit tests?|test suite/.test(c)) return evalUnitTests(criterion, submission);
  return evalGeneric(criterion, submission);
}
