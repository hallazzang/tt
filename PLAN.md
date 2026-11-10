# tt — Task Tracker: Implementation Plan

## Goal

`tt` is a full-screen terminal dashboard. You start it by typing `tt`, and it shows two lists:

1. **Linear**: issues assigned to me with status `Triage`, `Todo` or `In Progress`.
2. **GitHub**: open PRs in the orgs listed in `.env` (one section per org) where I am explicitly requested as a reviewer, plus open PRs I created.

Slack To-dos were considered and dropped: Slack has no official API for them.

It reloads everything every minute. It has no other features: it does not create, edit or mark items done.

## Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language / runtime | TypeScript, Node.js ≥ 22 | `process.loadEnvFile()` is built in, so no `dotenv` package |
| TUI | [`ink`](https://github.com/vadimdemedes/ink) (React for CLIs) | Declarative layout with flexbox `Box`/`Text`, simplest way to stack sections |
| Linear | [`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk) (official) | |
| GitHub | [`@octokit/graphql`](https://www.npmjs.com/package/@octokit/graphql) (official Octokit) | One GraphQL call covers both PR queries |
| Build | `tsc` → `dist/`, `"bin": { "tt": "dist/index.js" }`, install with `npm link` | |

## Credentials (`.env`)

```
LINEAR_API_KEY=lin_api_...        # Linear → Settings → Security & access → Personal API keys
GITHUB_TOKEN=ghp_...              # classic PAT with `repo` scope, or fine-grained with PR read
GITHUB_ORGS=org-a,org-b           # orgs to show PRs from; one section each
```

- `.env` is read from the tt project directory, resolved from `import.meta.url`, so `tt` works from any working directory. The repo includes `.env.example`, and `.env` goes in `.gitignore`.
- If a source's variables are missing, tt keeps running and that section shows `not configured`.

## Data sources

Both sources return the same shape:

```ts
type Cell = { text: string; color?: string; dim?: boolean; url?: string };
type Task = { id: string; left: Cell[]; title: string; badges?: Cell[]; right: Cell[] };
// left/right = fixed-width columns around the truncated title; badges = per-row icons packed before `right`;
// a cell with url is a clickable hyperlink
```

### Linear: `src/sources/linear.ts`

- `new LinearClient({ apiKey })`.
- Fetch through the SDK's raw GraphQL client (`client.client.request`) to get everything in **one request**. The model API lazy-loads `issue.state`, which would cost one extra call per issue.
  ```graphql
  query {
    viewer {
      assignedIssues(
        first: 50
        filter: { state: { name: { in: ["Triage", "Todo", "In Progress"] } } }
        orderBy: updatedAt
      ) { nodes { identifier title url priority createdAt state { name } stateHistory(last: 3) { nodes { startedAt endedAt } } } }
    }
  }
  ```
- Sorting: `triage`, then `todo`, then `in progress`.
- Columns: priority (`·` none, `!` urgent orange, `↑` high yellow, `−` medium white, `↓` low gray), status (`↔` triage orange, `○` todo white, `◔` in progress yellow), issue key | title | time in status (`3d`, from the `stateHistory` span with `endedAt = null`; dim below 7 days, yellow from 7, red from 14), created (`Nov 9`).
- Note: the filter matches status names exactly. If a team renames its states, edit the list in code. No config option.

### GitHub: `src/sources/github.ts`

- One request per org in `GITHUB_ORGS`, each with two aliased searches (`org:<org>` is added to both queries):
  ```graphql
  query {
    review: search(type: ISSUE, first: 30,
      query: "is:pr is:open archived:false org:<org> user-review-requested:@me") { ...pr }
    mine: search(type: ISSUE, first: 30,
      query: "is:pr is:open archived:false org:<org> author:@me") { ...pr }
  }
  fragment pr on SearchResultItemConnection {
    nodes { ... on PullRequest { number title url isDraft createdAt repository { name }
      mergeable mergeStateStatus
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      reviewThreads(first: 100) { nodes { isResolved } } } }
  }
  ```
- `user-review-requested:@me` matches only requests to me personally, not to a team I belong to. That is the "explicitly assigned" requirement.
- GitHub removes a review request once I submit a review. Those PRs drop out of the list, which is the intended "still needs my action" behavior.
- Labels, in this order: `←` review requested (magenta), then my PRs as `→` open (green) or `◌` draft (gray). A PR in both lists is shown once, as `←`.
- Columns: label, `repo#number` | title | badges | opened (`Nov 9`).
- Badges are per row and packed against the date: only the ones that apply are shown, in this order:
  - merge problem (Nerd Font Codicons): red `cod-git_merge` (U+EAFE) for a conflict (`mergeable = CONFLICTING`), yellow `cod-sync` (U+EA77) when the base branch must be merged in (`mergeStateStatus = BEHIND`, only reported when the repo requires up-to-date branches); nothing while GitHub is still computing;
  - checks: yellow `●` running, red `✗` failed, green `✓` passed; nothing when the PR has no checks;
  - unresolved comments: white `cod-comment` (U+EA6B) when any review thread has `isResolved = false` (no count).
- The org is in the section title, so rows show only `repo#number`.

## UI

Full screen, sections stacked vertically, top to bottom: Linear, then one GitHub section per org:

```
┌ Linear ────────────────────────────────────────────────────────────────┐
│ ! ↔ ENG-250 Faucet returns 500 on testnet                    0d Nov 10 │
│ · ○ ENG-240 Write runbook for validator upgrade              3d  Nov 7 │
│ ↑ ◔ ENG-231 Fix order book snapshot race when two validat…   4d  Nov 2 │
│ − ◔ ENG-198 Add metrics for miner epoch                     12d Oct 27 │
└────────────────────────────────────────────────────────────────────────┘
┌ GitHub · my-org ───────────────────────────────────────────────────────┐
│ ← dex#412  Add OHLCV endpoint                                    Nov 3 │
│ → chain#88 Rate limit module params                             Oct 27 │
│ ◌ tt#3     Initial implementation                               Oct 19 │
└────────────────────────────────────────────────────────────────────────┘
 Updated 16:42:10 · r refresh · q quit
```

Rules:
- **Full screen**: Ink's `alternateScreen` render option, which enters the terminal's alternate screen buffer on start and restores the previous contents on exit (`q`, Ctrl-C). Re-render when the terminal is resized.
- **Height**: sized by content, minus the footer. A section that needs less than an even share gets exactly its rows; the others split the rest, so rows are only hidden when the whole screen is full. Spare rows are spread evenly. If a section still has more items than fit, show as many as fit and end with `… +N more`.
- **Width**: one item per line, columns separated by 1 space. Left and right cells have fixed widths (the widest value in the section); the title takes the rest and is cut with `…`. Right cells are right-aligned. No wrapping.
- **States per section**: `loading…` on the first load; `Nothing here ✓` when empty; a one-line red error (e.g. `Bad credentials`) when a fetch fails. If an earlier fetch succeeded, keep showing that data with a dim `(stale: <error>)` marker in the title.
- **Colors**: section titles are bold, uncolored, and show no item count. Status/tag colors: Linear as listed above; GitHub `←` magenta, `→` green, `◌` gray.
- **Links**: issue keys and `repo#number` are OSC 8 terminal hyperlinks, so clicking them opens the issue/PR in the default browser. Inside tmux this needs `terminal-features ...:hyperlinks` enabled.
- **Keys**: `q` / Ctrl-C quit, `r` refresh now. Nothing else.

## Refresh loop

- On start, and then every 60 s, fetch all sources in parallel with `Promise.allSettled`. One failing source never blocks the others.
- If a refresh is still running when the next one is due, skip the new one.
- The footer shows the last update time (and `refreshing…` while a refresh runs). No countdown.

## Project layout

```
tt/
├── package.json        # "type": "module", "bin": { "tt": "dist/index.js" }
├── tsconfig.json       # strict, jsx: react-jsx, module/moduleResolution: NodeNext
├── .env.example
├── .gitignore          # node_modules, dist, .env
├── README.md           # setup: install, getting each credential, npm link
└── src/
    ├── index.tsx       # shebang, load .env, alt screen enter/exit, render(<App/>)
    ├── app.tsx         # layout, refresh timer, key handling
    ├── section.tsx     # one bordered section: title, count, rows, states
    ├── types.ts        # Task, SourceResult
    └── sources/
        ├── linear.ts
        └── github.ts
```

About 250 lines of code in total. No state management library, no config file, no persistence.

## Implementation steps

1. **Scaffold**: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, and dependencies (`ink`, `react`, `@linear/sdk`, `@octokit/graphql`; dev: `typescript`, `@types/react`, `@types/node`).
   → verify: `npm run build` produces `dist/index.js`; `npm link`, then `tt` runs.
2. **Sources**: each module exports `fetchX(): Promise<Task[]>`. Add a `--once` debug flag that prints the two lists as plain text and exits.
   → verify: `tt --once` output matches what Linear and GitHub show in their own apps.
3. **UI**: `Section` + `App` with the layout, truncation, `+N more`, loading/empty/error/stale states, footer and keys.
   → verify: looks right at 80×24 and in a large terminal; resizing redraws cleanly; a bad token in one source shows an error only in that section.
4. **Refresh loop + full screen**: 60 s interval, overlap guard, alternate screen enter/exit.
   → verify: completing a Linear issue or a GitHub review disappears from the list within about a minute; after `q` or Ctrl-C the terminal returns to its previous contents.
5. **README**: install, how to get each credential, known limits.

## Known risks / limitations

- **Rate limits**: Linear makes 1 request per refresh and GitHub 1 per org (240/hour each), well within both APIs' limits.
- **Linear status names** are hard-coded as `Triage` / `Todo` / `In Progress`.
- **GitHub** shows at most 30 PRs per query per org, which is enough for a personal dashboard.
