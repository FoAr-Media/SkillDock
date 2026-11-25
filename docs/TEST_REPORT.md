# Test report
Generated from real runs; raw results: `docs/e2e-results.json`, `docs/a11y-report.json`, screenshots in `docs/screenshots/`.

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean |
| Unit/integration + architecture boundary | `npm test` | 52 passed (1 live test skipped by default): includes review reproductions, boundary tests and 9 semantics tests (F15/F16) |
| Live network | `npm run test:live` | passed: real anthropics/skills discovery + single-skill install/uninstall + MCP registry |
| Electron e2e | `npm run test:e2e` | 44 steps (see docs/e2e-results.json): personas A–G, all routes, security, keyboard, 3 viewports, axe, offline, real read-only, 4 review-regression steps |
| Packaged app | `node tests/e2e/packaged.e2e.mjs` | passed: packaged build launches, reads real ~/.claude, no telemetry, devtools off |

## Bugs found by the suite and fixed
- Marketplace installs recorded the commit SHA as ref → updates never detected (now tracks default branch).
- Modal stole focus from autofocused inputs (command palette typing did nothing).
- Nav icon glyphs polluted accessible names; marketplace tabs lacked tab roles; two pages lacked an h1.
- `window.prompt` (unsupported in Electron) used for "Add file" → inline input.

## Not tested (see PROGRESS.md limitations)
Windows/Linux runs, real private repo, `claude plugin` actions, `claude -p` execution, token save via keychain.

## Independent review (v0.1.1)
See docs/IMPLEMENTATION_PLAN.md. 13 defects found (7 P0, 6 P1/hardening); each was reproduced by a failing test first and then fixed. Plus packaging bloat (F20). Open P2/P3 items are listed there, not hidden.

## F15/F16 (v0.1.2)
Rules taken from the official MCP/settings/skills pages (see COMPATIBILITY_MATRIX). Unit tests cover trust gating, rejection precedence, enableAll, disabledMcpServers, observed-only arrays, scope override, realpath project keys, skill precedence/namespacing/reserved/builtin/duplicate. E2E screenshots: docs/screenshots/21-mcp-approval-states.png, 22-skill-name-conflicts.png. Also fixed: false "link" badge on every skill when an ancestor directory is aliased.

## Marketplace vertical slice (v0.2.0)

Method: sources were found by GitHub topic search and web research (not recalled), their structure was verified from the API, discovery was implemented against the shapes found, and the same discovery was then run against the **real repositories**. Numbers below are a **snapshot from 2026-11-24 13:53 UTC**, read from the GitHub API at run time (unauthenticated: `26` API calls). Nothing is hardcoded and the stars are repository-level. Raw data: `docs/live-marketplace-report.json` (after fixes) and `docs/live-marketplace-report.before-fixes.json` (first run).

| Area | Real repository | Repo ★ | License | Skills listed (first run → after fixes) | Per-agent copies folded | Top inferred categories |
|---|---|---|---|---|---|---|
| video production | `remotion-dev/skills` | 7,925 | none declared | 13 → **13** | 0 | Video creation 13, Video editing 1, Documentation 1 |
| video production | `digitalsamba/claude-code-video-toolkit` | 2,742 | MIT | 17 → **17** | 0 | Video creation 17, Audio production 15, Video editing 7 |
| development | `addyosmani/agent-skills` | 120,126 | MIT | 26 → **26** | 0 | Software development 6, Testing 3, Productivity 3 |
| development | `obra/superpowers` | 325,613 | MIT | 15 → **15** | 0 | Software development 5, Productivity 3, Content creation 2 |
| productivity | `obsidianmd/obsidian-skills` | 53,604 | MIT | 7 → **7** | 0 | Productivity 7, Graphic design 1 |
| productivity | `OthmanAdi/planning-with-files` | 28,217 | MIT | 17 → **6** | 12 | Productivity 6, Software development 6 |
| design | `pbakaus/impeccable` | 116,014 | Apache-2.0 | 24 → **4** | 22 | UI/UX design 2, Testing 2 |
| design | `anthropics/skills` | 199,724 | none declared | 20 → **20** | 0 | Productivity 4, Office documents 3, Documentation 2 |

What the real-data run found, and what was changed because of it (the mock tests could not have shown these):
- **Classification was polluted by repo-level topics and the words "Claude Code".** Before: `digitalsamba` marked all 17 skills "Audio production"/"Video creation"; `planning-with-files` and `obsidian-skills` marked every skill "Software development" (86 "Software development" labels overall). Fix: topics are weak, once-only evidence; "Claude Code" is stripped before matching; bare "code" is no longer a development term. After: 22 labels, and the remaining video/audio labels on `claude-code-video-toolkit` are backed by the skills' own descriptions (e.g. `acestep`: "background music… audio stems… for video production").
- **Dedupe was too narrow.** `pbakaus/impeccable`: 24 listings → **4**; `planning-with-files`: 17 → **6** after folding per-agent copies (`.agents/`, `.codex/`, `.codebuddy/`… whose bytes differ slightly). Entries show "+N mirrors" and whether copies differ.
- **Install findings were unreadable** (230 findings for one skill's docs). They are now grouped by rule and file with severity totals.
- **Huge repositories** (`sickn33/agentic-awesome-skills`, ≈10,000 `SKILL.md`): listed from the tree in **index-only** mode: the first run (`live-marketplace-report.before-fixes.json` → `huge`) listed 3,453 skills with nothing fetched eagerly, and opening one entry loaded its real description (284 characters). That run predates the tool-folder dedupe widening, so the count today would be lower; the after-fix run skipped this check on purpose because its API budget was spent (recorded in its `notes`), and it has not been re-measured.
- Registry/search: GitHub topic search returned 10 unverified candidates; the MCP Registry returned 8 results for "video" (8 with an installable config).
- A real video skill (`remotion-best-practices`, 130 files) was staged, inspected (`review-recommended`), installed into a **temp HOME**, verified, uninstalled. The real `~/.claude` was never written.

### Honest limitations of this slice
- Categories are keyword heuristics. They are labelled "inferred" and show their evidence; expect misses and some false positives.
- Unauthenticated GitHub allows 60 API calls/hour (≈3 per repository refresh). The app shows the remaining budget, reuses the cache when a commit is unchanged, and stops a batch at the first rate-limit response. A token (Settings) lifts the limit.
- Root-level skills whose folder exceeds the install limits (300 files / 25 MB) are shown but marked not auto-installable.
- Plugin installs still go through the `claude plugin` CLI and were not executed here.

## Dedicated QA pass (v0.2.1)
Run: `node tests/qa/run.mjs` against the built app, one fresh Electron instance + isolated fixture per journey, mock network with injectable failures (GitHub down, connection reset mid-download, hostile trees). Evidence for **every** case (expected, actual, screenshot): `docs/qa/EXECUTION_EVIDENCE.md`, `docs/qa/execution-evidence.json`, `docs/qa/screenshots/`. Generated 2026-11-24 15:08 UTC.

| Journey | Passed | Failed | Not executed | of which UI+IPC* |
|---|---|---|---|---|
| A beginner (video skill) | 10 | 0 | 0 | 0 |
| B full-stack developer | 8 | 0 | 0 | 2 |
| C AI content creator | 8 | 0 | 0 | 0 |
| D skill developer | 10 | 0 | 1 | 1 |
| E organization admin | 9 | 0 | 0 | 1 |
| F security-conscious | 11 | 0 | 0 | 4 |
| G advanced existing user | 10 | 0 | 0 | 2 |
| G invalid configuration | 6 | 0 | 0 | 3 |
| G missing dependency | 4 | 0 | 0 | 2 |
| **Total** | **76** | **0** | **1** | 15 |

\* "UI+IPC" cases drive the real UI for part of the case and call the real main-process IPC channel for the rest (used where the UI would need a native dialog, e.g. registering a project, or to assert main-process behaviour such as a refused write). They run in the real app, not in a mock of it. All other cases are UI-only.

Each persona journey includes its negative cases: network failure mid-download and an unreachable GitHub (A), duplicate skills/MCP names/agents/projects (B), mirrored, root-level, oversized and huge repositories (C), invalid frontmatter, path traversal in file names, read-only folders (D), invalid/duplicate/insecure catalogs, private repository without a token, managed-policy lock (E), high-risk plans, three hostile path forms, symlink/submodule entries, oversized/too-many-files, permission-denied install rollback, a hung MCP server with a process-orphan check, secret masking (F), external changes, corrupt `settings.json` and `~/.claude.json`, unreadable skill folder, read-only settings, a skill folder appearing between plan and approval, stale install records, missing `claude` CLI (G).

**First run: 59 passed, 17 failed. Triage found 11 product defects (2 High, 6 Medium, 3 Low), all fixed and regression-tested; the other failures were bugs in the QA suite itself.** See `docs/DEFECT_REPORT.md` for severity, reproduction, expected vs actual, and the verifying test for each.

**Regression after fixes:** QA 76/76 executed cases pass; mock e2e 45/45; unit 78 passed (9 new defect tests: DEF-02/03/04/05/06/07/09/10/11; DEF-01 and DEF-08 are UI-level and are covered by QA cases A-06 / `*-runtime` and by the packaged-app clipboard check); live marketplace e2e 12/12 (real GitHub, run before the QA-driven fixes and not repeated after them).

Not executed, and not counted as passed: D-10 Export a skill to a chosen folder (needs the native folder-picker dialog, which Playwright cannot drive; lossless export is unit-tested (exportSkillDir)). Windows/Linux were not run. The live-network marketplace run was **not** repeated after the DEF fixes (its API budget was spent); the mock e2e covers the same code paths.

## Release-candidate run (SkillDock 0.2.1)
Executed after the rename and release-hardening changes, sequentially: unit 78 passed; mock e2e 45/45; QA 76 passed / 0 failed / 1 not executed; accessibility 0 serious/critical over 37 views; live marketplace 12/12 (real GitHub, temp fixture only); packaged-app smoke passed (including inert test overrides); licenses 96/96 permissive; production audit 0 vulnerabilities. One earlier QA attempt showed 2 failures when the e2e and QA suites were launched **at the same time** (a click landed on the neighbouring sidebar item); both cases passed when QA was re-run alone, so this is recorded as interference between concurrent Electron instances, not a product regression. See docs/RELEASE_READINESS.md for the blocked and unsupported items.

## Design-system pass (2026-11-25)
Executed sequentially against the rebuilt app: `npm test` 79 passed / 4 skipped (live tests opt-in); `tsc` clean; `app.e2e` 45/45; `design.e2e` 13/13 (notification auto-close ×5, theme persistence without flash, tokens/fonts, layouts at 1440/1000/700/640 with no horizontal overflow on 6 pages, drawer nav, keyboard); `a11y.e2e` 0 serious/critical over 37 views (first run found 9 contrast failures; fixed by tuning light status text, a `--danger-text` token and removing opacity from the dialog animation); QA 76 passed / 0 failed / 1 not executed; `npm run package` and `packaged.e2e` OK.
Not done: tray and native context menus; real-service checks that need the user's login or a private-repo credential; official brand assets (logo is a reconstruction); Windows/Linux visual checks.

## Structure, brand-asset and shell pass (2026-11-25)
Repo audit removed unused components and CSS, a stale icon script, a prototype e2e, a stale report and an unused IPC query; renderer reorganised into `app/ features/ shared/ design/`. Executed sequentially after the changes: `tsc --noUnusedLocals` clean; `npm test` 79 passed / 4 skipped; `app.e2e` 45/45; `design.e2e` 16/16 (adds nav groups, sidebar 232–248px/rail 60–64px, tooltips, ⌘B persistence across reload, ⌘, Settings, theme-matched logo with preserved aspect ratio); `a11y.e2e` 0 serious/critical over 37 views; QA 76 passed / 0 failed / 1 not executed; `npm run package` + `packaged.e2e` OK (the packaged test now selects the app window because the splash is also a window).
Not verified: the splash was rendered standalone (screenshot) but never observed on screen during a packaged launch (the main window is ready first on this machine); Windows title-bar overlay and Linux icons were not run (macOS only); no tray exists.

## PATH, My Skills categories and resizable panels (2026-11-25)
Packaged app launched with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` (as from Finder): before the fix the Overview showed Claude Code, Node, npm and uv as not installed; after it `env:detect` reports all six tools connected (Claude Code 2.1.331). New `design.e2e` steps (sidebar and list dividers by drag/keyboard/persistence/reset, My Skills category chips) 18/18 on the final run; `app.e2e` 45/45; `a11y.e2e` 0 serious/critical (the first run caught a missing `aria-valuenow` on the separator and a landmark-less handle; both fixed); QA 76/0/1; unit 79 passed/4 skipped; packaged smoke OK.
Caveat: the notification-timer steps in `design.e2e` failed intermittently on two earlier runs while the machine was busy and passed on every run after; they are timing-based.
