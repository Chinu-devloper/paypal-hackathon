import { extOf, isConfigPath, isDocPath, isSourcePath, isTestPath } from "../../shared/source";
import type { IntegrityFlag, SourceSummary } from "../../shared/types";
import type { SourceBundle, SourceFile } from "../ingest/bundle";
import { scanForPromptInjection } from "./injection";

export interface Cap {
  value: number;
  reason: string;
}

export interface Forensics {
  summary: SourceSummary;
  flags: IntegrityFlag[];
  caps: Cap[];
  injectionFindings: string[];
  sourceFiles: SourceFile[];
  testFiles: SourceFile[];
  docFiles: SourceFile[];
  substantiveLines: number;
}

export interface ForensicsContext {
  /** Milestone start date (YYYY-MM-DD); commits before it do not count as work on this contract. */
  milestoneStart: string;
  criteria: string[];
}

const LANGUAGES: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", py: "Python", rb: "Ruby",
  go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", swift: "Swift", php: "PHP", cs: "C#", c: "C", h: "C", cpp: "C++", hpp: "C++", sol: "Solidity",
  html: "HTML", htm: "HTML", css: "CSS", scss: "CSS", sass: "CSS", less: "CSS", vue: "Vue", svelte: "Svelte", astro: "Astro", sql: "SQL",
  sh: "Shell", bash: "Shell", ps1: "PowerShell", dart: "Dart", prisma: "Prisma", graphql: "GraphQL", gql: "GraphQL",
};

const HASH_COMMENT_EXT = new Set(["py", "rb", "sh", "bash", "yml", "yaml", "toml", "ps1", "r", "ex", "exs"]);

const PLACEHOLDER = /\b(TODO|FIXME|XXX)\b|lorem ipsum|not (yet )?implemented|coming soon|your code (goes )?here|implement (me|this|later)|placeholder (text|content|image|data)/i;

const STUB_PATTERNS: RegExp[] = [
  /(?:function\s+\w+\s*\([^)]*\)|\b\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)\s*\{\s*(?:\/\/[^\n]*)?\s*\}/g,
  /def\s+\w+\([^)]*\)\s*(?:->\s*[^:]+)?:\s*\n\s*(?:pass|\.\.\.)\s*(?:\n|$)/g,
  /raise\s+NotImplementedError/g,
  /throw\s+new\s+Error\(\s*["'`]\s*not implemented/gi,
];

const FUNCTION_COUNT = /\bfunction\s+\w+|=>\s*\{|\bdef\s+\w+|\bfunc\s+\w+/g;

const TEMPLATE_MARKERS: RegExp[] = [
  /get started by editing/i,
  /welcome to next\.js/i,
  /edit\s*<code>\s*src\/app/i,
  /vite \+ react/i,
  /to get started, edit/i,
  /this project was bootstrapped with create react app/i,
  /hello,? world/i,
  /you are running this application in/i,
];

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["GitHub token", /\bghp_[A-Za-z0-9]{36}\b/],
  ["API secret key", /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
];

const CODE_EXPECTED = /\b(app|application|website|web ?site|api|endpoints?|components?|log ?in|auth\w*|database|functions?|modules?|implement\w*|build|code|front-?end|back-?end|admin|checkout|cart|dashboard|server|scripts?|librar(y|ies)|sdk|routes?)\b/i;

const MS_DAY = 86_400_000;

function isCommentLine(line: string, ext: string): boolean {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("<!--")) return true;
  if (HASH_COMMENT_EXT.has(ext) && t.startsWith("#")) return true;
  return ext === "sql" && t.startsWith("--");
}

const isNoise = (t: string) => t.length <= 2;

interface LineStats {
  substantive: number;
  comments: number;
  placeholders: number;
  unique: Set<string>;
}

function statsFor(files: SourceFile[]): LineStats {
  const s: LineStats = { substantive: 0, comments: 0, placeholders: 0, unique: new Set() };
  for (const f of files) {
    const ext = extOf(f.path);
    for (const raw of f.content.split("\n")) {
      const t = raw.trim();
      if (!t) continue;
      if (isCommentLine(t, ext)) {
        s.comments++;
        continue;
      }
      if (isNoise(t)) continue;
      s.substantive++;
      s.unique.add(t.replace(/\s+/g, " ").toLowerCase());
      if (PLACEHOLDER.test(t)) s.placeholders++;
    }
  }
  return s;
}

interface Surface {
  path: string;
  /** Text a model would read as running prose: documentation, config and code comments. */
  prose: string;
  /** Fenced code, inline code and quoted strings, where a document is usually describing an attack rather than making one. */
  quoted: string;
}

function splitQuoted(text: string): { prose: string; quoted: string } {
  const quoted: string[] = [];
  const take = (m: string) => {
    quoted.push(m);
    return " ";
  };
  const prose = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, take).replace(/`[^`\n]{1,400}`/g, take).replace(/["“][^"”\n]{8,400}["”]/g, take);
  return { prose, quoted: quoted.join("\n") };
}

/** Where an attacker can talk to the auditor: documentation, config and code comments. Plain code is excluded so security tooling is not flagged. */
function promptSurfaces(files: SourceFile[]): Surface[] {
  const out: Surface[] = [];
  for (const f of files) {
    if (isDocPath(f.path) || isConfigPath(f.path)) {
      out.push({ path: f.path, ...splitQuoted(f.content.slice(0, 60_000)) });
      continue;
    }
    const ext = extOf(f.path);
    const comments = f.content.split("\n").filter((l) => isCommentLine(l, ext)).join("\n");
    if (comments) out.push({ path: f.path, ...splitQuoted(comments.slice(0, 20_000)) });
  }
  return out;
}

function scanSurfaces(files: SourceFile[]): { prose: string[]; quotedFiles: string[] } {
  const prose: string[] = [];
  const quotedFiles: string[] = [];
  for (const s of promptSurfaces(files)) {
    const direct = scanForPromptInjection(s.prose);
    if (direct.flagged) prose.push(...direct.findings.map((f) => `${s.path}: ${f}`));
    else if (s.quoted && scanForPromptInjection(s.quoted).flagged) quotedFiles.push(s.path);
  }
  return { prose, quotedFiles };
}

function dependencyStuffing(files: SourceFile[], source: SourceFile[]): IntegrityFlag | null {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return null;
  let deps: string[] = [];
  try {
    const json = JSON.parse(pkg.content) as { dependencies?: Record<string, string> };
    deps = Object.keys(json.dependencies ?? {});
  } catch {
    return null;
  }
  if (deps.length < 10) return null;
  const code = source.map((f) => f.content).join("\n");
  const used = deps.filter((d) => code.includes(`"${d}`) || code.includes(`'${d}`) || code.includes(`from ${d}`));
  if (used.length / deps.length >= 0.2) return null;
  return { id: "dependency-stuffing", severity: "warn", message: `package.json lists ${deps.length} dependencies but only ${used.length} are imported anywhere in the source.` };
}

function provenance(bundle: SourceBundle, ctx: ForensicsContext, flags: IntegrityFlag[], caps: Cap[]): void {
  const meta = bundle.meta;
  if (!meta) {
    if (bundle.origin.kind === "upload") flags.push({ id: "no-history", severity: "info", message: "Uploaded files carry no commit history, so authorship and timing cannot be verified. Ask for a repository link or a live demo as well." });
    return;
  }
  const start = Date.parse(`${ctx.milestoneStart}T00:00:00Z`) - MS_DAY;
  const times = meta.commits.map((c) => Date.parse(c.date)).filter((t) => Number.isFinite(t));
  const inWindow = times.filter((t) => t >= start).length;

  if (times.length > 0 && inWindow === 0) {
    const reason = `No commits are newer than the milestone start (${ctx.milestoneStart}); the work appears to pre-date this contract.`;
    flags.push({ id: "predates-contract", severity: "review", message: reason });
    caps.push({ value: 79, reason });
  } else if (times.length > 0 && inWindow < times.length && !meta.commitsTruncated) {
    flags.push({ id: "partial-window", severity: "info", message: `${inWindow} of ${times.length} commits were made after the milestone started.` });
  }

  if (meta.fork) {
    if (inWindow === 0) {
      const reason = "The repository is a fork with no new commits since the milestone started.";
      flags.push({ id: "unchanged-fork", severity: "review", message: reason });
      caps.push({ value: 30, reason });
    } else {
      flags.push({ id: "fork", severity: "warn", message: "The repository is a fork; confirm the new work is the contractor's own." });
    }
  }
  if (times.length === 1 && bundle.files.length >= 25) {
    flags.push({ id: "single-commit-dump", severity: "warn", message: `All ${bundle.files.length} files arrive in a single commit, so the build history cannot be inspected.` });
  }
  if (times.some((t) => t > Date.now() + MS_DAY)) {
    flags.push({ id: "future-commits", severity: "warn", message: "Some commits are dated in the future, which suggests tampered history." });
  }
  const authors = new Set(meta.commits.map((c) => c.author));
  if (authors.size > 0) flags.push({ id: "authors", severity: "info", message: `${meta.commits.length}${meta.commitsTruncated ? "+" : ""} commit(s) by ${authors.size} author(s).` });
}

/** Deterministic integrity analysis. Everything here is computed from the files themselves; no model is involved. */
export function analyzeSource(bundle: SourceBundle, ctx: ForensicsContext): Forensics {
  const flags: IntegrityFlag[] = [];
  const caps: Cap[] = [];

  const sourceFiles = bundle.files.filter((f) => isSourcePath(f.path));
  const testFiles = bundle.files.filter((f) => isTestPath(f.path) && !isDocPath(f.path));
  const docFiles = bundle.files.filter((f) => isDocPath(f.path));
  const expectsCode = CODE_EXPECTED.test(ctx.criteria.join(" "));

  const src = statsFor(sourceFiles);
  const languages = new Map<string, number>();
  for (const f of sourceFiles) {
    const name = LANGUAGES[extOf(f.path)];
    if (name) languages.set(name, (languages.get(name) ?? 0) + f.content.split("\n").filter((l) => l.trim()).length);
  }

  if (expectsCode) {
    // A small milestone can be a small, complete component, so the bar grows with the number of requirements.
    const minLines = Math.max(10, 6 * ctx.criteria.length);
    if (src.substantive < minLines) {
      const reason = `The submission contains almost no implementation code (${src.substantive} lines for ${ctx.criteria.length} requirement${ctx.criteria.length === 1 ? "" : "s"}).`;
      flags.push({ id: "no-implementation", severity: "review", message: reason });
      caps.push({ value: 35, reason });
    } else if (src.substantive < minLines * 2) {
      flags.push({ id: "thin-implementation", severity: "warn", message: `Only ${src.substantive} lines of implementation code were found.` });
    }
  }

  const stubs = sourceFiles.reduce((n, f) => n + STUB_PATTERNS.reduce((m, re) => m + (f.content.match(re)?.length ?? 0), 0), 0);
  const functions = sourceFiles.reduce((n, f) => n + (f.content.match(FUNCTION_COUNT)?.length ?? 0), 0);
  if (stubs >= 3 && stubs / Math.max(1, functions) >= 0.3) {
    const reason = `${stubs} of about ${functions} functions are empty stubs.`;
    flags.push({ id: "stub-functions", severity: "review", message: reason });
    caps.push({ value: 55, reason });
  }

  const ratio = src.placeholders / Math.max(1, src.substantive);
  if (src.placeholders >= 8 && ratio >= 0.2) {
    const reason = `${src.placeholders} placeholder markers (TODO, lorem ipsum, not implemented) across ${src.substantive} lines of code.`;
    flags.push({ id: "placeholders", severity: "review", message: reason });
    caps.push({ value: 55, reason });
  } else if (src.placeholders >= 5 && ratio >= 0.08) {
    flags.push({ id: "placeholders", severity: "warn", message: `${src.placeholders} placeholder markers (TODO, lorem ipsum, not implemented) found in the source.` });
  }

  const templateHits = bundle.files.reduce((n, f) => n + TEMPLATE_MARKERS.filter((re) => re.test(f.content)).length, 0);
  if (templateHits >= 2 && src.substantive < 250) {
    const reason = "The code looks like an unmodified starter template.";
    flags.push({ id: "starter-template", severity: "review", message: reason });
    caps.push({ value: 40, reason });
  }

  if (src.substantive >= 150 && src.unique.size / src.substantive < 0.55) {
    const reason = `Only ${Math.round((src.unique.size / src.substantive) * 100)}% of source lines are unique, which indicates copy-pasted padding.`;
    flags.push({ id: "repeated-lines", severity: "review", message: reason });
    caps.push({ value: 50, reason });
  }
  const hashes = new Map<string, number>();
  for (const f of sourceFiles) if (f.content.length > 200) hashes.set(f.content, (hashes.get(f.content) ?? 0) + 1);
  const duplicateFiles = [...hashes.values()].reduce((n, c) => n + (c > 1 ? c - 1 : 0), 0);
  if (duplicateFiles >= 3 && duplicateFiles / Math.max(1, sourceFiles.length) >= 0.3) {
    flags.push({ id: "duplicate-files", severity: "warn", message: `${duplicateFiles} source files are exact copies of other files.` });
  }

  const totalLines = src.substantive + src.comments;
  if (totalLines >= 100 && src.comments / totalLines > 0.6) {
    const reason = `${Math.round((src.comments / totalLines) * 100)}% of source lines are comments.`;
    flags.push({ id: "comment-padding", severity: "warn", message: reason });
    caps.push({ value: 65, reason });
  }

  const stuffing = dependencyStuffing(bundle.files, sourceFiles);
  if (stuffing) flags.push(stuffing);

  const longLine = sourceFiles.find((f) => !/\.(css|scss|sass|less)$/i.test(f.path) && f.content.split("\n").some((l) => l.length > 1500));
  if (longLine) flags.push({ id: "minified-or-embedded-blob", severity: "warn", message: `${longLine.path} contains very long lines (minified or embedded data), which cannot be reviewed as source.` });
  const obfuscated = sourceFiles.find((f) => /\beval\s*\(/.test(f.content) && /\b(atob|fromCharCode|Buffer\.from\([^)]*base64)/.test(f.content));
  if (obfuscated) flags.push({ id: "obfuscation", severity: "warn", message: `${obfuscated.path} decodes and evaluates code at runtime.` });

  for (const f of bundle.files) {
    if (/\.example$|^\.env\.example$/.test(f.path)) continue;
    for (const [name, re] of SECRET_PATTERNS) {
      const m = f.content.match(re);
      if (m && !/example|your[_-]|xxxx/i.test(m[0])) {
        flags.push({ id: "hardcoded-secret", severity: "warn", message: `A ${name} appears to be hard-coded in ${f.path} (value hidden).` });
        break;
      }
    }
  }

  const injection = scanSurfaces(bundle.files);
  if (injection.prose.length > 0) {
    flags.push({ id: "prompt-injection", severity: "block", message: `Instructions aimed at the AI auditor were found in ${[...new Set(injection.prose.map((f) => f.split(": ")[0]))].slice(0, 3).join(", ")}.` });
  } else if (injection.quotedFiles.length > 0) {
    const reason = `${injection.quotedFiles.slice(0, 3).join(", ")} quote prompt-injection phrases. They look like examples, but a reviewer must confirm.`;
    flags.push({ id: "quoted-injection", severity: "review", message: reason });
    caps.push({ value: 79, reason });
  }

  provenance(bundle, ctx, flags, caps);

  const summary: SourceSummary = {
    kind: bundle.origin.kind === "git" ? "repository" : "upload",
    label: bundle.origin.label,
    files: bundle.files.length,
    sourceFiles: sourceFiles.length,
    codeLines: src.substantive,
    testFiles: testFiles.length,
    languages: [...languages.entries()].map(([name, lines]) => ({ name, lines })).sort((a, b) => b.lines - a.lines).slice(0, 5),
    skipped: bundle.skipped,
    commits: bundle.meta ? bundle.meta.commits.length : null,
  };

  return { summary, flags, caps, injectionFindings: injection.prose, sourceFiles, testFiles, docFiles, substantiveLines: src.substantive };
}
