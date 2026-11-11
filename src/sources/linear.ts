import { LinearClient } from '@linear/sdk';
import { daysSince, shortDate, type Cell, type Task, type User, type View } from '../types.js';

// Display order and labels, keyed by lowercased Linear status name.
const STATUSES = ['triage', 'todo', 'in progress'];
const LABELS: Record<string, string> = { triage: '↔', todo: '○', 'in progress': '◔' };
const COLORS: Record<string, string> = { triage: '#FF8700', todo: 'white', 'in progress': 'yellow' };

// Linear priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low
const PRIORITIES: Record<number, { text: string; color?: string; dim?: boolean }> = {
  0: { text: '·', dim: true },
  1: { text: '!', color: '#FF8700' },
  2: { text: '↑', color: 'yellow' },
  3: { text: '−', color: 'white' },
  4: { text: '↓', color: 'gray' },
};

// stateHistory spans are oldest first; the current one has endedAt = null.
// The filter is built in code: Linear rejects an explicit null cycle filter.
const QUERY = `query($filter: IssueFilter!) {
  issues(first: 50, filter: $filter, orderBy: updatedAt) {
    nodes {
      identifier title url priority createdAt state { name }
      stateHistory(last: 3) { nodes { startedAt endedAt } }
    }
  }
}`;

type Issue = {
  identifier: string;
  title: string;
  url: string;
  priority: number;
  createdAt: string;
  state: { name: string };
  stateHistory: { nodes: { startedAt: string; endedAt: string | null }[] };
};
type Data = { issues: { nodes: Issue[] } };

let client: LinearClient | undefined;

export async function fetchLinear(user: User, view: View): Promise<Task[]> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error('not configured — set LINEAR_API_KEY in .env');
  client ??= new LinearClient({ apiKey });

  const filter = {
    assignee: user.linear,
    state: { name: { in: ['Triage', 'Todo', 'In Progress'] } },
    ...(view.allCycles ? {} : { cycle: { isActive: { eq: true } } }),
  };
  const data = await client.client.request<Data, { filter: object }>(QUERY, { filter });
  return data.issues.nodes
    .map((i) => ({ issue: i, status: i.state.name.toLowerCase() }))
    .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status))
    .map(({ issue: i, status }) => {
      const inStatusSince = i.stateHistory.nodes.find((s) => !s.endedAt)?.startedAt ?? i.createdAt;
      return {
        id: i.identifier,
        left: [
          PRIORITIES[i.priority] ?? PRIORITIES[0],
          { text: LABELS[status] ?? status, color: COLORS[status] },
          { text: i.identifier, dim: true, url: i.url },
        ],
        title: i.title,
        right: [
          ageCell(daysSince(inStatusSince)),
          { text: shortDate(i.createdAt), dim: true },
        ],
      };
    });
}

// Time in status: yellow from 7 days, red from 14 days.
function ageCell(days: number): Cell {
  const text = `${days}d`;
  if (days >= 14) return { text, color: 'red' };
  if (days >= 7) return { text, color: 'yellow' };
  return { text, dim: true };
}
