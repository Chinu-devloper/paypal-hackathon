import { unzipSync } from "fflate";
import { PaymentError } from "../errors";
import { classifyPath, normalizePath, SOURCE_LIMITS, stripCommonRoot } from "../../shared/source";
import { REDIRECT_HOSTS } from "./git-url";

export interface RawFile {
  path: string;
  /** undefined for files that were counted but not read (binary, too large, skipped). */
  content?: string;
  size: number;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 4;

const fail = (code: "VALIDATION" | "NOT_FOUND", message: string, status = 422) => new PaymentError(code, message, status);

/** Downloads an archive with a hard byte cap, following redirects only to allow-listed hosts. */
export async function downloadArchive(archiveUrl: string, fetchImpl: FetchLike = fetch): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = archiveUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "MilestoneOS-Auditor", Accept: "application/zip, application/octet-stream" } });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) throw fail("VALIDATION", "The repository host returned an invalid redirect.");
        const target = new URL(next, url);
        if (target.protocol !== "https:" || !REDIRECT_HOSTS.has(target.hostname.toLowerCase())) {
          throw fail("VALIDATION", "The repository link redirected somewhere that is not allowed.");
        }
        url = target.toString();
        continue;
      }
      if (res.status === 404 || res.status === 401) throw fail("NOT_FOUND", "Repository not found. It may be private, misspelled, or the branch does not exist. Only public repositories can be analyzed.", 404);
      if (res.status === 403 || res.status === 429) throw fail("VALIDATION", "The repository host is rate limiting or blocking this request. Try again in a minute, or upload the folder instead.", 429);
      if (!res.ok || !res.body) throw fail("VALIDATION", `The repository host returned an error (${res.status}).`, 502);

      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > SOURCE_LIMITS.maxArchiveBytes) throw fail("VALIDATION", `The repository is larger than ${SOURCE_LIMITS.maxArchiveBytes / 1_000_000} MB. Upload just the relevant folder instead.`, 413);

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > SOURCE_LIMITS.maxArchiveBytes) {
          await reader.cancel();
          throw fail("VALIDATION", `The repository is larger than ${SOURCE_LIMITS.maxArchiveBytes / 1_000_000} MB. Upload just the relevant folder instead.`, 413);
        }
        chunks.push(value);
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
      }
      return out;
    }
    throw fail("VALIDATION", "Too many redirects while downloading the repository.");
  } catch (err) {
    if (err instanceof PaymentError) throw err;
    if ((err as Error).name === "AbortError") throw fail("VALIDATION", "Downloading the repository timed out.", 504);
    throw fail("VALIDATION", "Could not reach the repository host.", 502);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a zip safely: entry count and uncompressed size are capped before any bytes are inflated. */
export function unzipToFiles(zip: Uint8Array): RawFile[] {
  const wanted: Array<{ name: string; path: string; size: number }> = [];
  let entries = 0;
  let inflated = 0;
  const names = new Map<string, string>();
  let entriesSeen: Record<string, Uint8Array>;
  try {
    entriesSeen = unzipSync(zip, {
      filter: (file) => {
        entries++;
        if (entries > SOURCE_LIMITS.maxArchiveEntries) throw fail("VALIDATION", "The archive contains too many files.", 413);
        if (file.name.endsWith("/")) return false;
        const path = normalizePath(file.name);
        if (!path) return false;
        const cls = classifyPath(path);
        if (cls === "binary") {
          wanted.push({ name: file.name, path, size: file.originalSize });
          return false;
        }
        if (cls !== "text" || file.originalSize > SOURCE_LIMITS.maxFileBytes) {
          wanted.push({ name: file.name, path, size: file.originalSize });
          return false;
        }
        inflated += file.originalSize;
        if (inflated > SOURCE_LIMITS.maxArchiveBytes * 2) throw fail("VALIDATION", "The archive expands to more data than is allowed.", 413);
        names.set(file.name, path);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof PaymentError) throw err;
    throw fail("VALIDATION", "The archive could not be read. Make sure it is a valid .zip file.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const files: RawFile[] = [];
  for (const [name, bytes] of Object.entries(entriesSeen)) {
    const path = names.get(name);
    if (path) files.push({ path, content: decoder.decode(bytes), size: bytes.byteLength });
  }
  for (const w of wanted) files.push({ path: w.path, size: w.size });

  const stripped = stripCommonRoot(files.map((f) => f.path));
  return files.map((f, i) => ({ ...f, path: stripped[i] ?? f.path })).filter((f) => f.path.length > 0);
}
