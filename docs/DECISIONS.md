# Decisions
1. **npm workspaces, not pnpm** — pnpm is not installed; avoids an extra prerequisite.
2. **Deferred stack items**: Tailwind, shadcn/ui, Zustand, TanStack Query, RHF, Monaco, SQLite/Drizzle are not installed. Each is added in the phase that needs it (YAGNI); the current UI is plain React + CSS tokens.
3. **Core is Electron-free** so a future CLI and tests reuse it; bundled into main via `externalizeDepsPlugin({exclude:['@skilldock/core']})`.
4. **IPC**: renderer sends ids only; main re-resolves paths. Every channel is zod-validated and sender-checked (`trusted()`).
5. **Discovery follows symlinks** (stat/realpath) because user skills are commonly symlinks.
6. **Detection runs only `<tool> --version`** on a fixed allowlist; no shell, no user-supplied args.
7. **E2E via playwright-core `_electron`** (no browser download).
8. **Textarea instead of Monaco** for editors: avoids worker/CSP complexity; revisit if highlighting is requested.
9. **Marketplace installs track the default branch** while recording the installed commit; explicit SHA refs (user/org) are pinned.
10. **Plugins via the official `claude plugin` CLI**, never by editing plugin state files.
11. **E2E-only overrides (`SKILLDOCK_HOME`, `SKILLDOCK_GH_API`, …) are ignored in packaged builds.**
12. **Generic preload `invoke`** (not a per-channel allow-list): main registers the only channels and validates them; adding a second list would just drift. Revisit if multiple windows/origins are ever added.
13. **Native confirmation lives in main, UI confirms only explain.** Double prompt for process-starting actions is intentional.
14. **Editing never rewrites what it cannot represent** (binary/large files are preserved untouched).
