# Test plan
- **Unit/integration (vitest)** `packages/core/test`: parsing, discovery, backups/transactions/rollback, conflict detection, install lifecycle against a local mock GitHub server, scanner, MCP (real stdio handshake with a fixture server), workspace/inheritance, marketplace/catalog/presets/studio.
- **Live (opt-in)** `npm run test:live`: real GitHub + MCP registry, installs one skill into a temp HOME.
- **Electron e2e** `tests/e2e/app.e2e.mjs`: launches the built app (Playwright `_electron`) with an isolated fixture HOME and mock servers; covers every route, personas A–G, security assertions, keyboard, viewport sizes, axe, offline, and a read-only run against the real `~/.claude`. Screenshots in `docs/screenshots`.
- Browser screenshots are never used as proof of filesystem behaviour: every flow asserts files on disk.
