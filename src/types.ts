export type Cell = { text: string; color?: string; dim?: boolean; url?: string };

// A row: fixed-width cells on the left, the title (truncated), then badges packed against the
// fixed-width cells on the right. Badges are per row: only the ones that apply are shown.
export type Task = { id: string; left: Cell[]; title: string; badges?: Cell[]; right: Cell[] };

// tasks undefined = never loaded; error set = last fetch failed
export type SourceState = { tasks?: Task[]; error?: string };

export function errorMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split('\n')[0];
}

// "Nov 9"
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Whole days since iso
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// Whose tasks to show. linear = Linear assignee filter; github = login for search
// (`@me` for yourself; undefined when the Linear user has no linked GitHub account).
export type User = { name: string; linear: object; github?: string };

// View options toggled with keys. allCycles: Linear issues outside the current cycle too.
export type View = { allCycles: boolean };
