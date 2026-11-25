# Component guidelines

Primitives live in `renderer/shared/ui/` (import from the barrel `shared/ui`). Icons: Lucide only, decorative icons `aria-hidden`.

| Component | Notes |
|---|---|
| `IconButton` | `label` required: it is the accessible name and the tooltip. |
| `BrandLogo`, `BrandSymbol` | Theme-matched lockup / symbol from the asset registry; height only. |
| `Modal` | Focus trap and Escape handled; destructive or permission requests use `useUi().confirm`. |
| `Badge`, `Tabs`, tables, cards | Class based (`.badge .tabs .table .card .tile`). Status is never colour-only: badges carry text. |
| `useAutoDismiss` | Outside pointer, Escape, idle timeout (paused while hovered/focused); callers also close on navigation. Used by the notification popover and theme menu. |
| `Spinner` (skeleton), `EmptyState`, `Empty` | Loading and empty patterns. `EmptyState` takes optional brand artwork; all text is HTML. Empty/error states say what happened and what to do next. |
| Toasts | `useUi().toast`; level icon + text, `role="status"`. |

Rules: no hardcoded colours or sizes in components; reuse tokens; keep test hooks (`nav.sidebar` buttons by label, `.modal`, `.toast`, role=tab) stable.
