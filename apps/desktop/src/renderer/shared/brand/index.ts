/**
 * Central registry of brand assets used by the UI. Import brand imagery from here only (never by path elsewhere).
 * Sources and derivation: assets/brand/** → scripts/build-brand-assets.py. Status of every asset: docs/design/ASSET_REGISTRY.md.
 * Derived rasters, not vectors: the supplied masters are opaque PNGs, so transparency is produced by background removal.
 */
import logoOnLight from './logo-on-light.png'
import logoOnDark from './logo-on-dark.png'
import logoMono from './logo-mono.png'
import symbol from './symbol.png'
import emptyMcp from './empty-mcp.webp'
import emptyPlugins from './empty-plugins.webp'
import emptySkills from './empty-skills.webp'
import emptyWorkflows from './empty-workflows.webp'

export const BRAND = {
  /** Horizontal lockups: B01 for light surfaces, B02 for dark surfaces, B05 single-colour (black, for print/forced-colour use). Aspect ratios are preserved; never set both width and height. */
  logo: { onLight: { src: logoOnLight, ratio: 640 / 187 }, onDark: { src: logoOnDark, ratio: 640 / 183 }, mono: { src: logoMono, ratio: 640 / 180 } },
  /** B04 standalone symbol. */
  symbol: { src: symbol, ratio: 256 / 251 },
  /** B17 illustrations (artwork only; headings and helper text are HTML). */
  empty: { skills: emptySkills, mcp: emptyMcp, plugins: emptyPlugins, workflows: emptyWorkflows }
} as const
export type EmptyArt = keyof typeof BRAND.empty
