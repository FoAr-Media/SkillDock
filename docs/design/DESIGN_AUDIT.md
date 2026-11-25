# Design audit (pre-redesign baseline)

Date: 2026-11-25. Scope: `apps/desktop/src/renderer`.

| Area | Finding | Resolution |
|---|---|---|
| Brand assets | No logo, icon or brand files existed; Electron's default icon shipped. | Supplied brand rasters integrated (see ASSET_REGISTRY.md); the earlier reconstructed logo was removed. |
| Styling | One 52-line `styles.css` with hardcoded colours (`#D99B79` accent), no tokens, no font loading. | Primitive → semantic token layers in `design/tokens.css`; components consume semantic tokens only. |
| Typography | System font stack; no mono for code/paths. | Inter Variable + JetBrains Mono Variable bundled (OFL-1.1) with the brief's scale. |
| Icons | Unicode glyphs and emoji (`🔔`, `✕`) mixed in navigation and controls. | Lucide only (ISC). |
| Notifications | Panel toggled only by the bell and stayed open until clicked again. | Closes on outside click, Escape, navigation and idle timeout (paused while hovered/focused). |
| Responsiveness | Fixed 1024×640 minimum; one sidebar mode (full or collapsed by hand). | Three tiers: full ≥1100px, icon rail 760–1099px, drawer <760px; minimum window 640×520. |
| Theme | System/dark/light existed but the first paint could flash. | `theme-init.js` (external; CSP forbids inline) mirrors the persisted choice to `localStorage`; SQLite stays the source of truth. |
| Density | None. | Comfortable/compact preference (`settings:set`). |
| First run | Plain scan dialog. | Branded welcome (the only gradient use) plus a "Get started" row on Overview. |
| Accessibility | 0 serious/critical at baseline; new palette re-verified. | Contrast tokens tuned; still 0 serious/critical over 37 views. |
| Electron | `hiddenInset` title bar present; no drag regions on the new shell; no tray. | Drag zone above the nav and on the top bar (controls `no-drag`). **Tray and native context menus not implemented.** |

Preserved functionality is guarded by the existing suites (see TEST_REPORT).
