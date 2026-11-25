# Changelog
## 0.2.1
The product was renamed **SkillDock** before its first public release (previously a working title). Renamed: application and bundle name, app id (`dev.skilldock.app`), package scope (`@skilldock/*`), test-override environment variables (`SKILLDOCK_*`), preload bridge (`window.skilldock`) and database file (`skilldock.db`). Local data written by earlier development builds lived under the old app-data folder and is not migrated.

### QA-driven fixes in 0.2.1
Fixed 11 defects found by the dedicated QA pass: clipboard permission (Copy buttons), plan/approval race overwriting a late-created skill, phantom updates for deleted skills, backslash paths, silent corrupt `~/.claude.json`, read-only files replaced, backup/restore changing file modes, staging residue after failed downloads, raw CLI-missing errors, unhandled renderer rejections, un-awaited cleanup. See docs/DEFECT_REPORT.md.

### Marketplace (0.2.0 work, same first release)
Provider adapters, mirror/index-only discovery, commit-based cache reuse, source verification, classification with evidence, resource pages, featured sources, GitHub repository search, local-folder sources. See docs/MARKETPLACE.md.

## 0.1.3
Hooks (F18): all documented sources (settings, managed + drop-ins, plugin hooks.json + manifest, skill/command/agent frontmatter), five handler types, policy/trust/disable status, type-aware warnings, script inspection. `managed-settings.d/` honoured everywhere.

## 0.1.2
Added: `.mcp.json` approval/override state per documented rules (F15); skill name-resolution analysis incl. install-time warnings (F16); `~/.claude.json` project keys matched by realpath. Docs: compatibility matrix now cites official pages.

## 0.1.1 (review)
Fixed: Studio data loss with binary/large files; symlinked config files; CLI option injection; renderer-supplied approval (now native dialog in main); symlink-following previews; agent frontmatter injection; `..` repo names; lost concurrent writes; unbounded downloads; CSP `unsafe-inline`; scanner caps; https-only catalog redirects; staging leaks; 3,458 unneeded packaged files. See docs/IMPLEMENTATION_PLAN.md.

## 0.1.0
First functional release: detection, skill discovery/management, marketplace (GitHub, plugin manifests, MCP registry), transactional install/update/uninstall, MCP manager with gated diagnostics, projects & inheritance, agents/hooks/commands/plugins, Skill Studio, org catalogs, presets, security scan, configuration editor, backups & crash recovery.
