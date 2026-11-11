# tt — Task Tracker

A full-screen terminal view of what I'm working on, refreshed every minute:

- **Linear**: issues assigned to me in the current cycle (press `c` to include all cycles) in triage `↔` → todo `○` → in progress `◔` order, with priority (`!` urgent, `↑` high, `−` medium, `↓` low, `·` none), time in status and created date
- **GitHub**: one section per org in `GITHUB_ORGS`, with PRs where I'm requested as a reviewer (personally, not via a team) and PRs I created, marked `←` review requested / `→` open / `◌` draft, with only the badges that apply (a merge icon for conflicts or a required base update, checks `●` running / `✗` failed / `✓` passed, and a comment icon when there are unresolved review comments) and the opened date. Merge and comment icons need a Nerd Font

Issue keys and `repo#number` are terminal hyperlinks: click them (Cmd+click in most terminals) to open the issue or PR in the browser.

With `TT_USERS` set, a sidebar lists those people and the view shows the selected person's issues and PRs, under the same rules. Only the selected person is loaded: on start, when you switch, and on refresh. A person you viewed before shows their last data while reloading.

Keys: `r` refresh now, `c` toggle the cycle filter (current cycle ↔ all), `j`/`k` next/previous person, `g`/`G` first/last person, `b` toggle the sidebar, `q` quit.

## Install

Requires Node.js ≥ 22.

```sh
npm install
npm run build
npm link        # puts `tt` on your PATH
cp .env.example .env   # then fill it in (see below)
tt
```

`.env` is read from this project directory, so `tt` works from any directory.
`tt --once` prints the two lists as plain text and exits (useful for checking credentials).

## Credentials

| Variable | How to get it |
|---|---|
| `LINEAR_API_KEY` | Linear → Settings → Security & access → Personal API keys |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → Personal access tokens. Classic token with `repo` scope (fine-grained tokens cover only one owner). Or use the output of `gh auth token`. For orgs with SSO, authorize the token via *Configure SSO* |
| `GITHUB_ORGS` | Comma-separated org logins, e.g. `Ault-Blockchain,b-harvest` |
| `TT_USERS` | Optional. Comma-separated Linear display names, e.g. `hanjun,jihwan`. Leave empty to see only yourself |

## Limitations

- Linear status names are matched exactly (`Triage`, `Todo`, `In Progress`); edit `src/sources/linear.ts` if your team uses different names.
- `TT_USERS`: GitHub logins come from the GitHub account each person linked in Linear (their personal settings). Without one, that person's GitHub sections show an error. You only see what your own tokens can access.
- GitHub shows up to 30 PRs per list. A review request disappears once you submit a review.
- If a source fails, its section shows the error (and keeps the last good data marked `stale`); the other sections are unaffected.
- Links use OSC 8 terminal hyperlinks (Ghostty, iTerm2, WezTerm, kitty, …). Inside tmux they only work after enabling the feature for your outer terminal, e.g. in `~/.tmux.conf`: `set -as terminal-features ",xterm-ghostty:hyperlinks"`.
