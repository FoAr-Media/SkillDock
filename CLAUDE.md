# SkillDock
- npm workspaces: `packages/core` (Electron-free Node logic, all unit-tested), `apps/desktop` (electron-vite + React).
- Boundary (enforced by `tests/unit/boundary.test.ts`): renderer imports only React/relative/CSS; preload exposes only `invoke`; ALL privileged work is in `apps/desktop/src/main/handlers.ts` behind zod schemas. The renderer passes ids, never paths. Anything that starts a process or spends Claude usage must call `nativeConfirm` in main.
- Claude's files are authoritative. Every write goes through `runTransaction` (backup → atomic write → verify → rollback), resolves symlinks first, and is conflict-checked. Never `rm` a directory you didn't create; never rewrite files the editor can't represent.
- Never pass user/remote-controlled strings to a CLI without a leading-alphanumeric check (option injection).
- Docs describe what is implemented. Update `docs/PROGRESS.md`; findings and priorities live in `docs/IMPLEMENTATION_PLAN.md`.
- Commands: `npm test`, `npm run typecheck`, `npm run test:e2e`, `npm run test:live` (network), `npm run package`.

## Design system (permanent)
- Tokens live in `apps/desktop/src/renderer/design/tokens.css`; use semantic tokens only, never hex values, in components. Docs: `docs/design/`.
- Inter Variable for UI, JetBrains Mono for code/paths/ids. Lucide icons only (no emoji/glyph icons). Gradients/glow only for brand moments (logo, welcome).
- Production CSP forbids inline scripts and `style` attributes. Popovers must auto-dismiss (`useAutoDismiss`). Respect `prefers-reduced-motion`.
- Layout tiers: full ≥1100px, rail 760–1099px, drawer <760px; min window 640×520. Run `node tests/e2e/design.e2e.mjs` and `tests/e2e/a11y.e2e.mjs` after UI changes.
- Brand imagery comes only from `renderer/shared/brand` (see `docs/design/ASSET_REGISTRY.md`); regenerate derivatives with `python3 scripts/build-brand-assets.py`. Code layout: `docs/design/CODE_MAP.md`.
