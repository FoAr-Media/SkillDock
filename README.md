# SkillDock

![SkillDock: the open-source desktop control center for AI skills, MCP servers, plugins and agent workflows](docs/assets/github-banner.png)

A local-first desktop app for managing the Claude ecosystem on your machine: **skills, MCP servers, plugins, commands, agents, hooks, project instructions and configuration**, with a marketplace for discovering public skills, plugins and MCP servers.

> Independent, community-driven open-source project. **Not an official Anthropic application.** No account, no backend, no telemetry. Your configuration never leaves your device unless you explicitly fetch from GitHub or start an MCP server.

## Screenshots
Marketplace screens use **live data read from GitHub on 2026-11-24**; the others use an isolated test fixture, not a real machine.

| | |
|---|---|
| ![Marketplace: real video production skills](docs/screenshots/live/32-video-production.png) | ![Resource page for a real skill](docs/screenshots/live/36-resource-page.png) |
| Discover real skills by category; stars are repository-level | Resource page: docs, files, versions, security explanation |
| ![Install plan with security inspection](docs/screenshots/live/38-install-plan-security-preview.png) | ![Source verification](docs/screenshots/live/31-sources-verification.png) |
| Reviewed, backed-up, verified, rollback-able install | Every source shows when/what it was verified against |
| ![MCP approval states](docs/screenshots/21-mcp-approval-states.png) | ![Hooks from every documented source](docs/screenshots/23-hooks-sources.png) |
| `.mcp.json` approval and scope-override state, as Claude sees it | Hooks from settings, plugins, managed policy and frontmatter |

## What it does
- **Marketplace:** live discovery from public GitHub repositories, plugin marketplaces and the MCP Registry; mirrored per-agent copies are folded into one listing; huge repositories are indexed lazily; categories are inferred and show their evidence. [Details](docs/MARKETPLACE.md)
- **Transactional installs:** one skill at a time, pinned to a commit → staged outside your Claude folders → security-inspected → exact file changes shown → you approve → backup → install → verified against the plan → rolled back on any failure. Nothing from a resource is ever executed by installing or browsing.
- **Manage what Claude actually reads:** user, project, local, managed and plugin scopes, with precedence, MCP approval state, skill name conflicts and hook policy (`allowManagedHooksOnly`, `disableAllHooks`, workspace trust).
- **Skill Studio, presets, organization catalogs, backups with crash recovery, a configuration editor** that preserves unknown keys and refuses to overwrite concurrent edits.

## Install
**Requirements:** macOS 12+ (Apple silicon or Intel). Claude Code is optional but recommended (some actions call the `claude` CLI).

1. Download the `.dmg` (arm64 or x64) from the Releases page and drag the app to Applications.
2. **The build is unsigned and not notarized**, so macOS Gatekeeper will block the first launch. Either right-click the app → **Open** → **Open**, or run:
   ```
   xattr -dr com.apple.quarantine "/Applications/SkillDock.app"
   ```
   Verify the download against the `SHA256SUMS-*.txt` published with the release.
3. On first launch the app runs a **read-only** scan and changes nothing until you approve an operation.

Windows and Linux packages are produced by CI but **have not been run by the maintainers**; treat them as unsupported for now.

## Build from source
Node.js ≥ 22.13 (the app uses the built-in `node:sqlite`).
```
npm ci
npm run dev            # development
npm run verify         # typecheck + tests + license check
npm run package        # installers in release/
```
Builds are reproducible at the JavaScript level (identical output hash from a clean `npm ci`); installer bytes (DMG/zip) embed timestamps and are not byte-identical.

## Privacy and safety in one paragraph
The renderer is sandboxed and has no Node access; all privileged work happens in the main process behind schema-validated IPC. Anything that starts a process or uses your Claude quota asks through a native system dialog. Writes are atomic, backed up, conflict-checked and symlink-aware. Secrets are masked in the UI and kept out of logs; an optional GitHub token (for private repositories and a higher API limit) is stored in the OS keychain. See [SECURITY.md](SECURITY.md), [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Known limitations
Unsigned builds; Windows/Linux not run; categories are keyword heuristics; the security scan is advisory pattern matching, not a guarantee; plugin installs go through the `claude plugin` CLI; no payments, accounts or remote administration exist or are planned for this version. Full list: [docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md).

## Documentation
[Architecture](docs/ARCHITECTURE.md) · [User guide](docs/USER_GUIDE.md) · [Marketplace](docs/MARKETPLACE.md) · [Compatibility with Claude](docs/COMPATIBILITY_MATRIX.md) · [Test report](docs/TEST_REPORT.md) · [Defect report](docs/DEFECT_REPORT.md) · [Changelog](CHANGELOG.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License
[MIT](LICENSE). Bundled third-party packages are all permissively licensed; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
