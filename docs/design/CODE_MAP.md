# Code map

```
packages/core/src      Electron-free logic, one module per concern (skills, mcp, hooks, install, marketplace, backup…)
apps/desktop/src
  main/                index.ts (window, splash, title bar, icon), handlers.ts (all IPC, zod, native confirms)
  preload/             exposes window.skilldock.invoke only
  renderer/
    app/               shell: App, nav, CommandPalette, main entry
    features/<name>/   one folder per screen: overview, marketplace (+Resource), skills, mcp, plugins, commands,
                       agents, hooks, projects (+Inheritance), studio, presets, organizations, security, config,
                       backups, activity, settings, onboarding; install/ (plan review + target picker, shared),
                       environment/ (EnvTable)
    shared/            api.ts (IPC client), ui/ (Modal, widgets, toasts, format, markdown, BrandLogo…), brand/ (asset registry)
    design/            tokens.css (primitives→semantic), styles.css (components)
    public/            theme-init.js, splash, favicon (copied verbatim to the build)
assets/brand/          supplied brand rasters (read-only)     scripts/  licenses, build-brand-assets.py
tests/                 unit (boundary), e2e (app, design, a11y, packaged, live), qa
```
Feature folders import only from `shared/`, `features/install` or other features' exported components; nothing imports `app/` except for the `Go` navigation type.
