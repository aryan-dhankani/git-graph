# git-graph ("gg") — handover

A personal VS-Code-style commit graph viewer, grown into a small worktree cockpit. Built
2026-07-30, used across all of Ashish's local projects (not specific to any one repo).

## What it is

A single Node script, `git-graph.mjs`, with no dependencies beyond Node's built-ins. It serves an
HTML page that draws the commit graph of a local repo, and — because it runs on your machine
rather than in a sandbox — it can also act on that repo: fetch, sync, push, switch branch, install
a worktree's dependencies, and run dev servers.

Everything binds to `127.0.0.1` / `::1` only. The page never sends a path or a command; it sends a
**repo index** from the list this process discovered and, at most, a validated port number. Every
write requires `POST` with the header `x-git-graph: 1`, which forces a CORS preflight the server
never answers, so another site you have open cannot drive it through localhost.

## Install / setup

1. Copy `git-graph.mjs` somewhere stable (e.g. `~/.claude/tools/git-graph.mjs`).
2. Run it from, or pointed at, a git repo:
   ```bash
   node git-graph.mjs                      # current directory
   node git-graph.mjs ../other-repo        # extra repo paths are bare arguments
   node git-graph.mjs --port 8080          # the graph UI itself (default 7345)
   node git-graph.mjs --count 500          # commits to load (default 300)
   node git-graph.mjs --target origin/main # what the sync button aims at (default origin/uat)
   node git-graph.mjs --dev-port 5186      # the shared dev-server port (default 5186)
   node git-graph.mjs --dev-cmd npm        # package manager for dev servers (default pnpm)
   node git-graph.mjs --warm 3             # how many dev servers stay warm (default 3)
   ```
3. Open `http://127.0.0.1:<port>` (default `http://127.0.0.1:7345`).

A shell alias makes it one word. PowerShell (`notepad $PROFILE`):

```powershell
function gg { node "$HOME\.claude\tools\git-graph.mjs" @args }
```

## The graph

- Lane assignment follows VS Code's: a lane belongs to the commit expected there, the first parent
  inherits it, extra merge parents claim their own. Rounded quarter-arc joins; merge lines leave
  the node sideways and drop down the parent's lane.
- Node shape encodes parent count — filled dot = ordinary commit, hollow ring = merge, square =
  root, dashed stub = a parent outside the loaded window.
- Hover any commit for author, full timestamp, body, diffstat, click-to-copy hash and an **Open on
  GitHub** link (inferred from `origin`, so it is absent rather than wrong when there is no match).
- Click a commit to trace its ancestry; search and the author toggles **dim** rather than remove
  rows, so the topology never lies. Esc clears.
- A theme button cycles system / light / dark, stamped before first paint so there is no flash.

## Repos, worktrees, branches

- **Repo picker** — every git repo that is a sibling of the launch repo, plus saved paths in
  `~/.claude/git-graph-repos.json`. It rescans on open, with ids that only ever append, so a repo
  cloned after startup appears without a restart and never renumbers the one you are viewing.
- **Add a repo…** opens a folder browser served by the runner (a browser's own picker cannot give
  a real path — `showDirectoryPicker` returns only a folder name).
- **Worktrees** are listed under the repo they belong to, found with `git worktree list
  --porcelain`, because linked worktrees usually live nowhere near their repo and no folder scan
  can find them. Each carries its own branch, working tree, sync and push state.
- **Branch switcher** — the branch chip opens a filterable quick-pick (type, arrows, Enter). A
  branch checked out in another worktree is listed but disabled; a remote-only branch creates a
  local tracking branch. Checkout does *not* pre-refuse a dirty tree: git carries uncommitted
  changes across when they don't collide, and its own message is surfaced when they do.

## Working tree

A collapsible strip above the graph, grouped the way an editor does it: merge conflicts, staged,
changes, untracked — with status letters, per-file `+/-`, and the folder (not the filename)
truncated when a path is long.

It reads the tree by **content**, not by stat: `git diff --name-status` against the index plus
`ls-files --others --exclude-standard --directory`. `git status` reports a file whose mtime moved
but whose bytes are identical, which used to block syncing on changes that did not exist.
`--directory` also matters — without it a stray `node_modules` lists twenty thousand files.

## Acting on the repo

- **Fetch & refresh**, plus a 60s **Auto** toggle. The first load fetches, so the buttons below
  reflect the remote rather than a stale clone.
- **Sync** — fast-forwards when you have no local commits, otherwise rebases onto the target
  (falling back to the branch's own upstream when that ref is absent here). It refuses on a dirty
  tree, a detached HEAD or an unfinished merge, and on conflict it aborts back to the starting
  commit and names the files. Every success reports its undo: `git reset --hard <sha>`.
- **Push** — fast-forward only. When the upstream has commits you don't, it refuses and tells you
  to sync first. **It cannot force-push**: no `--force`, no `--force-with-lease`, no `+refspec`
  anywhere in the file. A branch with no upstream is published with `--set-upstream`.

## Dev servers: switching worktrees without a restart

A Vite process cannot change its root — root, config, module graph and dep cache are fixed when it
boots. So each worktree gets its own dev server on a private port (`--dev-port` + 1, + 2, …) and a
**proxy owns the shared port** and decides which one answers.

The browser therefore never leaves `http://localhost:5186`, which is the point: the session cookie
survives, so you stay logged in across worktrees. Switching to a worktree that is already warm is
a pointer move — measured at ~0.2s against ~14s for a cold boot of a large app.

- Row states: `live :5186` (being served), `warm` (running, one click away), `booting`.
- `--warm N` caps the pool; past that the least recently used server is stopped.
- The proxy injects a small `EventSource` snippet into served HTML, so a tab you already have open
  **reloads itself** into the newly active worktree. It also proxies the HMR websocket upgrade.
- A worktree with no `node_modules` cannot run anything, so the row says **needs install** and
  offers the right package manager instead of a Start button that would die on `'vite' is not
  recognized`. Installing also copies `.env`, `.env.local` and `amplify_outputs.json` from the main
  worktree when they are missing — git does not carry them. It never junctions `node_modules`;
  `git worktree remove` deletes through a junction.

The proxy listens on **both loopback families**. `localhost` resolves to `::1` first, so binding
only `127.0.0.1` leaves the IPv6 loopback free — a stray `vite --host` already listening there
would silently answer the browser instead of the proxy, and the bind would still look successful.
A private `/__gg/ping` self-test on each family reports a conflict rather than pretending to work.

## Data format

Graph data comes from:

```
git log --all --date-order -300 --shortstat --pretty=format:"@@@%H|%h|%P|%an|%aI|%D|%s%n%b"
```

The `@@@` marker delimits records so multi-line commit bodies survive. The older
one-line-per-commit format still parses, without bodies or stats.

## Sandboxed (paste) mode

The same page also runs as a published Claude Artifact. An artifact is sandboxed — it cannot shell
out or reach localhost — so there it is paste-driven: run the command above (append `| clip`,
`| pbcopy` or `| xclip`) and use **Read clipboard & draw**. Named pastes are kept in browser
storage, so one pinned tab can hold snapshots of several repos. Everything in *Acting on the repo*
and *Dev servers* is local-mode only and stays hidden there.

## Design language

Spec-sheet look: JetBrains Mono micro-labels, hairlines, token-based colours, no hover glows —
the same aesthetic as the rest of Ashish's internal tooling. Lane colours carry all the hue; the
chrome stays quiet.

## Files

| File | Purpose |
|------|---------|
| `git-graph.mjs` | The server, the proxy and the page — the only file you need to copy |
| `~/.claude/git-graph-repos.json` | Optional saved repo paths for the picker (auto-created) |
