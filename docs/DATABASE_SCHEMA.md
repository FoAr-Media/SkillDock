# Database schema (SQLite via `node:sqlite`, `user_version` migrations in `packages/core/src/store.ts`)
projects · installations(id,kind,name,scope,project,target,source JSON,version,tree_hash,installed_at,pinned,org) · audit_events · marketplace_sources · marketplace_entries(cache, JSON) · organizations(catalog JSON) · presets · preferences · update_checks · skill_tests.
Not implemented as separate tables (kept inside JSON or derived from disk): environments, resource_versions, installation_targets, dependencies, security_findings, configuration_snapshots (backups live on disk under `backups/`).
No tokens or secrets are stored here.
