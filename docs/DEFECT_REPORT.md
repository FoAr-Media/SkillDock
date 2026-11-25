# Defect report: dedicated QA pass

Source of every entry: `tests/qa/run.mjs` (real Electron app, isolated fixtures, mock network with failure modes). Per-case evidence (expected vs actual, screenshot, channel): `docs/qa/EXECUTION_EVIDENCE.md` and `docs/qa/execution-evidence.json`. Each defect below has a unit regression test in `packages/core/test/defects.test.ts` unless noted. First QA run: 59 passed / 17 failed / 1 not executed. Triage of those 17 found **11 product defects** and the rest were defects in the QA suite itself (races on stale DOM, selectors, a test that could not block a write); those are listed at the end, not counted as product bugs.

Severity scale: **Critical** data loss/security breach without user action · **High** a primary action broken, or user data changed without consent · **Medium** wrong/misleading behaviour with a workaround, or a safety rule violated · **Low** poor message / minor robustness.

| ID | Sev | Title | Found by | Status |
|---|---|---|---|---|
| DEF-01 | **High** | Copy-to-clipboard never works | A-06 | Fixed |
| DEF-02 | **High** | Approving a plan overwrites a folder created after the plan was shown | G-07 | Fixed |
| DEF-03 | Medium | Records of vanished skills report phantom updates | G-08 | Fixed |
| DEF-04 | Medium | Backslash path segments accepted from remote repositories | F-02 | Fixed |
| DEF-05 | Medium | A corrupt `~/.claude.json` looks like "no MCP servers" | G2-02 | Fixed |
| DEF-06 | Medium | A file the user made read-only is silently replaced | G2-05 | Fixed |
| DEF-10 | Medium | Rollback/restore silently changes file permissions | found while fixing DEF-06 | Fixed |
| DEF-11 | Medium | Failed downloads leave staging residue (workers keep writing after the error) | F-02 / F-08 | Fixed |
| DEF-07 | Low | Raw `spawn claude ENOENT` when the CLI is missing | G3-02 | Fixed |
| DEF-08 | Low | Unhandled promise rejection ("Unknown skill") when a skill vanishes | G-runtime | Fixed |
| DEF-09 | Low | Staging cleanup after a failed install is fire-and-forget | F-08 | Fixed |

## DEF-01 (High): Copy-to-clipboard never works
- **Reproduce:** open any skill → Commands tab → click **Copy**.
- **Expected:** `/video-maker` is copied and a "Copied" toast appears (the product requires copy-to-clipboard on commands, config and MCP export).
- **Actual:** nothing happens. In the renderer `navigator.clipboard.writeText()` rejects with `NotAllowedError: Write permission denied`.
- **Cause:** the security hardening denied *every* permission request, including `clipboard-sanitized-write`.
- **Fix:** main allows only `clipboard-sanitized-write` (request and check handlers); clipboard *read* and all other permissions stay denied.
- **Why earlier testing missed it:** no earlier test pressed a Copy button; the packaged smoke test only read data.
- **Verified by:** A-06 (UI: toast + clipboard).

## DEF-02 (High): approval overwrites a folder created after the plan
- **Reproduce:** import a skill → leave the plan dialog open → create `~/.claude/skills/<same name>/SKILL.md` outside the app → click *Approve & install*.
- **Expected:** refuse; the plan no longer matches reality.
- **Actual:** the plan said "no conflict", approval ran `rm -rf` on the new folder and installed over it. A backup existed, but the user never consented to replacing it.
- **Fix:** the plan records a hash of the target (or absence) when created; approval re-checks it and refuses with "The target changed after this plan was reviewed… Nothing was changed".
- **Verified by:** G-07 (UI), `DEF-02` unit test (absent→appeared, foreign→edited, unchanged still installs).

## DEF-03 (Medium): phantom updates for skills that no longer exist
- **Reproduce:** install a skill → restore its install-time backup (which removes it) → *Check updates*.
- **Expected:** nothing about that skill; the filesystem is authoritative.
- **Actual:** `available: true, localModified: true` for the missing skill and the dashboard "updates" count included it.
- **Fix:** `reconcileInstallations` drops records whose target is gone; called before update checks, skill listing and the dashboard.
- **Verified by:** G-08, `DEF-03` unit test.

## DEF-04 (Medium): backslash path segments accepted
- **Reproduce:** a repository whose skill contains a file named `..\..\win-esc.txt`; import the skill.
- **Expected:** rejected as an unsafe path.
- **Actual:** accepted and shown in the plan as a file to install (a harmless odd name on macOS, a traversal on Windows).
- **Fix:** `safeJoin` rejects any path containing a backslash.
- **Verified by:** F-02 (three hostile variants: `..` segments, backslashes, NUL byte), `DEF-04` unit test.

## DEF-05 (Medium): corrupt `~/.claude.json` looks like "no servers"
- **Reproduce:** make `~/.claude.json` invalid JSON → open MCP Servers.
- **Expected:** the user is told the file is unreadable (otherwise they may re-add servers or assume none exist).
- **Actual:** an empty list with no explanation.
- **Fix:** `configHealth` reports unparseable config files (user, settings, managed, per-project); an alert banner shows on Overview and MCP Servers.
- **Verified by:** G2-02 (UI), `DEF-05` unit test.

## DEF-06 (Medium): read-only files are replaced
- **Reproduce:** `chmod 444 ~/.claude/settings.json` → change any setting in the app.
- **Expected:** refuse; the user marked the file read-only.
- **Actual:** replaced. Writes use temp-file + `rename()`, which ignores the read-only bit.
- **Fix:** writability is checked before a transaction starts (no backup/rollback churn) and again in `atomicWrite`.
- **Verified by:** G2-05, `DEF-06` unit test.

## DEF-10 (Medium): rollback changes file permissions
- **Found:** while writing the DEF-06 test: after a refused write the file was no longer read-only.
- **Cause:** backups were stored with mode `0600` and restored with that mode, so any rollback or *Restore backup* changed the original file's permissions.
- **Fix:** the manifest records each file's permission bits and restore re-applies them.
- **Verified by:** `DEF-10` unit test (0755 script survives backup→modify→restore).

## DEF-11 (Medium): failed downloads leave staging residue
- **Reproduce:** import a skill from a repository with several files and one hostile path; list `<appdata>/staging`.
- **Expected:** empty after the error.
- **Actual:** one orphan directory per failed attempt. `Promise.all` rejected on the first bad path while up to five other workers kept downloading and re-created the directory *after* the cleanup, i.e. the app wrote files after reporting failure.
- **Fix:** workers stop at the first failure, all workers are awaited, then the directory is removed and the error thrown.
- **Verified by:** F-02/F-04/F-08 (staging empty after each failure), `DEF-11` unit test with slow parallel responses.

## DEF-07, DEF-08, DEF-09 (Low)
- **DEF-07:** with no `claude` on PATH, plugin actions showed `spawn claude ENOENT`. Now: "The Claude Code CLI (`claude`) was not found on PATH. Install it from https://code.claude.com/docs/…" (also for marketplace add and Studio runs). Verified by G3-02 and a unit test.
- **DEF-08:** opening a skill's folder after it was deleted threw an unhandled rejection. The call now reports the error, and a global handler turns any missed rejection into an error toast instead of a silent failure. Verified by the `*-runtime` "no uncaught renderer errors" cases.
- **DEF-09:** `cancelPlan` removed staging without awaiting it, so staging could briefly remain after a failed install returned. It is awaited now. Verified by `DEF-09` unit test and F-08.

## QA-suite defects (not product bugs)
C-01 / C-04 asserted on a stale grid before the filter applied (race); E-05 matched both "Connect" and "Disconnect"; F-03 used a regex that matched the word "symlink" in a heading; F-10 never registered the project it copied into; D-09 used a read-only *folder*, which does not prevent rewriting an existing file (rewritten with a read-only file + folder); F-04 / F-09 failed only as a cascade of F-02/F-03.

## Not executed (stated, not counted as passed)
- **D-10 export to a chosen folder:** needs the native folder picker, which Playwright cannot drive. Lossless export is covered by a unit test only.
- Real-network cases are in the separate live run (`tests/e2e/marketplace-live.e2e.mjs`, 12/12 on 2026-11-24); the QA suite itself runs on a local mock so it can inject failures.
- Windows and Linux were not run.
