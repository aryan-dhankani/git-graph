# git-graph ("gg") — handover

A personal VS-Code-style commit graph viewer. Built 2026-07-30, used across all of Ashish's local
projects (not specific to this repo).

## What it is

A single Node script, `git-graph.mjs`, that serves an HTML commit-graph page from a local repo. It
runs a fixed set of **read-only** git commands (`rev-parse`, `remote get-url`, `log`, plus
`git fetch --prune` only when you click the refresh button) and binds to `127.0.0.1` only. It never
writes to the repo and never takes shell input from the page.

## Install / setup

1. Copy `git-graph.mjs` to the new machine (e.g. `~/.claude/tools/git-graph.mjs`). It has no
   dependencies beyond Node's built-ins (`http`, `fs`, `child_process`, `path`, `util`).
2. Run it from (or pointed at) a git repo:
   ```bash
   node git-graph.mjs                 # current directory
   node git-graph.mjs ../other-repo   # another repo path (bare args = repo paths)
   node git-graph.mjs --port 8080     # custom port (default 7345)
   node git-graph.mjs --target origin/main   # branch the sync button targets (default origin/uat)
   node git-graph.mjs --count 500     # commits to load (default 300)
   ```
3. Open `http://127.0.0.1:<port>` (default `http://127.0.0.1:7345`).

## Features (local mode only)

The page feature-detects `location.hostname === localhost` — served from a real machine it unlocks:

- **Repo picker** — auto-discovers every git repo that's a sibling of the launch repo, plus any
  saved paths in `~/.claude/git-graph-repos.json`.
- **Fetch & refresh** button, plus a 60s auto-refresh toggle.
- **One-click sync** — fast-forwards or rebases the current branch onto `origin/<target>` (falls
  back to the branch's own upstream if that ref doesn't exist).
- Writes (fetch/sync) require `POST` with header `x-git-graph: 1`, so no other site can drive it
  via localhost CSRF.

## Data format

Graph data comes from:
```
git log --all --date-order -200 --shortstat --pretty=format:"@@@%H|%h|%P|%an|%aI|%D|%s%n%b"
```
The `@@@` marker delimits records so multi-line commit bodies survive intact. The page also parses
the older one-line-per-commit format (without bodies/stats) for backward compatibility.

## Design language

Spec-sheet look: JetBrains Mono micro-labels, hairlines, token-based colors, no hover glows —
matches the rest of Ashish's internal tooling aesthetic.

## Non-local / sandboxed mode

There's also a pinned Claude Artifact version (paste-driven — an artifact is sandboxed and can't
shell out or hit localhost, so it can't fetch/sync live). To use it:
1. Run `node git-graph.mjs` locally to regenerate the log output above.
2. Paste it into the artifact page.

Ask Ashish for the current pinned artifact URL if you want that version instead of running your own
local instance — it's easiest to just run the script yourself per the steps above.

## Files

| File | Purpose |
|------|---------|
| `git-graph.mjs` | The server + page (this is the only file you need to copy) |
| `~/.claude/git-graph-repos.json` | Optional saved extra repo paths for the picker (auto-created, safe to omit) |
