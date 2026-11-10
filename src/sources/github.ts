import { graphql } from '@octokit/graphql';
import { shortDate, type Cell, type Task } from '../types.js';

const QUERY = `query($review: String!, $mine: String!) {
  review: search(type: ISSUE, first: 30, query: $review) { ...pr }
  mine: search(type: ISSUE, first: 30, query: $mine) { ...pr }
}
fragment pr on SearchResultItemConnection {
  nodes {
    ... on PullRequest {
      number title url isDraft createdAt repository { name }
      mergeable mergeStateStatus
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      reviewThreads(first: 100) { nodes { isResolved } }
    }
  }
}`;

type PR = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  repository: { name: string };
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: string; // BEHIND = base branch update required
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
  reviewThreads: { nodes: { isResolved: boolean }[] };
};
type Data = { review: { nodes: PR[] }; mine: { nodes: PR[] } };

export async function fetchGitHub(org?: string): Promise<Task[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !org) throw new Error('not configured — set GITHUB_TOKEN and GITHUB_ORGS in .env');

  const base = `is:pr is:open archived:false org:${org}`;
  const data = await graphql<Data>(QUERY, {
    review: `${base} user-review-requested:@me`,
    mine: `${base} author:@me`,
    headers: { authorization: `token ${token}` },
  });

  // ← review requested, → my open PRs, ◌ my drafts (in that order). A PR in both lists shows once.
  const tasks = new Map<string, Task>();
  const add = (pr: PR, tag: string, tagColor: string) => {
    if (tasks.has(pr.url)) return;
    tasks.set(pr.url, {
      id: pr.url,
      left: [
        { text: tag, color: tagColor },
        { text: `${pr.repository.name}#${pr.number}`, dim: true, url: pr.url },
      ],
      title: pr.title,
      badges: badges(pr),
      right: [{ text: shortDate(pr.createdAt), dim: true }],
    });
  };
  data.review.nodes.forEach((pr) => add(pr, '←', 'magenta'));
  data.mine.nodes.filter((pr) => !pr.isDraft).forEach((pr) => add(pr, '→', 'green'));
  data.mine.nodes.filter((pr) => pr.isDraft).forEach((pr) => add(pr, '◌', 'gray'));
  return [...tasks.values()];
}

// Only the marks that apply, in this order: merge problem, checks, unresolved comments.
// Merge and comment icons are Nerd Font Codicons.
function badges(pr: PR): Cell[] {
  const out: Cell[] = [];
  if (pr.mergeable === 'CONFLICTING') out.push({ text: '\ueafe', color: 'red' }); // cod-git_merge: conflict
  else if (pr.mergeStateStatus === 'BEHIND') out.push({ text: '\uea77', color: 'yellow' }); // cod-sync: update base

  const checks = pr.commits.nodes[0]?.commit.statusCheckRollup?.state; // undefined = no checks
  if (checks === 'PENDING' || checks === 'EXPECTED') out.push({ text: '●', color: 'yellow' });
  else if (checks === 'FAILURE' || checks === 'ERROR') out.push({ text: '✗', color: 'red' });
  else if (checks === 'SUCCESS') out.push({ text: '✓', color: 'green' });

  if (pr.reviewThreads.nodes.some((t) => !t.isResolved)) out.push({ text: '\uea6b', color: 'white' }); // cod-comment
  return out;
}
