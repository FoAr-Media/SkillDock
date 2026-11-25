# SkillDock design system

Source of truth: `apps/desktop/src/renderer/design/tokens.css`. Layers: **primitives** (`--p-*`, brand values) → **semantic** (`--bg --surface --surface-raised --border --text --text-2 --text-3 --brand --brand-text --accent --success --warning --danger --danger-text --info`, soft tints, `--hover --pressed --selected --scrim`, shadows) → component CSS (`styles.css`). Components use semantic tokens only.

- **Themes:** `data-theme="dark|light"` on `<html>`; absent = follow the OS (`prefers-color-scheme`). Persisted in SQLite via `settings:set`, mirrored to `localStorage` and applied by `public/theme-init.js` before first paint.
- **Density:** `data-density="compact|comfortable"` changes `--control-h`, `--control-px`, `--row-py`.
- **Type:** Inter Variable (UI), JetBrains Mono Variable (code, JSON, paths, ids). Display 40/700, H1 32/700, H2 24/600, H3 20/600, H4 16/600, Body 14, Small 13, Caption 12/500. Page titles use the H2 step for density; H1/Display are for brand moments.
- **Spacing:** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 (`--sp-*`). **Radius:** 4, 6, 8, 12, 16, 24 (`--r-*`).
- **Motion:** 120/180/260ms, one easing. Motion only communicates state (popover, dialog, loading). `prefers-reduced-motion` collapses all durations. Animate transform, not opacity, on overlays (contrast must stay measurable).
- **Layers:** sticky 10, popover 30, drawer 40, modal 50, toast 60.
- **Layout tiers:** full ≥1100px, icon rail 760–1099px, drawer <760px. Minimum window 640×520.
- **Light-theme status text** uses darker 700/800 primitives and dark-theme error text uses `--danger-text` (#F87171) so text clears WCAG AA on tinted surfaces; the brand red #EF4444 is kept for fills and borders.
- **CSP constraint:** no inline `style` attributes or inline scripts (production CSP). Avoid dynamic widths in inline styles; use classes .
