# Threat model (initial; will grow with each phase)
| Asset | Threat | Mitigation now | Still to do |
|---|---|---|---|
| Local filesystem | Compromised renderer reads/writes files | sandbox, contextIsolation, no Node; id-only IPC; zod; sender check | path validation helpers when writes land |
| Skill content shown in UI | Markdown/HTML injection | Rendered as plain text in `<pre>` (React-escaped) | safe Markdown renderer later |
| Navigation | Renderer navigates to remote origin | `will-navigate` blocked, `window.open` denied, CSP | permission request handler |
| Third-party skills | Malicious scripts | Never executed; read-only listing | static scanner, install plan (Phase 3) |
| Large/hostile files | DoS | SKILL.md ≤1 MiB parsed; ≤500 files, depth ≤6 listed | download limits (Phase 3) |

## Added in review (v0.1.1)
| Threat | Mitigation | Test |
|---|---|---|
| Compromised renderer starts processes / spends usage | native confirm in main + literal approval + id-only IPC | e2e "process-starting actions need the system dialog" |
| Option injection into `claude` CLI | leading-alphanumeric ids, prompts not starting `-` | review.test.ts |
| Skill-dir symlink leaks files into preview | `readSkillFile` lstat+realpath | review.test.ts, e2e |
| Editing destroys binary assets | no directory wipe, text-only editing, explicit deletes | review.test.ts, e2e |
| Hostile response bodies / huge trees | streamed size cap, scanner caps | github/security code paths |
| Inline-style/script injection | strict CSP | e2e + boundary test |

## Hooks (F18)
| Threat | Mitigation |
|---|---|
| A cloned repository ships `.claude/settings.json` hooks that `claude -p` runs without a trust prompt | Listed as `trust-gated` with an explicit warning; script behind `${CLAUDE_PROJECT_DIR}` is scanned |
| A plugin hook sends tool inputs to a remote URL | `http` handlers show the destination host, plain-HTTP and env vars passed into headers |
| A hook script hides behavior behind a path variable | `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PROJECT_DIR}` scripts are read (contained, no symlinks, size-capped) and scanned |
| App misreports hooks as running | Status is configuration-level only; policy locks and disable flags are applied per the docs |
