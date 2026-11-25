# Compatibility matrix
Legend: **V** verified on this machine (Claude Code 2.1.331, macOS arm64) · **D** from official docs, not yet verified locally · **?** not yet researched.

| Resource | User scope | Project scope | Plugin | Managed | Notes |
|---|---|---|---|---|---|
| Skills (`<name>/SKILL.md`) | V `~/.claude/skills` (entries may be symlinks, V) | D `.claude/skills` | V via `~/.claude/plugins/installed_plugins.json` → `installPath/skills` (observed format, not a documented API) | ? | Docs: precedence enterprise > personal > project; plugin skills namespaced. Same symlink target loads once. |
| Legacy commands (`commands/*.md`) | V path scanned | D | ? | ? | A skill beats a same-named command. |
| MCP servers | V `~/.claude.json` → `mcpServers` | V `.mcp.json`; V local = `~/.claude.json` → `projects[path].mcpServers` | ? | V read from `<managed dir>/managed-mcp.json` (read-only; path per OS, not verified on a managed machine) | stdio + Streamable HTTP supported |
| Agents | V `~/.claude/agents/*.md` | D `.claude/agents` | V `<plugin>/agents` | ? | |
| Hooks / settings | V `settings.json` (`hooks`, `enabledPlugins`, `skillOverrides` observed) | D `.claude/settings.json`, `settings.local.json` | ? | V `managed-settings.json` read-only | precedence shown: managed › local › project › user |

| Surface | Status |
|---|---|
| Claude Code CLI | V detected via `claude --version` |
| Claude Desktop (app bundle) | V detected at `/Applications/Claude.app` (presence only; its config is not read or modified) |
| Claude Desktop Chat / Cowork / cloud environments | ? not researched; no support claimed |

Unsupported by design: private Claude databases, auth tokens, undocumented APIs.

## Verified against official docs (2026-11-24)
| Behaviour | Source | Where implemented |
|---|---|---|
| Skill precedence enterprise › personal › project; skill beats command file; plugin skills namespaced; reserved ship/ship-local/steward | skills.md "Resolve skills that share a name" | `packages/core/src/names.ts` |
| Skill command name = frontmatter `name` or directory name (both invoke) | skills.md "How a skill gets its command name" | `commandNames()` |
| `skillOverrides` values on / name-only / user-invocable-only / off | settings-reference `skillOverrides` | `setSkillEnabled` (writes `off`) |
| `.mcp.json` approval keys, trust gating, rejection precedence | mcp.md "Project server approvals and workspace trust"; settings-reference | `computeStates()` in `mcp.ts` |
| MCP scope precedence local › project › user (entry used whole) | mcp.md "Scope hierarchy and precedence" | `computeStates()` |
| Per-project `disabledMcpServers` in `~/.claude.json` | mcp.md "Disable a server without removing it" | `computeStates()` |
| Hook locations: user/project/local/managed settings, plugin `hooks/hooks.json` + manifest `hooks`, skill & subagent frontmatter | hooks.md "Hook locations", "Hooks in skills and agents"; plugins/manifest-reference "hooks" | `packages/core/src/hooks.ts` |
| Five handler types (command/http/mcp_tool/prompt/agent); exec vs shell form | hooks.md "Hook handler fields" | `build()` in `hooks.ts` |
| `allowManagedHooksOnly`, `strictPluginOnlyCustomization` (hooks), `disableAllHooks` precedence | settings-reference; hooks.md "Disable or remove hooks" | `listHooks()` policy block |
| Workspace trust holds back settings hooks interactively; `claude -p` does not ask | hooks.md "Workspace trust" | `trust-gated` status |
| `managed-settings.d/*.json` merge (managed-settings.json first, then alphabetical; later value wins; lists combine) | managed-settings.md "Split a file-based policy across teams" | `managed.ts` |
