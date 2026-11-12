import { extOf, isConfigPath, isDocPath, isSourcePath, isTestPath } from "../../shared/source";
import { keywords } from "../../shared/keywords";
import type { Citation } from "../../shared/types";
import type { SourceBundle, SourceFile } from "../ingest/bundle";
import type { Forensics } from "./forensics";

export type CriterionKind = "tests" | "deploy" | "docs" | "feature";

export interface Snippet {
  file: string;
  start: number;
  end: number;
  text: string;
}

export interface Finding {
  criterion: string;
  score: number;
  evidence: string;
  fix: string;
  citations: Citation[];
}

interface Concept {
  when: RegExp;
  label: string;
  code: RegExp;
}

/** What each requirement looks like in real code. Used to find evidence and, without an LLM, to score it. */
const CONCEPTS: Concept[] = [
  { when: /\b(log ?in|sign ?in|authenticat\w*|credentials?)\b/i, label: "login", code: /\b(login|log_in|signin|sign_in|authenticate|passport|next-?auth|jwt|jsonwebtoken|useAuth|signInWith\w*)\b/i },
  { when: /\b(register\w*|sign ?up|accounts?)\b/i, label: "registration", code: /\b(register|signup|sign_up|createUser|create_user|users?\.(create|insert|add)|new_user)\b/i },
  { when: /\b(passwords?|hash\w*|encrypt\w*)\b/i, label: "password hashing", code: /\b(bcrypt|argon2|scrypt|pbkdf2|hashSync|generate_password_hash|make_password|crypto\.createHash)\b/i },
  { when: /\b(sessions?|logout|expire\w*)\b/i, label: "sessions", code: /\b(session|cookie|logout|log_out|signOut|expires?|maxAge|token)\b/i },
  { when: /\b(admin|roles?|permissions?|authori[sz]\w*|blocked)\b/i, label: "role-based access", code: /\b(admin|isAdmin|is_admin|role|roles|permissions?|requireAdmin|rbac|admin_required|authorize|forbidden|403)\b/i },
  { when: /\b(products?|catalog|items?|menu)\b/i, label: "products", code: /\b(products?|catalog|items?|menu)\b/i },
  { when: /\b(cart|basket)\b/i, label: "cart", code: /\b(cart|basket|addToCart|add_to_cart)\b/i },
  { when: /\b(checkout|orders?)\b/i, label: "orders", code: /\b(checkout|orders?|createOrder|place_order)\b/i },
  { when: /\b(payments?|pay|stripe|paypal)\b/i, label: "payments", code: /\b(stripe|paypal|payment|charge|checkout\.session|paymentIntent)\b/i },
  { when: /\b(inventory|stock|quantit\w+|warehouse)\b/i, label: "inventory", code: /\b(inventory|stock|quantity|qty|sku|warehouse|reorder|low_stock)\b/i },
  { when: /\b(profit|loss|revenue|margin|cost|sales)\b/i, label: "profit and loss", code: /\b(profit|loss|revenue|margin|cost_?price|costPrice|total_?cost|sales)\b/i },
  { when: /\b(reports?|reporting|analytics?|dashboard|charts?)\b/i, label: "reporting", code: /\b(report|analytics|dashboard|chart|summary|aggregate|groupBy|group_by|reduce)\b/i },
  { when: /\b(search|filter\w*|sort\w*)\b/i, label: "search and filter", code: /\b(search|filter|sort|query)\b/i },
  { when: /\b(date ranges?|dates?)\b/i, label: "date range", code: /\b(date|startDate|endDate|from|to|range)\b.*\b(date|range|filter)\b|\bdate_?range\b|\btype=["']date["']/i },
  { when: /\b(responsive|mobile)\b/i, label: "responsive layout", code: /@media|\b(sm|md|lg|xl):|flex-wrap|grid-template|viewport|useMediaQuery/i },
  { when: /\bdark\b/i, label: "dark mode", code: /\bdark:|prefers-color-scheme|data-theme|classList\.(add|toggle)\(\s*["']dark|useTheme|color-scheme/i },
  { when: /\b(toggle|switch)\b/i, label: "toggle control", code: /toggle|aria-(pressed|checked)|role=["']switch|type=["']checkbox/i },
  { when: /\b(monthly|annual|yearly|billing)\b/i, label: "billing period", code: /\b(monthly|annual|annually|yearly|billing)\b/i },
  { when: /\b(tiers?|plans?|pricing)\b/i, label: "pricing tiers", code: /\b(pricing|tiers?|subscription)\b/i },
  { when: /\b(databases?|schema|entit\w+|tables?|data model)\b/i, label: "data layer", code: /CREATE TABLE|\b(prisma|sequelize|mongoose|typeorm|sqlalchemy|knex|drizzle|sqlite|postgres|mongodb|better-sqlite3)\b|\bSchema\(|\bmodels?\./i },
  { when: /\b(api|endpoints?|routes?)\b/i, label: "API routes", code: /\bapp\.(get|post|put|delete|patch)\b|\brouter\.|@app\.route|@(Get|Post|Put|Delete)\(|export (async )?function (GET|POST|PUT|DELETE)|\bfetch\(/ },
  { when: /\b(validat\w+|sanitiz\w+)\b/i, label: "validation", code: /\b(zod|yup|joi|validate|validator|sanitize|isEmail)\b/i },
  { when: /\b(notifications?|e-?mail (alerts?|notifications?|confirmations?|receipts?))\b/i, label: "notifications", code: /\b(email|mailer|nodemailer|sendgrid|notification|notify)\b/i },
  { when: /\b(upload\w*|images?)\b/i, label: "uploads", code: /\b(upload|multer|formData|image|<img|next\/image)\b/i },
  { when: /\b(errors?|exceptions?)\b/i, label: "error handling", code: /\b(try\s*\{|catch\s*\(|except\s|errorHandler|onError|error\.tsx)\b/i },
  { when: /\b(pagination|paginate)\b/i, label: "pagination", code: /\b(paginat\w+|page|limit|offset|skip|take)\b/i },
  { when: /\b(accessib\w+|aria|semantic|focus)\b/i, label: "accessibility", code: /\baria-|role=|\balt=|<(main|nav|header|footer|section|article)\b|:focus-visible|\bsr-only\b/i },
  { when: /\b(design tokens?|css variables?|theme|typography|colors?|spacing)\b/i, label: "design tokens", code: /--[\w-]+\s*:|:root|\btokens?\b|theme\b|\bspacing\b/i },
  { when: /\b(hero|call to action|cta)\b/i, label: "hero and call to action", code: /\bhero\b|\bcta\b|call-to-action|get started|sign up|buy now/i },
  { when: /\b(videos?|captions?|subtitles?|scripts?|storyboards?)\b/i, label: "media assets", code: /\b(script|storyboard|caption|subtitle|shot list|hook)\b/i },
  { when: /\b(vulnerab\w+|exploit\w*|reentrancy|overflow|injection)\b/i, label: "vulnerability analysis", code: /\b(reentrancy|overflow|underflow|injection|access control|exploit|vulnerab\w+)\b/i },
  { when: /\b(language|translat\w+|locali[sz]\w*|i18n)\b/i, label: "localization", code: /\b(i18n|locale|translate|intl|messages\.\w+)\b/i },
];

/** Words that appear in many criteria but say nothing about what was built. */
const GENERIC = new Set([
  "support", "separate", "customers", "customer", "screens", "screen", "named", "entities", "stored", "brief", "list", "main", "path", "users", "user",
  "flows", "flow", "journeys", "journey", "roles", "document", "documented", "automated", "reachable", "deployed", "instructions", "source", "files",
  "summary", "handoff", "feedback", "incorporate", "functionality", "described", "feature", "features", "build", "tests", "testing", "basic", "simple",
  "working", "clear", "clearly", "every", "distinct", "number", "total", "names", "name", "price", "prices",
  "whose", "their", "levels", "level", "automatically", "placed", "blocked", "between", "within", "without", "other", "others", "added", "adding", "show", "shows", "allow", "allows",
  "implement", "implements", "calculation", "classes", "variables", "starter", "enterprise", "example", "examples", "least", "logic", "control", "controls",
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function criterionKind(criterion: string): CriterionKind {
  if (/\b(automated |unit |integration )?tests?\b|test suite|coverage|\bspecs?\b/i.test(criterion)) return "tests";
  if (/deploy\w*|hosted|reachable|docker|ci\/cd|pipeline|production url|live url/i.test(criterion)) return "deploy";
  if (/\b(document\w*|readme|hand-?off|wireframes?|prototype|diagrams?|user (roles|journeys)|requirements|data model|setup|summary)\b/i.test(criterion)) return "docs";
  return "feature";
}

interface Group {
  label: string;
  re: RegExp;
  /** Requirements named by a recognised concept weigh more than loose keywords picked from the sentence. */
  weight: number;
}

export function conceptGroups(criterion: string): Group[] {
  const groups: Group[] = CONCEPTS.filter((c) => c.when.test(criterion)).map((c) => ({ label: c.label, re: c.code, weight: 1 }));
  const covered = (word: string) => CONCEPTS.some((c) => c.when.test(word));
  const extra = keywords(criterion).filter((w) => w.length >= 5 && !GENERIC.has(w) && !covered(w)).slice(0, 3);
  for (const w of extra) groups.push({ label: w, re: new RegExp(`\\b${escapeRe(w.replace(/(ing|ed|es|s)$/i, ""))}\\w*`, "i"), weight: 0.4 });
  // Names listed in parentheses, e.g. "(Starter, Pro, Enterprise)", must actually appear in code.
  const listed = criterion.match(/\(([^)]{3,100})\)/)?.[1]?.split(/,|\bor\b|\band\b/i).map((s) => s.trim()).filter((s) => /^[A-Z][A-Za-z0-9 -]{1,20}$/.test(s)) ?? [];
  if (listed.length >= 2) groups.unshift({ label: `named items (${listed.join(", ")})`, re: new RegExp(`\\b(${listed.map(escapeRe).join("|")})\\b`, "i"), weight: 1 });
  return groups.slice(0, 8);
}

interface Hit {
  file: string;
  line: number;
  text: string;
  group: string;
}

const DEFINITION = /\b(function|class|def|const|let|export|async|func|interface|type|CREATE TABLE|app\.|router\.)\b/;

/** adminLogin and add_to_cart become "admin Login" and "add to cart" so word-based patterns see identifier parts. */
const splitIdentifiers = (t: string) => t.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");

function isCommentOrImport(t: string, ext: string): boolean {
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("<!--")) return true;
  if (["py", "rb", "sh", "yml", "yaml", "toml"].includes(ext) && t.startsWith("#")) return true;
  return /^(import\s|from\s+\S+\s+import\s|require\(|using\s|#include)/.test(t);
}

function findHits(files: SourceFile[], groups: Group[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files) {
    const ext = extOf(f.path);
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]?.trim() ?? "";
      if (t.length < 4 || (isCommentOrImport(t, ext) && !isDocPath(f.path))) continue;
      const spaced = splitIdentifiers(t);
      for (const g of groups) if (g.re.test(t) || g.re.test(spaced)) hits.push({ file: f.path, line: i + 1, text: t, group: g.label });
    }
  }
  return hits;
}

const toCitation = (h: Hit): Citation => ({ file: h.file, line: h.line, quote: h.text.slice(0, 160) });

function pickCitations(hits: Hit[], max = 4): Citation[] {
  const ranked = [...hits].sort((a, b) => Number(DEFINITION.test(b.text)) - Number(DEFINITION.test(a.text)));
  const out: Citation[] = [];
  const seenGroups = new Set<string>();
  const seenLines = new Set<string>();
  for (const h of ranked) {
    const key = `${h.file}:${h.line}`;
    if (seenLines.has(key) || (seenGroups.has(h.group) && out.length >= 2)) continue;
    seenGroups.add(h.group);
    seenLines.add(key);
    out.push(toCitation(h));
    if (out.length >= max) break;
  }
  return out;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function evalFeature(criterion: string, files: SourceFile[], extraNames: string[] = []): Finding {
  const groups = conceptGroups(criterion);
  if (groups.length === 0) {
    return { criterion, score: 0, evidence: "The criterion names nothing specific enough to look for in code.", fix: `Make the deliverable demonstrate: "${criterion}".`, citations: [] };
  }
  const hits = findHits(files, groups);
  const credits = new Map<string, number>();
  const found: string[] = [];
  const missing: string[] = [];
  for (const g of groups) {
    const gh = hits.filter((h) => h.group === g.label);
    const nameHit = extraNames.some((n) => g.re.test(n));
    const lines = new Set(gh.map((h) => `${h.file}:${h.line}`)).size;
    const fileCount = new Set(gh.map((h) => h.file)).size;
    if (lines >= 2 || (lines >= 1 && nameHit)) {
      credits.set(g.label, 1);
      found.push(`${g.label} (${lines} line${lines === 1 ? "" : "s"} in ${fileCount} file${fileCount === 1 ? "" : "s"})`);
    } else if (lines === 1) {
      credits.set(g.label, 0.5);
      found.push(`${g.label} (one mention)`);
    } else if (nameHit) {
      credits.set(g.label, 0.5);
      found.push(`${g.label} (file name only)`);
    } else {
      credits.set(g.label, 0);
      missing.push(g.label);
    }
  }
  const totalWeight = groups.reduce((s, g) => s + g.weight, 0);
  const earned = groups.reduce((s, g) => s + g.weight * (credits.get(g.label) ?? 0), 0);

  // A feature lives together: reward the file that covers the most requirements, so scattered keyword matches across a big repo do not add up to a pass.
  let bestFile = 0;
  let bestFileLines = 0;
  for (const file of new Set(hits.map((h) => h.file))) {
    const inFile = hits.filter((h) => h.file === file);
    const credit = groups.reduce((s, g) => {
      const n = new Set(inFile.filter((h) => h.group === g.label).map((h) => h.line)).size;
      return s + g.weight * (n >= 2 ? 1 : n === 1 ? 0.5 : 0);
    }, 0);
    if (credit / totalWeight > bestFile) {
      bestFile = credit / totalWeight;
      bestFileLines = new Set(inFile.map((h) => h.line)).size;
    }
  }
  const bonus = bestFileLines >= 6 ? 15 : 0;
  // "classes or CSS variables": one satisfied alternative is enough.
  const anyOf = /\b(or|either)\b/i.test(criterion) && groups.filter((g) => g.weight === 1).length > 1;
  const ratio = anyOf ? Math.max(...groups.filter((g) => g.weight === 1).map((g) => credits.get(g.label) ?? 0)) : 0.65 * bestFile + 0.35 * (earned / totalWeight);
  const score = clamp(Math.min(95, ratio * 80 + bonus));
  const important = anyOf && ratio > 0 ? [] : missing.filter((label) => groups.find((g) => g.label === label)?.weight === 1);
  const toFix = important.length > 0 ? important : missing;
  return {
    criterion,
    score,
    evidence: found.length ? `Found in code: ${found.join("; ")}${missing.length ? `. Not found: ${missing.join(", ")}` : ""}` : `No code related to ${groups.map((g) => g.label).join(", ")} was found`,
    fix: toFix.length ? `Implement and commit working code for: ${toFix.join(", ")}. Documentation alone does not count.` : "",
    citations: pickCitations(hits),
  };
}

function evalTests(criterion: string, f: Forensics, bundle: SourceBundle): Finding {
  if (f.testFiles.length === 0) {
    return { criterion, score: 0, evidence: "No test files were found", fix: "Add automated tests (for example *.test.ts or test_*.py) that cover the main flows, including failure paths.", citations: [] };
  }
  const caseRe = /\b(it|test)\s*\(|\bdef test_|\bfunc Test\w+|@Test\b|#\[test\]/;
  const assertRe = /\b(expect|assert\w*|should)\b\s*[.(]|\bt\.(Fatal|Error)/;
  let cases = 0;
  let asserts = 0;
  const cited: Citation[] = [];
  for (const t of f.testFiles) {
    t.content.split("\n").forEach((line, i) => {
      if (caseRe.test(line)) {
        cases++;
        if (cited.length < 3) cited.push({ file: t.path, line: i + 1, quote: line.trim().slice(0, 160) });
      }
      if (assertRe.test(line)) asserts++;
    });
  }
  const pkg = bundle.files.find((x) => x.path === "package.json")?.content ?? "";
  const reqs = bundle.files.find((x) => x.path === "requirements.txt")?.content ?? "";
  const framework = /\b(jest|vitest|mocha|playwright|cypress|ava|tap|node:test)\b/.test(pkg + f.testFiles.map((t) => t.content.slice(0, 400)).join("\n")) || /pytest|unittest/.test(reqs + f.testFiles.map((t) => t.content.slice(0, 200)).join("\n")) || /"test"\s*:/.test(pkg);
  const score = clamp((framework ? 25 : 0) + Math.min(45, cases * 12) + Math.min(30, asserts * 6));
  return {
    criterion,
    score,
    evidence: `${f.testFiles.length} test file(s), ${cases} test case(s), ${asserts} assertion(s)${framework ? ", test runner configured" : ""}`,
    fix: score >= 80 ? "" : "Add more test cases with real assertions, cover failure paths, and make sure a test command is configured.",
    citations: cited,
  };
}

const DEPLOY_FILES: Array<[RegExp, string]> = [
  [/(^|\/)dockerfile$/i, "Dockerfile"],
  [/(^|\/)docker-compose\.ya?ml$/i, "docker-compose"],
  [/(^|\/)render\.ya?ml$/i, "render.yaml"],
  [/(^|\/)vercel\.json$/i, "vercel.json"],
  [/(^|\/)netlify\.toml$/i, "netlify.toml"],
  [/(^|\/)fly\.toml$/i, "fly.toml"],
  [/(^|\/)procfile$/i, "Procfile"],
  [/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i, "CI workflow"],
];

function evalDeploy(criterion: string, bundle: SourceBundle): Finding {
  const found: Array<{ label: string; path: string }> = [];
  for (const f of bundle.files) for (const [re, label] of DEPLOY_FILES) if (re.test(f.path) && !found.some((x) => x.label === label)) found.push({ label, path: f.path });
  const readme = bundle.files.find((f) => /^readme/i.test(f.path));
  const urlLine = readme?.content.split("\n").findIndex((l) => /https?:\/\/(?!localhost|127\.|github\.com|img\.shields|shields\.io)/i.test(l) && /(demo|live|deployed|hosted|url|visit)/i.test(l));
  const hasUrl = urlLine !== undefined && urlLine >= 0;
  const score = clamp(Math.min(85, found.length * 30 + (hasUrl ? 30 : 0)));
  const citations: Citation[] = found.slice(0, 3).map((x) => ({ file: x.path, line: 1, quote: (bundle.files.find((f) => f.path === x.path)?.content.split("\n")[0] ?? "").trim().slice(0, 160) })).filter((c) => c.quote.length >= 3);
  if (hasUrl && readme && urlLine !== undefined) citations.push({ file: readme.path, line: urlLine + 1, quote: (readme.content.split("\n")[urlLine] ?? "").trim().slice(0, 160) });
  return {
    criterion,
    score,
    evidence: found.length || hasUrl ? `Deployment signals: ${[...found.map((x) => x.label), ...(hasUrl ? ["live URL in README"] : [])].join(", ")} (reachability cannot be verified from files alone)` : "No deployment configuration or live URL was found",
    fix: score >= 80 ? "" : "Add deployment configuration (Dockerfile, render.yaml, CI workflow) and put the live URL in the README.",
    citations,
  };
}

function evalDocs(criterion: string, bundle: SourceBundle, f: Forensics): Finding {
  const readme = bundle.files.find((x) => /^readme/i.test(x.path));
  const docLike = bundle.files.filter((x) => isDocPath(x.path) || /(schema|models?|migrations?)/i.test(x.path) || /\.(prisma|sql)$/i.test(x.path));
  const assets = bundle.binaryPaths.filter((p) => /(wireframe|mockup|prototype|design|figma|diagram|flow|screens?|docs?)/i.test(p));
  const base = evalFeature(criterion, docLike, assets);
  const readmeLines = readme ? readme.content.split("\n").filter((l) => l.trim()).length : 0;
  const hasSetup = readme ? /(install|getting started|setup|run|usage)/i.test(readme.content) : false;
  const readmeScore = (readme ? 10 : 0) + (readmeLines >= 15 ? 10 : 0) + (hasSetup ? 10 : 0);
  const sourceNote = f.sourceFiles.length > 0 ? "" : " No source files accompany the documents.";
  const score = clamp(Math.min(95, base.score * 0.7 + readmeScore));
  return {
    criterion,
    score,
    evidence: `${base.evidence}. README ${readme ? `has ${readmeLines} lines${hasSetup ? " and setup instructions" : ""}` : "is missing"}${assets.length ? `; ${assets.length} design asset(s)` : ""}.${sourceNote}`,
    fix: score >= 80 ? "" : `${base.fix} ${readme ? "" : "Add a README with setup and usage instructions."}`.trim(),
    citations: base.citations,
  };
}

/** Deterministic, evidence-backed evaluation. Used when no model is configured and as the floor of reasoning when one is. */
export function evaluateCriterionRepo(criterion: string, bundle: SourceBundle, forensics: Forensics): Finding {
  const kind = criterionKind(criterion);
  if (kind === "tests") return evalTests(criterion, forensics, bundle);
  if (kind === "deploy") return evalDeploy(criterion, bundle);
  if (kind === "docs") return evalDocs(criterion, bundle, forensics);
  return evalFeature(criterion, forensics.sourceFiles.length > 0 ? forensics.sourceFiles : forensics.docFiles);
}

/** Code windows around the best matches for one criterion, for the model to read. */
export function retrieveSnippets(criterion: string, bundle: SourceBundle, forensics: Forensics, opts: { maxChars?: number; radius?: number; maxFiles?: number } = {}): Snippet[] {
  const maxChars = opts.maxChars ?? 6000;
  const radius = opts.radius ?? 6;
  const kind = criterionKind(criterion);
  const pool: SourceFile[] =
    kind === "tests" ? forensics.testFiles
    : kind === "deploy" ? bundle.files.filter((f) => isConfigPath(f.path) || /^readme/i.test(f.path))
    : kind === "docs" ? bundle.files.filter((f) => isDocPath(f.path) || /(schema|models?)/i.test(f.path))
    : forensics.sourceFiles.length > 0 ? forensics.sourceFiles : forensics.docFiles;
  const groups = conceptGroups(criterion);
  const hits = groups.length ? findHits(pool, groups) : [];

  const perFile = new Map<string, number[]>();
  for (const h of hits) perFile.set(h.file, [...(perFile.get(h.file) ?? []), h.line]);
  const ranked = [...perFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, opts.maxFiles ?? 5);

  const out: Snippet[] = [];
  let chars = 0;
  for (const [file, lineNos] of ranked) {
    const src = pool.find((f) => f.path === file);
    if (!src) continue;
    const lines = src.content.split("\n");
    const windows: Array<[number, number]> = [];
    for (const n of [...new Set(lineNos)].slice(0, 12)) {
      const s = Math.max(1, n - radius);
      const e = Math.min(lines.length, n + radius);
      const last = windows[windows.length - 1];
      if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
      else windows.push([s, e]);
    }
    for (const [s, e] of windows.slice(0, 2)) {
      const text = lines.slice(s - 1, e).join("\n");
      if (chars + text.length > maxChars) return out;
      chars += text.length;
      out.push({ file, start: s, end: e, text });
    }
  }
  if (out.length === 0) {
    // Nothing matched: show the opening of the largest pool files so the model can say what is actually there.
    for (const f of [...pool].sort((a, b) => b.content.length - a.content.length).slice(0, 2)) {
      const text = f.content.split("\n").slice(0, 40).join("\n");
      if (chars + text.length > maxChars) break;
      chars += text.length;
      out.push({ file: f.path, start: 1, end: Math.min(40, f.lines), text });
    }
  }
  return out;
}

/** Keeps only quotes that really occur in the named file, so the model cannot cite code that does not exist. */
export function verifyCitations(bundle: SourceBundle, raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];
  const out: Citation[] = [];
  const byPath = new Map(bundle.files.map((f) => [f.path, f]));
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const { file, quote } = c as { file?: unknown; quote?: unknown };
    if (typeof file !== "string" || typeof quote !== "string") continue;
    const f = byPath.get(file.replace(/^\.?\//, ""));
    const q = norm(quote);
    if (!f || q.length < 10 || q.length > 400) continue;
    const whole = norm(f.content);
    if (!whole.includes(q)) continue;
    const firstLine = norm(quote.split("\n").find((l) => norm(l).length >= 8) ?? q);
    const idx = f.content.split("\n").findIndex((l) => norm(l).includes(firstLine));
    if (idx < 0 || out.some((o) => o.file === f.path && o.line === idx + 1)) continue;
    out.push({ file: f.path, line: idx + 1, quote: q.slice(0, 160) });
  }
  return out.slice(0, 5);
}

/** The highest score a criterion may receive given how much of its evidence was verified. */
export function evidenceCap(criterion: string, citations: Citation[]): { cap: number; note: string } {
  const kind = criterionKind(criterion);
  const inKind = citations.filter((c) =>
    kind === "tests" ? isTestPath(c.file)
    : kind === "deploy" ? isConfigPath(c.file) || isDocPath(c.file)
    : kind === "docs" ? true
    : isSourcePath(c.file) || isTestPath(c.file),
  ).length;
  // One substantial quote (a full statement or several lines) proves as much as two stray lines.
  const substantial = citations.some((c) => c.quote.length >= 60);
  if (inKind >= 2 || (inKind >= 1 && substantial) || (kind === "deploy" && inKind >= 1) || (kind === "docs" && inKind >= 1)) return { cap: 100, note: "" };
  if (inKind === 1) return { cap: 70, note: "only one verified code citation" };
  return { cap: citations.length > 0 ? 35 : 20, note: "no verified code evidence (claims in documentation do not count)" };
}
