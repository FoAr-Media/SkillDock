import { BRAND } from '../brand'

/** Horizontal lockup. Both theme variants are rendered; CSS (`.logo-on-*` in tokens.css) shows the one matching the active theme, so it follows the System setting too. Height only: width follows the artwork's aspect ratio. */
export function BrandLogo({ height = 32 }: { height?: number }) {
  const l = BRAND.logo
  return <>
    <img className="logo-on-dark" src={l.onDark.src} alt="SkillDock" height={height} width={Math.round(height * l.onDark.ratio)} />
    <img className="logo-on-light" src={l.onLight.src} alt="SkillDock" height={height} width={Math.round(height * l.onLight.ratio)} />
  </>
}
/** Standalone symbol (B04). Decorative unless a title is given. */
export function BrandSymbol({ height = 28, title }: { height?: number; title?: string }) {
  return <img src={BRAND.symbol.src} alt={title ?? ''} height={height} width={Math.round(height * BRAND.symbol.ratio)} />
}
