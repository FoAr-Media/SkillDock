# QA execution evidence
Generated 2026-11-24T22:09:06.718Z by tests/qa/run.mjs. Every row below was executed against the real app; "not-executed" rows were not run and say why.

| ID | Persona | Case | Channel | Result | Actual | Evidence |
|---|---|---|---|---|---|---|
| A-01 | A | First launch: read-only onboarding | ui | **pass** | onboarding shown, no files created | [shot](screenshots/A-01.png) |
| A-02 | A | Discover skills in the marketplace | ui | **pass** | 3 skills listed from mock official source | [shot](screenshots/A-02.png) |
| A-03 | A | Category filter: Video editing | ui | **pass** | 1 tile: video-maker | [shot](screenshots/A-03.png) |
| A-04 | A | Understand the skill before installing | ui | **pass** | overview, docs, security explanation readable | [shot](screenshots/A-04.png) |
| A-05 | A | Install the skill through the reviewed plan | ui | **pass** | files verified on disk; sibling skills untouched | [shot](screenshots/A-05.png) |
| A-06 | A | Learn how to invoke it | ui | **pass** | invocation shown and copied | [shot](screenshots/A-06.png) |
| A-07 | A | Uninstall it again | ui | **pass** | removed; backup listed | [shot](screenshots/A-07.png) |
| A-08 | A | Network drops during download | ui | **pass** | error shown: TypeError: fetch failed | [shot](screenshots/A-08.png) |
| A-09 | A | Marketplace refresh while GitHub is unreachable | ui | **pass** | cached tiles still visible · recovered after network returned | [shot](screenshots/A-09.png) |
| A-runtime | A | no uncaught renderer errors during the journey | ui | **pass** | none |  |
| B-01 | B | Register two projects (explicit, no disk scan) | ui+ipc | **pass** | 2 projects; non-existent and file paths rejected | [shot](screenshots/B-01.png) |
| B-02 | B | Global skill vs project skill install | ui | **pass** | user + project 1 only | [shot](screenshots/B-02.png) |
| B-03 | B | Duplicate resources are not silently overwritten | ui+ipc | **pass** | skill: overwrite gated · MCP rename onto existing name refused · duplicate agent refused | [shot](screenshots/B-03.png) |
| B-04 | B | Add a project MCP server through the wizard | ui | **pass** | written + pending approval | [shot](screenshots/B-04.png) |
| B-05 | B | Update detection and local-modification guard | ui | **pass** | local edit preserved until explicit overwrite | [shot](screenshots/B-05.png) |
| B-06 | B | Preset review with partially missing items | ui | **pass** | errors for missing preset items are shown, not hidden | [shot](screenshots/B-06.png) |
| B-07 | B | Configuration conflicts visible | ui | **pass** | model conflict flagged | [shot](screenshots/B-07.png) |
| B-runtime | B | no uncaught renderer errors during the journey | ui | **pass** | none |  |
| C-01 | C | Mirrored tool-folder copies appear once | ui | **pass** | 1 tile, +3 mirrors | [shot](screenshots/C-01.png) |
| C-02 | C | Dependencies are detected | ui | **pass** | deps detected: requirements.txt | [shot](screenshots/C-02.png) |
| C-03 | C | Root-level / oversized skill is not auto-installable | ui | **pass** | disabled with reason | [shot](screenshots/C-03.png) |
| C-04 | C | Huge repository: index-only, lazy details | ui | **pass** | index-only entry completed lazily | [shot](screenshots/C-04.png) |
| C-05 | C | Install ONE skill from a multi-skill repository | ui | **pass** | only pdf installed | [shot](screenshots/C-05.png) |
| C-06 | C | Create a custom content-production preset and review its plan | ui | **pass** | plan: pdf ok, nope reported as failed | [shot](screenshots/C-06.png) |
| C-07 | C | Duplicate skill names inside one repository | ui | **pass** | 2 same-named entries listed (paths differ) | [shot](screenshots/C-07.png) |
| C-runtime | C | no uncaught renderer errors during the journey | ui | **pass** | none |  |
| D-01 | D | Create a skill from a template and save it | ui | **pass** | saved + listed | [shot](screenshots/D-01.png) |
| D-02 | D | Invalid frontmatter blocks saving | ui | **pass** | save blocked | [shot](screenshots/D-02.png) |
| D-03 | D | Path traversal in a new file name | ui | **pass** | traversal rejected | [shot](screenshots/D-03.png) |
| D-04 | D | Risky script gets flagged by static validation | ui | **pass** | warning shown | [shot](screenshots/D-04.png) |
| D-05 | D | Overwriting an existing skill is explicit | ui | **pass** | overwrite confirmation shown | [shot](screenshots/D-05.png) |
| D-06 | D | Version history: restore an earlier version | ui | **pass** | second version rolled back | [shot](screenshots/D-06.png) |
| D-07 | D | Real Claude execution needs the system dialog | ui+ipc | **pass** | denied → not executed | [shot](screenshots/D-07.png) |
| D-08 | D | Externally broken SKILL.md | ui | **pass** | flagged invalid in the list | [shot](screenshots/D-08.png) |
| D-09 | D | Permission error while saving (read-only skills folder) | ui | **pass** | error: EACCES: permission denied, unlink '/var/folders/0v/yd4lc97j1t57mlgp0shcxccw0000gn/T/skilldock-e2e-nGGuS9/home/ · original content intact | [shot](screenshots/D-09.png) |
| D-10 | D | Export a skill to a chosen folder | - | **not-executed** | NOT EXECUTED: needs the native folder-picker dialog, which Playwright cannot drive; lossless export is unit-tested (exportSkillDir) |  |
| D-runtime | D | no uncaught renderer errors during the journey | ui | **pass** | none |  |
| E-01 | E | Connect a catalog | ui | **pass** | connected Acme v7 | [shot](screenshots/E-01.png) |
| E-02 | E | Checksum mismatch blocks install | ui | **pass** | blocked | [shot](screenshots/E-02.png) |
| E-03 | E | Install a pinned resource | ui | **pass** | installed, current | [shot](screenshots/E-03.png) |
| E-04 | E | Catalog publishes a new pinned version | ui | **pass** | update badge shown | [shot](screenshots/E-04.png) |
| E-05 | E | Invalid catalogs are rejected | ui | **pass** | bad json: SyntaxError: Expected property name or '}' in JSON at position 2 (line · missing fields: organization Invalid input: expected object, received undefined; resou · duplicate ids: Duplicate resource id a | [shot](screenshots/E-05.png) |
| E-06 | E | Managed policy is respected | ui+ipc | **pass** | read-only + lock banner | [shot](screenshots/E-06.png) |
| E-07 | E | Private repository without a token | ui | **pass** | message mentions private repos / token | [shot](screenshots/E-07.png) |
| E-08 | E | Disconnect the catalog | ui | **pass** | catalog gone, pdf kept | [shot](screenshots/E-08.png) |
| E-runtime | E | no uncaught renderer errors during the journey | ui | **pass** | none |  |
| F-01 | F | Suspicious repository needs explicit approval | ui | **pass** | blocked, cancelled cleanly | [shot](screenshots/F-01.png) |
| F-02 | F | Malicious archive paths | ui | **pass** | dot-dot path: rejected · backslash path: rejected · NUL byte path: rejected | [shot](screenshots/F-02.png) |
| F-03 | F | Symlink and submodule entries | ui | **pass** | 2 skipped; ok.md installed | [shot](screenshots/F-03.png) |
| F-04 | F | Oversized file / too many files | ui | **pass** | big file: skills/bigfile/data.bin exceeds 2097152 bytes · 311 files rejected | [shot](screenshots/F-04.png) |
| F-05 | F | Secrets stay masked everywhere | ui+ipc | **pass** | DOM, mcp:list, activity log and export are secret-free | [shot](screenshots/F-05.png) |
| F-06 | F | MCP start needs approval; denial spawns nothing | ui+ipc | **pass** | denied, nothing spawned | [shot](screenshots/F-06.png) |
| F-07 | F | A server that never answers | ui+ipc | **pass** | timed out after 18s, no orphan | [shot](screenshots/F-07.png) |
| F-08 | F | Permission error during install → rollback | ui | **pass** | error: Install failed and was rolled back: EACCES: permission denied, mkdir '/var/folders/0v/yd4lc97j1t57mlgp0shcxccw | [shot](screenshots/F-08.png) |
| F-09 | F | Backup recovery after a mistaken uninstall | ui | **pass** | t4 restored | [shot](screenshots/F-09.png) |
| F-10 | F | Copying a skill never follows symlinks | ui+ipc | **pass** | leak.md (symlink) excluded from the copy plan | [shot](screenshots/F-10.png) |
| F-runtime | F | no uncaught renderer errors during the journey | ui | **pass** | none |  |
| G-01 | G | Existing resources are listed without modification | ui | **pass** | listing is read-only | [shot](screenshots/G-01.png) |
| G-02 | G | Unfamiliar keys survive every UI write | ui | **pass** | unknown keys + dotfile symlink intact | [shot](screenshots/G-02.png) |
| G-03 | G | Precedence view includes the managed layer | ui | **pass** | managed theme wins | [shot](screenshots/G-03.png) |
| G-04 | G | External change while editing | ui | **pass** | settings: conflict detected | [shot](screenshots/G-04.png) |
| G-05 | G | Installing over a foreign skill | ui | **pass** | hand-made skill protected | [shot](screenshots/G-05.png) |
| G-06 | G | Uninstall only the intended resource | ui+ipc | **pass** | only intended resources removed | [shot](screenshots/G-06.png) |
| G-07 | G | TOCTOU: a folder appears between plan and approval | ui | **pass** | refused: Install failed and was rolled back: The target changed after this plan was reviewed (something was c | [shot](screenshots/G-07.png) |
| G-08 | G | Stale installation records after the skill disappears | ui+ipc | **pass** | no stale pdf record | [shot](screenshots/G-08.png) |
| G-09 | G | Skill deleted externally while its page is open | ui | **pass** | no crash after external delete | [shot](screenshots/G-09.png) |
| G-runtime | G | no uncaught renderer errors during the journey | ui | **pass** | none |  |
| G2-01 | G2 | Corrupt settings.json | ui | **pass** | error shown, write refused, original untouched | [shot](screenshots/G2-01.png) |
| G2-02 | G2 | Corrupt ~/.claude.json | ui | **pass** | warning shown | [shot](screenshots/G2-02.png) |
| G2-03 | G2 | Invalid MCP configuration input | ui+ipc | **pass** | 3 invalid inputs rejected | [shot](screenshots/G2-03.png) |
| G2-04 | G2 | Unreadable skill folder | ui+ipc | **pass** | listing ok (6 skills) | [shot](screenshots/G2-04.png) |
| G2-05 | G2 | Read-only settings file | ui+ipc | **pass** | result ok=false: Error invoking remote method 'skills:setEnabled': Error: /private/var/folders/0v/yd4lc97j1 | [shot](screenshots/G2-05.png) |
| G2-runtime | G2 | no uncaught renderer errors during the journey | ui | **pass** | none |  |
| G3-01 | G3 | Claude Code CLI not installed | ui | **pass** | CLI flagged missing with guidance | [shot](screenshots/G3-01.png) |
| G3-02 | G3 | Plugin action without the CLI | ui+ipc | **pass** | Error invoking remote method 'plugins:action': Error: The Claude Code CLI (`claude`) was not found o | [shot](screenshots/G3-02.png) |
| G3-03 | G3 | MCP stdio server whose command is missing | ui+ipc | **pass** | definitely-not-installed-xyz not found on PATH | [shot](screenshots/G3-03.png) |
| G3-runtime | G3 | no uncaught renderer errors during the journey | ui | **pass** | none |  |
