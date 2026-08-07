/**
 * Live GitHub REST API client (no SDK, plain fetch).
 * Works unauthenticated (60 req/h); set GITHUB_TOKEN to raise limits to 5,000 req/h
 * and to verify issues in private repos.
 */

const API = "https://api.github.com";
const UA = "x402-github-bounty/0.1.0 (+https://github.com/nirholas/x402-github-bounty)";

export class GitHubError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": UA,
    "x-github-api-version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body };
}

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

/** Parse https://github.com/owner/repo/issues/123 (or a shorthand owner/repo#123). */
export function parseIssueUrl(input: string): IssueRef {
  const url = input.trim();
  let m = url.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/i);
  if (!m) m = url.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  if (!m) {
    throw new GitHubError(
      "INVALID_ISSUE_URL",
      `"${input}" is not a GitHub issue URL (expected https://github.com/owner/repo/issues/N)`,
    );
  }
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export interface IssueInfo {
  url: string;
  title: string;
  state: "open" | "closed";
  closedAt: string | null;
  stateReason: string | null;
  isPullRequest: boolean;
  labels: string[];
  repo: string;
}

/** Fetch live issue state. Throws ISSUE_NOT_FOUND on 404. */
export async function getIssue(ref: IssueRef): Promise<IssueInfo> {
  const { status, body } = await gh(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`);
  if (status === 404) {
    throw new GitHubError(
      "ISSUE_NOT_FOUND",
      `Issue ${ref.owner}/${ref.repo}#${ref.number} does not exist on GitHub`,
      404,
    );
  }
  if (status === 403 || status === 429) {
    throw new GitHubError("GITHUB_RATE_LIMITED", "GitHub API rate limit hit — set GITHUB_TOKEN", status);
  }
  if (status !== 200 || !body) {
    throw new GitHubError("GITHUB_ERROR", `GitHub API returned ${status}`, status);
  }
  return {
    url: body.html_url,
    title: body.title,
    state: body.state,
    closedAt: body.closed_at ?? null,
    stateReason: body.state_reason ?? null,
    isPullRequest: Boolean(body.pull_request),
    labels: (body.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
    repo: `${ref.owner}/${ref.repo}`,
  };
}

export interface MergedPr {
  number: number;
  title: string;
  author: string | null;
  url: string;
  mergedAt: string;
  mergeCommit: string | null;
}

/**
 * Find merged PRs that reference the issue, from the live issue timeline
 * (cross-referenced events) — the same signal GitHub uses for "linked PRs".
 */
export async function findMergedPrs(ref: IssueRef): Promise<MergedPr[]> {
  const { status, body } = await gh(
    `/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/timeline?per_page=100`,
  );
  if (status !== 200 || !Array.isArray(body)) return [];

  const candidates = new Map<string, { owner: string; repo: string; number: number }>();
  for (const ev of body) {
    if (ev.event === "cross-referenced" && ev.source?.issue?.pull_request) {
      const src = ev.source.issue;
      const repoFull: string = src.repository?.full_name ?? `${ref.owner}/${ref.repo}`;
      const [owner, repo] = repoFull.split("/");
      candidates.set(`${repoFull}#${src.number}`, { owner, repo, number: src.number });
    }
    // "closed" events carry the closing commit; PR closes show up via cross-reference too
  }

  const merged: MergedPr[] = [];
  for (const c of [...candidates.values()].slice(0, 10)) {
    const pr = await gh(`/repos/${c.owner}/${c.repo}/pulls/${c.number}`);
    if (pr.status === 200 && pr.body?.merged_at) {
      merged.push({
        number: pr.body.number,
        title: pr.body.title,
        author: pr.body.user?.login ?? null,
        url: pr.body.html_url,
        mergedAt: pr.body.merged_at,
        mergeCommit: pr.body.merge_commit_sha ?? null,
      });
    }
  }
  merged.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
  return merged;
}
