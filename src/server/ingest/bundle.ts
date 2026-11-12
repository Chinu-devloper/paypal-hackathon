import { classifyPath, normalizePath, SOURCE_LIMITS, stripCommonRoot } from "../../shared/source";
import type { RawFile } from "./fetch-archive";

export interface SourceFile {
  path: string;
  content: string;
  lines: number;
}

export interface CommitInfo {
  date: string;
  author: string;
  message: string;
}

export interface RepoMeta {
  createdAt: string;
  pushedAt: string;
  fork: boolean;
  defaultBranch: string;
  commits: CommitInfo[];
  /** True when GitHub returned a full page, so the real count is higher. */
  commitsTruncated: boolean;
}

export interface SourceBundle {
  origin: { kind: "git" | "upload"; label: string; url?: string };
  files: SourceFile[];
  /** Paths of images, design files and other binaries that were counted but not read. */
  binaryPaths: string[];
  skipped: number;
  truncated: boolean;
  meta: RepoMeta | null;
}

/** Paths that matter most when the repository is larger than the file cap. */
function priority(path: string): number {
  const lower = path.toLowerCase();
  if (/^readme/.test(lower) || /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|pom\.xml|dockerfile|render\.yaml)$/.test(lower)) return 0;
  if (/(^|\/)(src|app|lib|server|api|pages|components|routes|controllers|models)\//.test(lower)) return 1;
  if (/\.(test|spec)\./.test(lower) || /(^|\/)(tests?|__tests__)\//.test(lower)) return 2;
  return 3;
}

/** Builds the bounded, sanitized file set the auditor works on. Applies the same rules as the browser. */
export function buildBundle(raw: RawFile[], origin: SourceBundle["origin"], meta: RepoMeta | null = null): SourceBundle {
  const cleaned: RawFile[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    const path = normalizePath(f.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    cleaned.push({ ...f, path });
  }
  const stripped = stripCommonRoot(cleaned.map((f) => f.path));
  const candidates = cleaned.map((f, i) => ({ ...f, path: stripped[i] ?? f.path }));

  const text: Array<RawFile & { content: string }> = [];
  const binaryPaths: string[] = [];
  let skipped = 0;
  for (const f of candidates) {
    const cls = classifyPath(f.path);
    if (cls === "binary") {
      binaryPaths.push(f.path);
      continue;
    }
    if (cls !== "text" || f.content === undefined || f.size > SOURCE_LIMITS.maxFileBytes || f.content.includes("\0")) {
      skipped++;
      continue;
    }
    text.push({ ...f, content: f.content });
  }

  text.sort((a, b) => priority(a.path) - priority(b.path) || a.size - b.size);
  const files: SourceFile[] = [];
  let total = 0;
  let truncated = false;
  for (const f of text) {
    if (files.length >= SOURCE_LIMITS.maxFiles || total + f.content.length > SOURCE_LIMITS.maxTotalBytes) {
      truncated = true;
      skipped++;
      continue;
    }
    total += f.content.length;
    files.push({ path: f.path, content: f.content, lines: f.content.split("\n").length });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { origin, files, binaryPaths, skipped, truncated, meta };
}
