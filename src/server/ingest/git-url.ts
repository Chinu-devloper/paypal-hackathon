import { PaymentError } from "../errors";

export type GitHost = "github" | "gitlab" | "bitbucket";

export interface RepoRef {
  host: GitHost;
  owner: string;
  repo: string;
  ref: string | null;
  /** Canonical https URL shown to users and stored in the audit trail. */
  url: string;
  archiveUrl: string;
}

const HOSTS: Record<string, GitHost> = {
  "github.com": "github",
  "www.github.com": "github",
  "gitlab.com": "gitlab",
  "www.gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
  "www.bitbucket.org": "bitbucket",
};

/** Hosts an archive request may be redirected to. Anything else is refused, which blocks SSRF via open redirects. */
export const REDIRECT_HOSTS = new Set([
  "github.com", "codeload.github.com", "gitlab.com", "bitbucket.org", "bbuseruploads.s3.amazonaws.com",
]);

const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9._/-]{1,100}$/;

const invalid = (message: string) => new PaymentError("VALIDATION", message, 422);

/** Parses a public GitHub, GitLab or Bitbucket repository link into a fixed archive URL. */
export function parseRepoUrl(input: string): RepoRef {
  const raw = input.trim();
  if (!raw) throw invalid("Enter a repository link.");
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw invalid("That does not look like a valid link.");
  }
  if (url.protocol !== "https:") throw invalid("Only https repository links are accepted.");
  if (url.username || url.password) throw invalid("Links with credentials are not accepted.");
  if (url.port) throw invalid("Links with a custom port are not accepted.");
  const host = HOSTS[url.hostname.toLowerCase()];
  if (!host) throw invalid("Only public GitHub, GitLab and Bitbucket repositories are supported.");

  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/i, "");
  if (!owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo)) throw invalid("Use a link of the form https://github.com/owner/repository.");

  let ref: string | null = null;
  const marker = parts[2];
  if (marker === "tree" || marker === "-" || marker === "src") {
    const rest = marker === "-" ? parts.slice(4) : parts.slice(3);
    // Branch names may contain slashes; the first segment is the best unambiguous guess.
    ref = rest[0] ?? null;
  }
  if (ref !== null && (!REF.test(ref) || ref.includes(".."))) throw invalid("That branch or tag name is not valid.");

  const base = host === "github" ? "https://github.com" : host === "gitlab" ? "https://gitlab.com" : "https://bitbucket.org";
  const archiveUrl =
    host === "github"
      ? `https://codeload.github.com/${owner}/${repo}/zip/${ref ?? "HEAD"}`
      : host === "gitlab"
        ? `https://gitlab.com/${owner}/${repo}/-/archive/${ref ?? "HEAD"}/${repo}.zip`
        : `https://bitbucket.org/${owner}/${repo}/get/${ref ?? "HEAD"}.zip`;
  return { host, owner, repo, ref, url: ref ? `${base}/${owner}/${repo}/tree/${ref}` : `${base}/${owner}/${repo}`, archiveUrl };
}
