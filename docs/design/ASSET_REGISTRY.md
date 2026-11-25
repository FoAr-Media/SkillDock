# Brand asset registry

Sources are the supplied rasters in `assets/brand/` (read-only). Derived files are produced by `python3 scripts/build-brand-assets.py` (Pillow, numpy, scipy; macOS `iconutil` for `.icns`). In code, import brand imagery only from `apps/desktop/src/renderer/shared/brand/index.ts` (`BRAND`) or the `BrandLogo` / `BrandSymbol` / `EmptyState` components.

## Limitations (read first)
- **Every supplied file is an opaque RGB PNG** (verified: alpha channel absent or fully 255 in all 19). None is a vector master. There is no genuine SVG logo in the repository and none was created.
- **Transparency in derived files is produced by background removal**, not original. Light logos use a border-connected flood fill (so the white sparkle stays opaque) with edge un-blending; the dark logo uses a soft distance ramp so its glow fades into the surface. Hairline edge artefacts are possible; request transparent/vector masters for production use.
- The macOS/Windows/Linux icons are the supplied **dark tile** icon art with its baked light background and drop shadow removed by masking; edges are raster-approximate.
- Only the 4 empty-state scenes in B17 exist (skills, MCP, plugins, workflows).

## Supplied assets
| ID | Source path | Size | Alpha | Intended use | Status |
|---|---|---|---|---|---|
| B01 | logos/logo-primary.png | 1448×1086 | no | Light-theme lockup | **Integrated** (derived `logo-on-light.png`, 640×187) |
| B02 | logos/logo-dark.png | 1448×1086 | no | Dark-theme lockup | **Integrated** (`logo-on-dark.png`, 640×183) |
| B03 | logos/logo-light.png | 1448×1086 | no | Alternate light lockup | Not used (B01 is the light variant) |
| B04 | logos/symbol.png | 1254×1254 | no | Standalone symbol (collapsed sidebar, welcome, favicon, colour tray) | **Integrated** (`symbol.png`, 256×251) |
| B05 | logos/logo-monochrome.png | 1448×1086 | no | Single-colour lockup; source of the macOS tray template | **Integrated** (tray) and registered (`logo-mono.png`); no UI surface uses it yet |
| B06–B08 | icons/{macos,windows,linux}/icon-source.png | 1254×1254 | no | Application icons | **Integrated** (icns, ico, png set) |
| B09 | tray/tray-icons-reference.png | 1448×1086 | no | Reference only | Not shipped; tray icons are derived from B05/B04 |
| B10 | splash/splash-screen.png | 1672×941 | no | Startup splash | **Integrated** (`public/splash.webp`, 1408×792) |
| B11, B15, B16 | social/* | various | no | Social/profile | Not used by the app |
| B12 | social/github-banner.png | 1774×887 | no | README banner | **Integrated** (`docs/assets/github-banner.png`, 1400×700) |
| B13 | web/favicon-reference.png | 1448×1086 | no | Reference | Not used; favicon derived from B04 |
| B14 | installer/welcome.png | 1448×1086 | no | Installer branding | **Not integrated**: see below |
| B17 | illustrations/empty-states.png | 1448×1086 | no | Empty states | **Integrated** (4 crops, text excluded) |
| B18 | references/brand-guidelines.png | 1055×1491 | no | Brand guidelines reference | Reference only (kept in `assets/brand/references/`) |

**B14 installer:** the current targets are DMG, NSIS and AppImage/deb. The artwork bakes in a headline and a centrepiece with no clear area for DMG icon placement, and an NSIS sidebar (164×314 BMP) cannot be cropped from it without cutting the headline. Not integrated rather than shipped badly; revisit with purpose-made installer art.

## Derived assets
| Path | Size | Alpha | Use |
|---|---|---|---|
| apps/desktop/build/icon.icns | 16–1024 | yes | macOS (electron-builder `mac.icon`) |
| apps/desktop/build/icon.ico | 16, 24, 32, 48, 64, 128, 256 | yes | Windows (`win.icon`) |
| apps/desktop/build/icon.png + icons/{16,24,32,48,64,128,256,512,1024}.png | all | yes | Linux (`linux.icon: build/icons`), dev dock icon, window icon (also shipped as `Resources/icon.png`) |
| apps/desktop/build/tray/iconTemplate{,@2x,@3x}.png | 16/32/48 | yes | macOS tray template (black + alpha). **No tray exists in the app yet**, so these are not wired |
| apps/desktop/build/tray/tray-color-{16,24,32,48,64}.png | | yes | Windows/Linux tray (not wired) |
| renderer/public/favicon.ico, apple-touch-icon.png | 16/32/48, 180 | yes | `<link rel="icon">` |
| renderer/public/splash.{html,css,webp} | 1408×792 | no | Startup splash |
| renderer/shared/brand/*.png, *.webp | see above | logos yes | UI assets, bundled locally (no external image service) |
| docs/assets/github-banner.png | 1400×700 | no | README |

## Behaviour
- **Theme logo:** both lockups render and CSS (`.logo-on-light/.logo-on-dark`) shows the one for the active theme, including the System setting. Only `height` is set; width follows the artwork ratio (tested).
- **Splash:** a 704×396 frameless window opens with the main window and closes on the main window's `show` event. There are no timers; on a fast start the main window may be ready before the splash paints. Skipped in unpackaged e2e runs so automation sees the app window first.
- **Empty states:** artwork only; headings and helper text are HTML (`EmptyState`). Used on My Skills, MCP Servers and Plugins. The Workflows scene is registered but no Workflows feature exists, so it is unused.
- **Dev icon:** unpackaged runs set the macOS dock icon explicitly; before this the default Electron icon showed. Packaged builds embed `icon.icns` (verified byte-identical to `build/icon.icns`).
