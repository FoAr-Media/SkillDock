# Architecture
```
apps/desktop            Electron (electron-vite) + React renderer
  src/main/handlers.ts  every IPC channel: zod schema → core call. App state (Store, paths, token) lives here.
  src/main/index.ts     window, sender validation, navigation lock, permission denial
  src/preload           one function: invoke(channel, payload); channel name pattern-checked
  src/renderer          app/ (shell), features/<screen>/, shared/ (api, ui, brand), design/ (tokens, styles); see design/CODE_MAP.md
packages/core           Electron-free Node logic (all unit-tested)
  fsutil / backup       safeJoin, atomicWrite, backups, transactions + journal (crash recovery)
  config                conflict-checked JSON/text writes (preserve unknown keys), diffs
  store                 node:sqlite, migrations: installs, audit, sources/entries cache, orgs, presets…
  skills / environment  read-only discovery (user, project, plugin, legacy commands; follows symlinks)
  security              advisory static scanner
  github / install      pinned-SHA staging of ONE folder, plan → apply → verify → record, uninstall, updates
  marketplace           repo discovery, plugin manifests, MCP registry, inferred categories, local query
  mcp                   discovery across scopes, masked editing, gated handshake diagnostics
  workspace             config files, inheritance, agents, hooks, plugins (via claude CLI), commands, projects
  studio / catalog      templates, generation, static validation, test cases, org manifests, presets
```
## Data flow for an install
renderer `install:planGithub` → main validates → core stages to `<appdata>/staging/<id>` (limits, safeJoin, no symlinks) → scan + hash + conflict check → plan (never touches Claude dirs) → user reviews → `install:apply` → backup target → copy → verify hash equals plan + Claude would discover it → record in SQLite → audit. Any error restores the backup.

## Source of truth
Claude's files are authoritative. SQLite is an index/cache/journal. Installed state in the UI is re-read from disk on each view; an `installations` row only adds provenance (source, SHA, tree hash for local-modification detection).

## Adapters
Claude-specific paths/formats are isolated in `paths.ts`, `skills.ts`, `mcp.ts`, `workspace.ts`. Another assistant would add sibling modules; the plan/transaction/store layers are assistant-agnostic.
