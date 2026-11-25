# Application shell

Code: `apps/desktop/src/renderer/app/` (`App.tsx` shell, `nav.tsx` navigation map, `CommandPalette.tsx`).

- **Title bar:** macOS uses inset traffic lights; Windows hides the bar and uses the native min/max/close overlay (shell reserves 150px); Linux keeps the native frame. The top bar is the drag region and its controls are no-drag. Windows overlay colours are fixed dark and do not follow the theme.
- **Sidebar:** 240px expanded, 64px rail. Auto-rail at 760–1099px, slide-out drawer below 760px. Manual collapse (button or ⌘/Ctrl+B) is persisted (`settings.sidebarCollapsed`, mirrored to localStorage to avoid a startup jump). Collapsed items show a tooltip on hover and keyboard focus. Active item: violet bar and tint; everything else neutral.
- **Resizable panels:** drag the sidebar edge (200–420px) or the list/detail divider (260–900px) in My Skills, MCP Servers, Agents, Configuration and Projects. Also ←/→ when focused (Shift = 64px) and double-click to reset. Widths persist in localStorage; the list/detail width is shared across those screens. Hidden in rail, drawer and single-column layouts.
- **Search and shortcuts:** ⌘/Ctrl+K command palette (pages and skills), ⌘/Ctrl+B sidebar, ⌘/Ctrl+, Settings.
- **Breadcrumb:** group / page.
- **Status bar:** Claude Code connection (dot + version), count of missing optional tools, local-only note.
- **Theme and density:** theme menu in the top bar (System/Light/Dark, dark default); density in Settings.
- **Notifications:** popover that auto-dismisses (see DESIGN_SYSTEM).
- **Details panels:** list/detail split views (My Skills, MCP Servers, Agents, Configuration, Projects) collapse to a single column under 860px. There is no separate global details panel.

## Navigation mapping
The suggested structure was mapped onto what exists; nothing unimplemented is shown.
| Suggested | SkillDock |
|---|---|
| Workspace: Overview, Discover, My Skills, MCP Servers, Plugins | Overview, **Marketplace** (Discover), My Skills, MCP Servers, Plugins, plus Commands, Agents, Hooks, Skill Studio |
| Workspace: Workflows | Not built, omitted |
| Collections: Personas, Saved Items, Recently Used | Not built, omitted. Collections holds **Projects, Presets, Organizations** |
| System: Connected AI Apps | Environment table on Overview / Configuration (no dedicated page) |
| System: Updates | "Check updates" action on Overview (no dedicated page) |
| System: Activity and Logs, Settings | Activity, Settings, plus Security, Configuration, Backups |
Labels are unchanged so existing behaviour and tests are preserved ("Marketplace" was not renamed to "Discover").

## Tool detection
Apps launched from Finder/the Dock get a minimal PATH, so `claude`, `node`, `npm` and `uv` looked missing. At startup (packaged builds, or unpackaged runs without `SKILLDOCK_E2E`) `main/path.ts` merges the login shell's PATH plus `~/.local/bin`, Homebrew, cargo and nvm directories into `process.env.PATH`. This also affects plugin CLI actions, Run with Claude and MCP tests, which use the same PATH.
