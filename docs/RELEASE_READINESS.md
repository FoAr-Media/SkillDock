# Release readiness report: SkillDock 0.2.1

**Verdict:** the software is functionally complete and verified for a **macOS developer-preview release**. It is **not ready to be announced as a general release** until the blocked items below are resolved by a maintainer. **Nothing has been published or pushed**; there is no git remote, no tag and no GitHub Release. Publishing needs your explicit authorization.

Everything marked *completed* was executed in this repository; nothing is claimed from intent. Evidence: `docs/TEST_REPORT.md`, `docs/qa/EXECUTION_EVIDENCE.md`, `docs/DEFECT_REPORT.md`, `docs/a11y-report.json`, `docs/live-*.json`.

## 1. Completed (executed and verified)
| Area | Result | Evidence |
|---|---|---|
| Type safety | strict TypeScript, both packages clean | `npm run typecheck` |
| Unit / integration / architecture / security-boundary tests | **78 passed** (2 network tests skipped by default; 13 POSIX-only tests skip on Windows) | `npm test` |
| Electron end-to-end (mock network, isolated fixtures) | **45/45** | `tests/e2e/app.e2e.mjs` |
| Dedicated QA: 7 personas + negative cases (network failure, hostile paths, permission errors, corrupt/invalid config, missing CLI, duplicates, external changes) | **76 passed, 0 failed, 1 not executed** (D-10: native folder picker). 11 product defects found earlier, all fixed with regression tests | `tests/qa/run.mjs`, `docs/DEFECT_REPORT.md` |
| Live marketplace against real GitHub / MCP Registry (video, development, productivity, design) | **12/12**; installs only into a temp fixture; real `~/.claude` checksummed before/after | `tests/e2e/marketplace-live.e2e.mjs`, `docs/live-e2e-results.json` |
| Accessibility (axe-core): 17 routes × dark/light + resource page + install dialog | **0 serious/critical** across 37 views; 2 moderate heading-order notes remain | `tests/e2e/a11y.e2e.mjs` |
| Packaged app smoke | launches, reads real data read-only, clipboard write allowed/read denied, devtools off, **test overrides inert in a release build** | `tests/e2e/packaged.e2e.mjs` |
| Dependency licenses | all **96 bundled packages permissive** (84 MIT, 8 ISC, 3 BSD-3, 1 BSD-2); CI check + generated `THIRD_PARTY_NOTICES.md`, shipped inside the app | `npm run licenses:check` |
| Vulnerabilities | **0 in production dependencies**. 6 moderate advisories in the `electron-builder` packaging toolchain (a `minimatch` DoS in build-time tooling; not shipped) | `npm audit` |
| Reproducible build | JS output hash identical across rebuild and a clean-room `npm ci` (`027c8c867162a382`); packaged **app contents** identical to a clean-room build (`727c162a7ea31639`). DMG/zip containers embed timestamps and are not byte-identical | scripts in this report's method |
| Packaging | macOS DMG + zip, arm64 and x64; bundle id `dev.skilldock.app`; LICENSE and notices shipped; `app.asar` has no `node_modules` | `release/` |
| Security review | renderer sandbox, validated IPC, native approval for process starts, symlink/path hardening, strict CSP, secret masking. Review fixed 13 findings; QA fixed 11 more | `docs/IMPLEMENTATION_PLAN.md`, `docs/SECURITY_MODEL.md` |
| Performance | real 170-skill/7-plugin setup: skill scan 25–54 ms, hooks 38 ms, commands 22 ms; renderer bundle 776 kB (React 19) | measured |
| Repository hygiene | no secrets, tokens, personal paths or personal data in text files or screenshots (screenshots regenerated with neutral fixture paths; real-machine screenshots removed); no TODO/mock data/console output in production sources; stale failure screenshots, a dead IPC channel and a stray cache dir removed | audit |
| Documentation | README (screenshots, install, build), CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG, architecture, security/threat model, compatibility matrix (cited to official docs), marketplace, user guide, test/defect reports, issue/PR templates, Dependabot | repo root + `docs/` |
| CI configuration | verify (macOS/Windows/Linux), audit + notices freshness, macOS e2e/QA/a11y, experimental Linux e2e, **draft-only** release workflow with checksums. All YAML parses and is structurally valid | `.github/` |

Local build artifacts (checksums of what was built here, for reference):

| File | SHA-256 |
|---|---|
| `SkillDock-0.2.1-arm64.dmg` | `26363a0df42b0c5a28b2100bf8295e4e80624f03511c646cd6c48a0badb531c2` |
| `SkillDock-0.2.1.dmg` | `4cab4c6be10936f4b47b5ab0a023b7b4cb114bc44ba11b946d0e47cf0f84c2df` |
| `SkillDock-0.2.1-arm64-mac.zip` | `4e6a619d46236a99994d095a72219719625ab6f5e8fa73415d37701c93db6ab1` |
| `SkillDock-0.2.1-mac.zip` | `a9a0d89df2dc2c397d02fa4815baaf1b539c293cd189897b522ed06974c4e313` |

## 2. Blocked (needs a maintainer or an external resource)
| Item | Why blocked | What is needed |
|---|---|---|
| **Publishing** | You did not authorize it; no remote exists | Your explicit go-ahead, a GitHub repository, and a decision on the `v0.2.1` tag |
| **Code signing + notarization** | Needs an Apple Developer ID and notarization credentials | Add signing identity/secrets to CI; until then users must bypass Gatekeeper (documented in the README) |
| **Application icon and brand assets** | Supplied dark-tile icon art is integrated (icns/ico/png set, packaged icns verified identical). The supplied masters are opaque rasters, so derived transparency is approximate; no vector masters exist | Supply transparent/vector masters; verify `.ico`/Linux icons on those platforms |
| **CI has never executed** | No repository to run it on; workflows were validated for syntax/structure only | First push will show real results; expect to iterate (especially Windows/Linux) |
| **Name clearance for "SkillDock"** | Not checked: trademark/domain/package-name availability is a legal/business decision | Search before public launch |
| **Repository metadata** | `repository`/`bugs`/`homepage` fields and the private-vulnerability-reporting setting can only be set once the repo exists | Fill after creating the repo; enable *Private vulnerability reporting* (SECURITY.md depends on it) |
| **Windows and Linux runs** | Not executed anywhere; installers are built by CI only | Run on real machines; remove the "experimental" labels afterwards |
| **Private GitHub repository flow** | No credential was available; the token path (OS keychain + authenticated API) is implemented but unproven against a real private repo | Test once with a read-only fine-grained token |
| **`claude plugin` execution and Studio "Run with Claude"** | Would modify the real Claude install / spend quota; implemented and approval-gated but never executed | Run once deliberately on a throwaway Claude profile |
| **Live-network re-run in CI** | Unauthenticated GitHub allows 60 API calls/hour | Add a token secret if live tests should run in CI |

## 3. Unsupported / not implemented (stated plainly in the product)
- **Managing** Claude Desktop Chat, Cowork or cloud-session skills (separate configuration; not researched or supported).
- Payments, accounts, a hosted backend, telemetry, remote/fleet administration of Claude accounts (non-goals).
- Archive (zip) import; only folders and GitHub sources.
- Verifying organization-catalog signatures (shown, not verified); an auto-updater; Monaco-style code editor (plain text areas).
- Hooks: no runtime state, no per-source hook limit modelling, no SDK in-process hooks or plugin "mods".
- Categories, OS and complexity in the marketplace are keyword heuristics, always labelled "inferred".
- The static security scan is advisory pattern matching, never a safety guarantee.
- `installed_plugins.json` layout and managed-settings paths are observed/derived, not confirmed against a managed machine.

## 4. Known issues carried into the release
- Two moderate axe heading-order notes (decorative h4 levels).
- DMG/zip files are not byte-reproducible (embedded timestamps).
- Running two Electron test suites at once on one machine causes interference (observed once; both passed when run alone). CI runs them sequentially.
- Local data from earlier development builds lives under the previous app-data folder and is not migrated (the product was renamed before first release). Safe to delete.

## 5. Recommended path to a public release
1. Supply the official logo/icon; set up signing/notarization. 2. Create the repo, enable private vulnerability reporting, push, and let CI run; fix what Windows/Linux reveal. 3. Decide the name clearance. 4. Tag `v0.2.1` to produce a **draft** release, review the artifacts and checksums, and only then publish.
