import { PaymentError } from "../errors";
import { SOURCE_LIMITS } from "../../shared/source";
import { buildBundle, type SourceBundle } from "./bundle";
import { downloadArchive, unzipToFiles, type FetchLike, type RawFile } from "./fetch-archive";
import { parseRepoUrl } from "./git-url";
import { fetchGithubMeta } from "./repo-meta";

export type IngestEmitter = (line: string) => void | Promise<void>;

export async function ingestRepository(url: string, emit: IngestEmitter = () => {}, fetchImpl: FetchLike = fetch): Promise<SourceBundle> {
  const ref = parseRepoUrl(url);
  await emit(`[INGEST] Fetching public ${ref.host} repository ${ref.owner}/${ref.repo}${ref.ref ? ` (${ref.ref})` : ""}...`);
  const [archive, meta] = await Promise.all([downloadArchive(ref.archiveUrl, fetchImpl), fetchGithubMeta(ref, fetchImpl)]);
  await emit(`[INGEST] Downloaded ${(archive.byteLength / 1024).toFixed(0)} KB; extracting with size and path safety limits.`);
  const bundle = buildBundle(unzipToFiles(archive), { kind: "git", label: `${ref.owner}/${ref.repo}`, url: ref.url }, meta);
  if (bundle.files.length === 0) throw new PaymentError("VALIDATION", "No readable source files were found in that repository.", 422);
  if (bundle.files.length <= 3) {
    await emit(`[INGEST] Only ${bundle.files.length} readable file(s) found${ref.ref ? "" : " on the default branch"}. If the work lives on another branch, paste the link as .../tree/<branch>.`);
  }
  if (ref.host === "github") {
    await emit(meta ? `[INGEST] GitHub history: ${meta.commits.length}${meta.commitsTruncated ? "+" : ""} commit(s), created ${meta.createdAt.slice(0, 10)}${meta.fork ? ", FORK" : ""}.` : "[INGEST] GitHub history could not be fetched (rate limit or network); provenance checks are limited to the files.");
  } else {
    await emit(`[INGEST] ${ref.host} does not expose history here; provenance checks limited to the files themselves.`);
  }
  return bundle;
}

export function ingestUploadedFiles(files: Array<{ path: string; content: string }>, label: string): SourceBundle {
  let total = 0;
  const raw: RawFile[] = files.map((f) => {
    total += f.content.length;
    return { path: f.path, content: f.content, size: f.content.length };
  });
  if (total > SOURCE_LIMITS.maxUploadBytes) throw new PaymentError("VALIDATION", `The upload is larger than ${SOURCE_LIMITS.maxUploadBytes / 1_000_000} MB.`, 413);
  const bundle = buildBundle(raw, { kind: "upload", label });
  if (bundle.files.length === 0) throw new PaymentError("VALIDATION", "No readable source files were found in that upload.", 422);
  return bundle;
}
