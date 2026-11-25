# Marketplace

A free discovery catalog. Everything listed is read live from public sources and cached locally; nothing is invented (no star counts, reviews, downloads or "verified" badges beyond what a source returns).

## Providers (adapters)
| Provider | Kind | What it does | Code |
|---|---|---|---|
| GitHub repository | `github` | Reads the repo tree at one commit; lists every `SKILL.md` and the `.claude-plugin/marketplace.json` plugin entries | `discoverRepo` |
| MCP Registry | query-time | Searches `registry.modelcontextprotocol.io`; builds an install config only for Streamable-HTTP remotes and npm/pypi stdio packages | `searchRegistry` |
| Local directory | `local` | Walks a folder you choose for `SKILL.md` (no symlinks) | `discoverLocalDir` |
| GitHub search | query-time | Topic/keyword repository search → **unverified candidates** you can add as sources | `searchGithubRepos` |

Built-in: `anthropics/skills`, `anthropics/claude-plugins-official`. Everything else is opt-in. **Featured sources** (`FEATURED_SOURCES`) are community repos that were inspected on a stated date and found to contain `SKILL.md` files; they carry no star counts.

## What discovery does with real-world repositories
Found while researching real repos (2026-11-24):
- **Mirrors.** Many repos copy the same skill into `.claude/skills`, `.agents/skills`, `.codex/skills`… (e.g. `pbakaus/impeccable` has 26 `SKILL.md` files). Files with the same directory name and an identical blob SHA collapse into one canonical entry (priority `skills/` › `.claude/skills` › `plugins/*/skills` › other) listing the other paths as `mirrors`. A *different* copy stays a separate entry.
- **Huge repos.** `sickn33/agentic-awesome-skills` has ~10,000 `SKILL.md`. Above 400 skills a repo is **index-only**: every skill is listed from the tree (name from the folder), none are fetched eagerly, entries are flagged `partial`, and the real description/category load when you open the entry (then cached). Nothing is silently truncated.
- **Root skills.** When the repository root *is* the skill (e.g. `video-shotcraft`, 1,499 files) the folder exceeds the install limit (300 files / 25 MB / 2 MB per file). The entry is marked not auto-installable with the reason, and the install button is disabled, instead of failing late.
- **Plugin containers.** `plugins/<name>/skills/<skill>` records its plugin; the skill still installs on its own.
- **List-only repos** (e.g. awesome lists with no `SKILL.md`) are reported as having no installable resources.

## Classification (heuristic, always labelled "inferred")
`classify()` scores 28 categories from name ×3, path ×2, repo topics ×2, description ×1 per distinct term; a category needs score ≥ 2 (one stray mention is not enough). `metadata.category` in SKILL.md frontmatter, when it names a known category, wins. The matched terms are kept as **evidence** and shown on the resource page.

## Caching and source verification
- Entries live in SQLite (`marketplace_entries`), sources in `marketplace_sources` with `status`, `commit_sha`, `stars`, `archived`, `entry_count`, `mode`, `verified_at`, `last_attempt`, `error`.
- A refresh costs ≈3 API calls per repo (info, commit, tree). If the **commit is unchanged**, only live stats are refreshed (no tree or `SKILL.md` refetch). "Re-verify" forces a full refetch.
- Statuses: `verified`, `partial` (e.g. GitHub truncated the tree), `error` (stale entries are kept and shown), `rate-limited` (the rest of the batch is skipped, not hammered), `never`; plus `stale` after 24 h and `archived`.
- The UI shows the remaining GitHub API budget (`/rate_limit` is free). Unauthenticated limit is 60/h; a token (Settings) raises it.
- Offline: cached entries remain browsable; refresh fails gracefully.

## Search and filters
Multi-term AND search over name, description, path, categories, tags, container and source (name hits weigh most). Filters: type, category, license, OS, complexity, official/community, installed, min stars, source, hide archived, installable only. Sorts: stars (repo-level), updated, relevance, added, activity, compatibility. Facet counts and pagination ("Load more") are supported for large catalogs.

## Install workflow (unchanged guarantees)
Select → resolve pinned commit → stage only that folder (limits, path validation, no symlinks) → inspect (advisory scan, name-conflict analysis, existing-file conflicts) → show exact file changes → explicit approval (extra approval for high-risk, overwrite) → backup → install → verify against the plan → record → rollback on any failure. Real Claude configuration is never touched by tests; see TEST_REPORT.md.
