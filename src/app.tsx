import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { Section } from './section.js';
import { fetchGitHub } from './sources/github.js';
import { fetchLinear } from './sources/linear.js';
import { errorMessage, type SourceState, type Task, type User, type View } from './types.js';

export type Source = { name: string; fetch: (user: User, view: View) => Promise<Task[]> };

// Linear, then one GitHub section per org in GITHUB_ORGS. Call after .env is loaded.
export function loadSources(): Source[] {
  const orgs = (process.env.GITHUB_ORGS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return [
    { name: 'Linear', fetch: fetchLinear },
    ...(orgs.length ? orgs : [undefined]).map((org) => ({
      name: org ? `GitHub · ${org}` : 'GitHub',
      fetch: (user: User) => fetchGitHub(user, org),
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

export function App({ sources, users }: { sources: Source[]; users: User[] }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  // states[user][source]: only the selected user is fetched; others keep their last data.
  const [states, setStates] = useState<SourceState[][]>(users.map(() => sources.map(() => ({}))));
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef(0);
  selectedRef.current = selected;
  const [sidebar, setSidebar] = useState(users.length > 1);
  const [updatedAt, setUpdatedAt] = useState<(Date | undefined)[]>(users.map(() => undefined));
  const [allCycles, setAllCycles] = useState(false);
  const allCyclesRef = useRef(false);
  allCyclesRef.current = allCycles;
  const [refreshing, setRefreshing] = useState(false);
  const lastStart = useRef(0);
  const busy = useRef(false);

  const refresh = async () => {
    if (busy.current) return; // previous refresh still running
    busy.current = true;
    lastStart.current = Date.now();
    setRefreshing(true);
    const u = selectedRef.current;
    const all = allCyclesRef.current;
    const row = await Promise.allSettled(sources.map((s) => withTimeout(s.fetch(users[u], { allCycles: all }))));
    if (allCyclesRef.current !== all) {
      // Cycle filter toggled while loading: drop this result and load again.
      busy.current = false;
      return refresh();
    }
    setStates((prev) =>
      prev.map((cur, k) =>
        k !== u ? cur : row.map((r, i) => (r.status === 'fulfilled' ? { tasks: r.value } : { tasks: cur[i].tasks, error: errorMessage(r.reason) })),
      ),
    );
    setUpdatedAt((prev) => prev.map((d, k) => (k === u ? new Date() : d)));
    setRefreshing(false);
    busy.current = false;
    if (selectedRef.current !== u) refresh(); // user switched while loading
  };

  // Load on start and whenever the selected user or the cycle filter changes.
  useEffect(() => {
    refresh();
  }, [selected, allCycles]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - lastStart.current >= INTERVAL) refresh();
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useInput((input) => {
    if (input === 'q') exit();
    if (input === 'r') refresh();
    if (input === 'c') {
      // Loaded data no longer matches the filter, so clear it for every user.
      setAllCycles((v) => !v);
      setStates(users.map(() => sources.map(() => ({}))));
      setUpdatedAt(users.map(() => undefined));
    }
    if (users.length < 2) return;
    if (input === 'j') setSelected((i) => Math.min(i + 1, users.length - 1));
    if (input === 'k') setSelected((i) => Math.max(i - 1, 0));
    if (input === 'g') setSelected(0);
    if (input === 'G') setSelected(users.length - 1);
    if (input === 'b') setSidebar((v) => !v);
  });

  const userStates = states[selected];
  // Sidebar: "› " marker + name, plus border and padding.
  const sidebarWidth = sidebar ? Math.max(...users.map((u) => u.name.length)) + 6 : 0;
  const width = columns - sidebarWidth;

  // Each section needs its rows plus 2 border rows; the last screen row is the footer.
  const heights = allocateHeights(
    userStates.map((s) => Math.max(s.tasks?.length ?? 0, 1) + 2),
    rows - 1,
  );

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box height={rows - 1}>
        {sidebar && (
          <Box flexDirection="column" width={sidebarWidth} flexShrink={0} borderStyle="round" borderColor="gray" paddingX={1}>
            {users.map((u, i) => (
              <Text key={u.name} wrap="truncate-end" bold={i === selected} dimColor={i !== selected}>
                {i === selected ? '› ' : '  '}
                {u.name}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column" width={width}>
          {sources.map((s, i) => (
            <Section
              key={s.name}
              name={s.name}
              state={userStates[i]}
              width={width}
              height={heights[i]}
            />
          ))}
        </Box>
      </Box>
      <Text dimColor wrap="truncate-end">
        {' '}
        {users.length > 1 ? `${users[selected].name} · ` : ''}
        {allCycles ? 'all cycles · ' : 'current cycle · '}
        {updatedAt[selected] ? `Updated ${updatedAt[selected].toLocaleTimeString('en-GB')}` : 'Loading'}
        {refreshing ? ' · refreshing…' : ''} · r refresh · c cycle{users.length > 1 ? ' · j/k/g/G user · b sidebar' : ''} · q quit
      </Text>
    </Box>
  );
}
