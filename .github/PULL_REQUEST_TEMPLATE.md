## What and why

## Checklist
- [ ] `npm run verify` passes (typecheck, unit/architecture tests, license check)
- [ ] New behaviour has a test; UI changes were checked with `node tests/e2e/app.e2e.mjs`
- [ ] Any new IPC channel validates input with zod and passes ids, not paths (see CONTRIBUTING.md)
- [ ] Anything that starts a process or spends the user's Claude usage calls `nativeConfirm`
- [ ] Docs describe what is implemented (README / docs/ / CHANGELOG.md updated)
- [ ] No secrets, personal paths, telemetry, or execution of third-party content added
