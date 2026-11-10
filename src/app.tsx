import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { Section } from './section.js';
import { fetchGitHub } from './sources/github.js';
import { fetchLinear } from './sources/linear.js';
import { errorMessage, type SourceState, type Task } from './types.js';

export type Source = { name: string; fetch: () => Promise<Task[]> };

// Linear, then one GitHub section per org in GITHUB_ORGS. Call after .env is loaded.
export function loadSources(): Source[] {
  const orgs = (process.env.GITHUB_ORGS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return [
    { name: 'Linear', fetch: fetchLinear },
    ...(orgs.length ? orgs : [undefined]).map((org) => ({
      name: org ? `GitHub · ${org}` : 'GitHub',
      fetch: () => fetchGitHub(org),
    })),
  ];
}

const INTERVAL = 60_000;
const TIMEOUT = 20_000;

// Split `total` rows between sections. Sections that need less than an even share get
// exactly what they need; the rest split what is left. Spare rows are spread evenly.
export function allocateHeights(needs: number[], total: number): number[] {
  const heights = needs.map(() => 0);
  let open = needs.map((_, i) => i);
  let remaining = total;
  while (open.length) {
    const share = Math.floor(remaining / open.length);
    const fits = open.filter((i) => needs[i] <= share);
    if (!fits.length) break;
    for (const i of fits) {
      heights[i] = needs[i];
      remaining -= needs[i];
    }
    open = open.filter((i) => needs[i] > share);
  }
  // Leftover rows go to the sections that still need them, or to everyone when all fit.
  const targets = open.length ? open : needs.map((_, i) => i);
  const base = Math.floor(remaining / targets.length);
  targets.forEach((i, k) => (heights[i] += base + (k < remaining - base * targets.length ? 1 : 0)));
  return heights;
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), TIMEOUT))]);
}

export function App({ sources }: { sources: Source[] }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [states, setStates] = useState<SourceState[]>(sources.map(() => ({})));
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const [refreshing, setRefreshing] = useState(false);
  const lastStart = useRef(0);
  const busy = useRef(false);

  const refresh = async () => {
    if (busy.current) return; // previous refresh still running
    busy.current = true;
    lastStart.current = Date.now();
    setRefreshing(true);
    const results = await Promise.allSettled(sources.map((s) => withTimeout(s.fetch())));
    setStates((prev) =>
      results.map((r, i) => (r.status === 'fulfilled' ? { tasks: r.value } : { tasks: prev[i].tasks, error: errorMessage(r.reason) })),
    );
    setUpdatedAt(new Date());
    setRefreshing(false);
    busy.current = false;
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (Date.now() - lastStart.current >= INTERVAL) refresh();
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useInput((input) => {
    if (input === 'q') exit();
    if (input === 'r') refresh();
  });

  // Each section needs its rows plus 2 border rows; the last screen row is the footer.
  const heights = allocateHeights(
    states.map((s) => Math.max(s.tasks?.length ?? 0, 1) + 2),
    rows - 1,
  );

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {sources.map((s, i) => (
        <Section
          key={s.name}
          name={s.name}
          state={states[i]}
          width={columns}
          height={heights[i]}
        />
      ))}
      <Text dimColor wrap="truncate-end">
        {' '}
        {updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-GB')}` : 'Loading'}
        {refreshing ? ' · refreshing…' : ''} · r refresh · q quit
      </Text>
    </Box>
  );
}
