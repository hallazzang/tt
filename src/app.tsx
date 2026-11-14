import { execFile } from 'node:child_process';
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

type Selection = { id?: string; index: number };

function selectionIndex(tasks: Task[] | undefined, selection: Selection): number {
  const found = tasks?.findIndex((task) => task.id === selection.id) ?? -1;
  return found >= 0 ? found : Math.max(0, Math.min(selection.index, (tasks?.length ?? 0) - 1));
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
  const [pane, setPane] = useState(0);
  const [selections, setSelections] = useState<Selection[]>(sources.map(() => ({ index: 0 })));
  const pendingG = useRef(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [updatedAt, setUpdatedAt] = useState<(Date | undefined)[]>(users.map(() => undefined));
  const [allCycles, setAllCycles] = useState(false);
  const allCyclesRef = useRef(false);
  allCyclesRef.current = allCycles;
  const [refreshing, setRefreshing] = useState(false);
  const lastStart = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

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

  const userStates = states[selected];
  useEffect(() => {
    setSelections((previous) => userStates.map((state, i) => {
      if (!state.tasks) return previous[i];
      const index = selectionIndex(state.tasks, previous[i]);
      return { index, id: state.tasks[index]?.id };
    }));
  }, [userStates]);

  useInput((input, key) => {
    if (key.ctrl || key.meta || key.eventType === 'release') {
      pendingG.current = false;
      return;
    }
    const first = input === 'gg' || (input === 'g' && pendingG.current);
    pendingG.current = input === 'g' && !first;
    if (input === 'q') return exit();
    if (input === 'r') { refresh(); return; }
    if (input === 'c') {
      // loaded data no longer matches the filter, so clear it for every user.
      setAllCycles((v) => !v);
      setStates(users.map(() => sources.map(() => ({}))));
      setSelections(sources.map(() => ({ index: 0 })));
      setUpdatedAt(users.map(() => undefined));
      return;
    }
    if (input === 'b' && users.length > 1) {
      setSidebar((v) => !v);
      if (pane === -1) setPane(0);
      return;
    }
    if (input === 'h') { setPane((i) => Math.max(sidebar ? -1 : 0, i - 1)); return; }
    if (input === 'l') { setPane((i) => Math.min(sources.length - 1, i + 1)); return; }
    if (input === 'o' || key.return || input === 'y') {
      const tasks = userStates[pane]?.tasks;
      const task = pane >= 0 ? tasks?.[selectionIndex(tasks, selections[pane])] : undefined;
      if (input === 'y') {
        if (!task?.branch) return;
        const branch = task.branch;
        const command = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'win32' ? 'clip.exe' : process.env.WAYLAND_DISPLAY ? 'wl-copy' : 'xclip';
        const args = command === 'xclip' ? ['-selection', 'clipboard'] : [];
        let inputError: Error | undefined;
        const child = execFile(command, args, (error) => {
          const failure = error ?? inputError;
          setNotice(failure ? { text: `Could not copy branch: ${errorMessage(failure)}`, error: true } : { text: `Copied branch: ${branch}` });
        });
        child.stdin?.on('error', (error: Error) => { inputError = error; });
        child.stdin?.end(branch);
        return;
      }
      const url = task && [...task.left, ...task.right].find((cell) => cell.url)?.url;
      if (url) {
        setNotice(undefined);
        const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
        execFile(command, [url], (error) => {
          if (error) setNotice({ text: `Could not open link: ${errorMessage(error)}`, error: true });
        });
      }
      return;
    }
    if (input !== 'j' && input !== 'k' && input !== 'G' && !first) return;
    const count = pane === -1 ? users.length : userStates[pane]?.tasks?.length ?? 0;
    if (!count) return;
    const move = (index: number) => first ? 0 : input === 'G' ? count - 1 : Math.max(0, Math.min(count - 1, index + (input === 'j' ? 1 : -1)));
    if (pane === -1) {
      const next = move(selected);
      if (next !== selected) {
        setSelected(next);
        setSelections(sources.map(() => ({ index: 0 })));
        setNotice(undefined);
      }
    } else {
      setSelections((previous) => previous.map((selection, i) => {
        if (i !== pane) return selection;
        const tasks = userStates[i].tasks;
        const index = move(selectionIndex(tasks, selection));
        return { index, id: tasks?.[index]?.id };
      }));
    }
  });

  // sidebar: selection marker and name, plus border and padding.
  const sidebarWidth = sidebar ? Math.min(Math.max(...users.map((u) => u.name.length)) + 6, Math.max(0, columns - 10)) : 0;
  const width = Math.max(0, columns - sidebarWidth);
  const bodyHeight = Math.max(0, rows - 1);
  const peopleStart = Math.max(0, selected - Math.max(1, bodyHeight - 2) + 1);

  // Each section needs its rows plus 2 border rows; the last screen row is the footer.
  const heights = allocateHeights(
    userStates.map((s) => Math.max(s.tasks?.length ?? 0, 1) + 2),
    bodyHeight,
  );

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box height={bodyHeight} overflow="hidden">
        {sidebar && (
          <Box flexDirection="column" width={sidebarWidth} flexShrink={0} borderStyle="round" borderColor={pane === -1 ? 'cyan' : 'gray'} paddingX={1} overflow="hidden">
            {users.map((u, i) => (
              <Text key={u.name} wrap="truncate-end" color={pane === -1 && i === selected ? 'cyan' : undefined} bold={i === selected} dimColor={i !== selected}>
                {i === selected ? '> ' : '  '}
                {u.name}
              </Text>
            )).slice(peopleStart, peopleStart + Math.max(0, bodyHeight - 2))}
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
              focused={pane === i}
              selected={selectionIndex(userStates[i].tasks, selections[i])}
            />
          ))}
        </Box>
      </Box>
      <Text dimColor wrap="truncate-end">
        {notice ? <Text color={notice.error ? 'red' : 'green'}>{notice.text}</Text> : <>
          {' '}
          {users.length > 1 ? `${users[selected].name} · ` : ''}
          {allCycles ? 'all cycles · ' : 'current cycle · '}
          {updatedAt[selected] ? `Updated ${updatedAt[selected].toLocaleTimeString('en-GB')}` : 'Loading'}
          {refreshing ? ' · refreshing…' : ''}
          {' · h/l pane · j/k row · gg/G ends · o/Enter open · y branch · r refresh · c cycle'}{users.length > 1 ? ' · b sidebar' : ''} · q quit
        </>}
      </Text>
    </Box>
  );
}
