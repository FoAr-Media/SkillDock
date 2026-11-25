# Progress (reflects what is actually implemented and verified)

## Phases
| Phase | Status |
|---|---|
| 0 Research/architecture | Done: docs, compatibility matrix (verified items marked), threat model. |
| 1 Foundation | Done: monorepo, secure Electron, validated IPC, SQLite+migrations, audit log, routing/shell, onboarding, detection. |
| 2 Local resources | Done: discovery, details (11 tabs), config editor, project registration, backup + transaction + crash recovery. |
| 3 Marketplace/install | Done: GitHub provider, official + user sources, plugin manifests, MCP registry, filters/sorting, reviewed install plans, uninstall, updates, pin. |
| 4 MCP | Done: scopes, masked editing, wizard, import/export, gated diagnostics. |
| 5 Dev tools | Done: Studio, templates, agents, commands, hooks, plugins (CLI), presets, inheritance. |
| 6 Organizations | Done: manifests (URL/GitHub/local), pinned versions, checksums, org presets, installed view. |
| 7 Quality/distribution | Done: unit + live + e2e + a11y, macOS DMG/zip, CI + release workflows, docs. |

## Acceptance criteria (spec §24)
| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Detect existing Claude installations | **Passed** | e2e "real system" + packaged smoke: CLI 2.1.331, Desktop, config dir |
| 2 | List existing skills without modification | **Passed** | real `~/.claude` (170 skills incl. symlinks/plugins); settings.json + skills dir byte-identical after run |
| 3 | Discover real public resources | **Passed** | `npm run test:live`: anthropics/skills (18+ skills) + MCP registry |
| 4 | Import a compatible resource from GitHub | **Passed** | live test + e2e (mock) |
| 5 | Individual skill from multi-skill repo | **Passed** | live test installs exactly `frontend-design`; e2e asserts siblings not installed |
| 6 | Select installation scope | **Passed** | e2e user + project scope |
| 7 | Preview changes | **Passed** | plan dialog with per-file add/modify/remove; e2e asserts disk untouched pre-approval |
| 8 | Independently verify installed files | **Passed** | tree-hash verification + discovery check in `applySkillInstall`; tests assert on-disk bytes |
| 9 | Update & uninstall safely | **Passed** | e2e: update with local-modification guard; uninstall with backup, symlink-safe |
| 10 | Unrelated config unchanged | **Passed** | e2e asserts settings.json/.claude.json byte-equal across installs; unknown keys preserved |
| 11 | Roll back failed operations | **Passed** | unit test (failure after copy), journal crash recovery e2e |
| 12 | Create/edit MCP config | **Passed** | e2e wizard add/edit/delete |
| 13 | Test approved MCP connections | **Passed** | real stdio handshake with fixture server; tools never called |
| 14 | Connect private Git repos | **Partial** | token via OS keychain + authenticated contents API implemented and unit-covered with mock auth path; **not verified against a real private repo** (no credential available) |
| 15 | Create/validate custom skills | **Passed** | e2e Studio |
| 16 | Manage project resources | **Passed** | e2e |
| 17 | Credentials not exposed to renderer/logs | **Passed** | e2e asserts secrets absent from DOM and `mcp:list` payload; token never crosses IPC. Token set/clear UI path not exercised in CI (OS keychain prompt) |
| 18 | Offline local management | **Passed** | e2e offline step |
| 19 | Automated tests cover critical operations | **Passed** | 78 unit/boundary + 1 live + 45 mock e2e + 76 QA cases + 12 live-network e2e + packaged smoke |
| 20 | macOS build | **Passed** | `release/*.dmg`, `*.zip` (arm64 + x64); packaged app launched and verified. **Unsigned / not notarized** |

## Review status
Independent review done (docs/IMPLEMENTATION_PLAN.md): all P0/P1 findings fixed with regression tests. F15 (MCP approval/override), F16 (skill name resolution) and F18 (hooks from all sources) fixed against official docs. F19 resolved; F17 partly (skillOverrides documented). Open: unconfirmed `installed_plugins.json`/managed paths, plus P3 items.

## Known limitations (honest list)
- **No code signing/notarization**; Windows/Linux packaging is configured (CI) but was not built or run here.
- Raw JSON/Markdown editing uses `<textarea>` (no Monaco / syntax highlighting); Markdown preview is a small safe renderer. Tailwind/shadcn/Zustand/TanStack/RHF not used (see DECISIONS).
- Plugin install/enable/disable go through the `claude plugin` CLI; **not exercised end-to-end** (would modify the real Claude install).
- "Run with Claude" in Studio (`claude -p`) is implemented and approval-gated but **not executed in CI** (consumes usage).
- Org catalog `signature` is shown, not cryptographically verified. Archive (zip) import not implemented (folders and GitHub only).
- Skill disable relies on the `skillOverrides` key observed in settings.json (not confirmed in public docs).
- Built-in command list is a curated subset. Claude Desktop Chat/Cowork/cloud skills are not managed (separate config; not researched).
- Presets: only built-ins verified to exist in anthropics/skills; video/DevOps presets must be user-created.
- Category/OS/complexity in the marketplace are heuristics, labelled "inferred".
- Skill ids use the directory name; installing the same name twice in one scope is a conflict by design.
- a11y: no critical axe violations; see `docs/a11y-report.json` for remaining non-critical items.
