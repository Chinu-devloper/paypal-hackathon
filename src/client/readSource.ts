import { classifyPath, normalizePath, SOURCE_LIMITS, stripCommonRoot } from "@/shared/source";

export interface PickedSource {
  label: string;
  files: Array<{ path: string; content: string }>;
  /** Files left out because they are dependencies, binaries, lockfiles or too large. */
  skipped: number;
  bytes: number;
}

const MAX_READ_FILES = 1200;

function finish(label: string, entries: Array<{ path: string; text: string }>, skipped: number): PickedSource {
  const roots = stripCommonRoot(entries.map((e) => e.path));
  const files: PickedSource["files"] = [];
  let bytes = 0;
  entries.forEach((e, i) => {
    const path = roots[i] ?? e.path;
    if (files.length >= MAX_READ_FILES || bytes + e.text.length > SOURCE_LIMITS.maxUploadBytes) {
      skipped++;
      return;
    }
    bytes += e.text.length;
    files.push({ path, content: e.text });
  });
  return { label, files, skipped, bytes };
}

/** Reads a folder chosen with <input webkitdirectory>, keeping only readable source files. */
export async function readFolder(list: FileList): Promise<PickedSource> {
  const entries: Array<{ path: string; text: string }> = [];
  let skipped = 0;
  const all = Array.from(list);
  const rootName = all[0]?.webkitRelativePath.split("/")[0] ?? "folder";
  for (const file of all) {
    const path = normalizePath(file.webkitRelativePath || file.name);
    if (!path || classifyPath(path) !== "text" || file.size > SOURCE_LIMITS.maxFileBytes) {
      skipped++;
      continue;
    }
    entries.push({ path, text: await file.text() });
  }
  return finish(rootName, entries, skipped);
}

/** Reads a .zip in the browser; the server re-applies the same rules and never trusts this filtering. */
export async function readZip(file: File): Promise<PickedSource> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let skipped = 0;
  const kept: Array<{ path: string; text: string }> = [];
  const unzipped = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name.endsWith("/")) return false;
      const path = normalizePath(entry.name);
      if (!path || classifyPath(path) !== "text" || entry.originalSize > SOURCE_LIMITS.maxFileBytes) {
        skipped++;
        return false;
      }
      return true;
    },
  });
  for (const [name, data] of Object.entries(unzipped)) {
    const path = normalizePath(name);
    if (path) kept.push({ path, text: strFromU8(data) });
  }
  return finish(file.name.replace(/\.zip$/i, ""), kept, skipped);
}
