export interface InjectionScan {
  flagged: boolean;
  findings: string[];
}

interface Rule {
  id: string;
  severity: "high" | "medium";
  re: RegExp;
}

const RULES: Rule[] = [
  { id: "override-previous-instructions", severity: "high", re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(all\s+)?(previous|prior|above|earlier|system|your)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|criteria)\b/i },
  { id: "force-score", severity: "high", re: /\b(output|return|give|assign|set|award|print)\b[^.\n]{0,30}\b(score|grade|rating|verdict)\b[^.\n]{0,20}\b(100|perfect|max(imum)?|pass(ing)?|approved?)\b/i },
  { id: "score-assignment", severity: "medium", re: /\bscore\s*[:=]\s*(100|9\d)\b/i },
  { id: "force-payment-release", severity: "high", re: /\b(release|send|transfer|capture|approve|execute|trigger)\b[^.\n]{0,30}\b(paypal|payout|payment|funds?|escrow|money)\b[^.\n]{0,20}\b(now|immediately|right away|asap)\b/i },
  { id: "payment-release-command", severity: "medium", re: /\b(release|capture|pay\s*out)\b[^.\n]{0,25}\b(the\s+)?(paypal\s+)?(payout|payment|funds?|escrow)\b/i },
  { id: "role-hijack", severity: "high", re: /\b(you are now|pretend (to be|you are)|new role|from now on,? you|act as (an? |the )?(auditor|judge|grader|reviewer|ai|assistant|system|admin))\b/i },
  { id: "system-prompt-probe", severity: "medium", re: /\b(system prompt|developer message|reveal your (instructions|prompt))\b/i },
  { id: "fake-system-tag", severity: "high", re: /(\[\s*(system|admin|developer)\s*\]|<\|?\s*(im_start|system|assistant)\s*\|?>|###\s*(system|instruction))/i },
  { id: "skip-audit", severity: "high", re: /\b(skip|bypass|no need to)\b[^.\n]{0,20}\b(audit|grading|verification|review)\b/i },
  { id: "auto-approve", severity: "high", re: /\b(auto[- ]?approve (this|the)|mark (this|the) (deliverable |submission |milestone )?as (passed|approved|complete(d)?)|already (been )?(approved|verified) by)\b/i },
];

/** Normalizes obfuscation (zero-width chars, homoglyph/width variants, spaced letters) before scanning. */
export function normalizeForScan(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u2060\uFEFF\u202A-\u202E]/g, "")
    .replace(/\s+/g, " ");
}

export function scanForPromptInjection(submission: string): InjectionScan {
  const normalized = normalizeForScan(submission);
  const findings: string[] = [];
  let highs = 0;
  let mediums = 0;
  for (const rule of RULES) {
    const m = normalized.match(rule.re);
    if (m) {
      findings.push(`${rule.id}: "${m[0].slice(0, 80)}"`);
      if (rule.severity === "high") highs++;
      else mediums++;
    }
  }
  return { flagged: highs >= 1 || mediums >= 2, findings };
}
