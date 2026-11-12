import type { FetchLike } from "./fetch-archive";
import type { RepoMeta } from "./bundle";
import type { RepoRef } from "./git-url";

interface GithubRepo {
  created_at?: string;
  pushed_at?: string;
  fork?: boolean;
  default_branch?: string;
}

interface GithubCommit {
  commit?: { author?: { name?: string; date?: string }; message?: string };
}

const PAGE = 100;

/** Provenance data from the GitHub API. Returns null (never throws) so a rate limit cannot block an audit. */
export async function fetchGithubMeta(ref: RepoRef, fetchImpl: FetchLike = fetch): Promise<RepoMeta | null> {
  if (ref.host !== "github") return null;
  const headers: Record<string, string> = { "User-Agent": "MilestoneOS-Auditor", Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const signal = AbortSignal.timeout(8_000);
  try {
    const repoRes = await fetchImpl(base, { headers, signal });
    if (!repoRes.ok) return null;
    const repo = (await repoRes.json()) as GithubRepo;
    const sha = ref.ref ? `&sha=${encodeURIComponent(ref.ref)}` : "";
    const commitsRes = await fetchImpl(`${base}/commits?per_page=${PAGE}${sha}`, { headers, signal });
    const raw = commitsRes.ok ? ((await commitsRes.json()) as GithubCommit[]) : [];
    const commits = raw
      .map((c) => ({ date: c.commit?.author?.date ?? "", author: c.commit?.author?.name ?? "unknown", message: (c.commit?.message ?? "").split("\n")[0]?.slice(0, 120) ?? "" }))
      .filter((c) => c.date);
    return {
      createdAt: repo.created_at ?? "",
      pushedAt: repo.pushed_at ?? "",
      fork: Boolean(repo.fork),
      defaultBranch: repo.default_branch ?? "main",
      commits,
      commitsTruncated: raw.length >= PAGE,
    };
  } catch {
    return null;
  }
}
