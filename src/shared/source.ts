/** Path rules and size limits shared by the browser (before upload) and the server (which never trusts the client). */

export const SOURCE_LIMITS = {
  maxFiles: 800,
  maxFileBytes: 200_000,
  maxTotalBytes: 4_000_000,
  maxArchiveBytes: 40_000_000,
  maxArchiveEntries: 25_000,
  maxUploadBytes: 8_000_000,
} as const;

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "dist", "build", "out", "coverage", "vendor",
  "venv", ".venv", "__pycache__", ".idea", ".vscode", "target", "obj", "pods", ".gradle", "bower_components",
]);

const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock", "composer.lock", "poetry.lock", "gemfile.lock", "bun.lockb"]);

const TEXT_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "txt", "html", "htm", "css", "scss", "sass", "less", "vue", "svelte", "astro",
  "py", "rb", "go", "rs", "java", "kt", "swift", "php", "cs", "c", "h", "cpp", "hpp", "sql", "yml", "yaml", "toml", "ini", "sh", "bash", "bat", "ps1",
  "gradle", "xml", "graphql", "gql", "prisma", "sol", "tf", "dart", "lua", "r", "scala", "ex", "exs", "example", "rst", "adoc",
]);

const TEXT_NAMES = new Set(["dockerfile", "makefile", "procfile", "readme", "license", "gemfile", "rakefile", ".env.example", ".gitignore", ".dockerignore"]);

const BINARY_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "pdf", "mp4", "mov", "webm", "mp3", "wav", "zip", "gz", "tar", "woff", "woff2", "ttf", "eot", "fig", "sketch", "psd", "xd"]);

export type PathClass = "skip" | "text" | "binary";

/** Normalizes an uploaded path; returns null for anything that tries to escape the root. */
export function normalizePath(raw: string): string | null {
  const parts = raw.replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === ".." || p.includes("\0"))) return null;
  return parts.join("/").slice(0, 300);
}

export function extOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function classifyPath(path: string): PathClass {
  const parts = path.split("/");
  const name = (parts[parts.length - 1] ?? "").toLowerCase();
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p.toLowerCase()))) return "skip";
  if (LOCKFILES.has(name) || name.endsWith(".min.js") || name.endsWith(".min.css") || name.endsWith(".map") || name.endsWith(".snap")) return "skip";
  const ext = extOf(path);
  if (BINARY_EXT.has(ext)) return "binary";
  if (TEXT_NAMES.has(name) || TEXT_EXT.has(ext)) return "text";
  return "skip";
}

export const isTestPath = (path: string) => /(^|\/)(__tests__|tests?|spec|e2e)\//i.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path) || /(^|\/)test_[^/]+\.py$/i.test(path) || /_test\.(go|py|rb)$/i.test(path);

export const isDocPath = (path: string) => {
  const ext = extOf(path);
  return ["md", "mdx", "txt", "rst", "adoc"].includes(ext) || /(^|\/)(readme|license|changelog)[^/]*$/i.test(path);
};

const CONFIG_EXT = new Set(["json", "yml", "yaml", "toml", "ini", "xml", "example", "gradle", "tf"]);

export const isConfigPath = (path: string) => {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  return CONFIG_EXT.has(extOf(path)) || ["dockerfile", "makefile", "procfile", ".gitignore", ".dockerignore", ".env.example"].includes(name);
};

/** Implementation code: text that is not documentation, configuration or a test. */
export const isSourcePath = (path: string) => classifyPath(path) === "text" && !isDocPath(path) && !isConfigPath(path) && !isTestPath(path);

/** Drops a single shared top-level folder (what zip and folder uploads add). */
export function stripCommonRoot(paths: string[]): string[] {
  if (paths.length < 2) return paths;
  const first = paths[0]?.split("/")[0];
  if (!first || !paths.every((p) => p.includes("/") && p.split("/")[0] === first)) return paths;
  return paths.map((p) => p.slice(first.length + 1));
}
