# Contributing
Thanks for helping. This project manages people's real Claude configuration, so correctness and safety come before features.

## Setup
```
nvm use            # Node 22 (see .nvmrc)
npm ci
npm run verify     # typecheck + unit/architecture tests + license check
npm run dev
```

## Layout
`packages/core` is Electron-free logic with unit tests; `apps/desktop` is the Electron shell (`src/main` privileged, `src/preload` one function, `src/renderer` React UI). Read `docs/ARCHITECTURE.md` first.

## Rules that are enforced by tests or review
1. **Renderer boundary.** The renderer imports only React, relative modules and CSS (`tests/unit/boundary.test.ts`). No Node, no Electron, no `@skilldock/core`.
2. **IPC.** Add a channel in `apps/desktop/src/main/handlers.ts` with a zod schema. Pass ids, never file paths; re-resolve in main against an allow-list.
3. **Approval.** Anything that starts a process or spends the user's Claude usage must call `nativeConfirm` in main (the renderer's confirm dialog only explains).
4. **Writes.** Go through `runTransaction` (backup → atomic write → verify → rollback). Resolve symlinks first, check for concurrent edits, never `rm` a directory you did not create, never rewrite files an editor cannot represent.
5. **Untrusted input.** Use `safeJoin` for relative paths; check any value passed to a CLI starts alphanumeric (option injection); never execute third-party content.
6. **Honesty.** Claude behaviour must come from the official docs or observation of real files, cited in `docs/COMPATIBILITY_MATRIX.md`, and labelled "observed" if not documented. Docs describe what is implemented, not intended.
7. **No telemetry, no silent network calls, no accounts.**

## Tests
- `npm test` unit/integration/architecture (fast, no network).
- `npm run test:e2e` builds then runs the Electron e2e against isolated fixtures and a mock network.
- `node tests/qa/run.mjs` persona journeys + negative cases (evidence in `docs/qa/`).
- `node tests/e2e/a11y.e2e.mjs` axe sweep of every route in both themes; must report 0 serious/critical.
- `SKILLDOCK_LIVE=1 node tests/e2e/marketplace-live.e2e.mjs` real GitHub (60 calls/hour unauthenticated; set `SKILLDOCK_GH_TOKEN` for more). Installs only into a temp fixture.
Bug fixes need a regression test. Never run destructive tests against your real `~/.claude`.

## Pull requests
Small, focused, with the checklist in the PR template. Update `CHANGELOG.md` and the relevant doc. Dependency additions need a reason and a permissive license (`npm run licenses:check`).
