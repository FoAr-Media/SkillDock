import { type ButtonHTMLAttributes, type ReactNode } from 'react'

/** Icon-only button: the accessible name is required and doubles as the tooltip. */
export function IconButton({ label, icon, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { label: string; icon: ReactNode }) {
  return <span className="tip" data-tip={label}><button {...rest} className={`icon ${rest.className ?? ''}`} aria-label={label}>{icon}</button></span>
}
