import { UiProvider } from '../shared/ui'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, ChevronsLeft, ChevronsRight, CircleAlert, CircleCheck, Info, Menu, Monitor, Moon, Search, Sun } from 'lucide-react'
import { Palette } from './CommandPalette'
import { type Go, NAV } from './nav'
import { Activity } from '../features/activity/Activity'
import { Agents } from '../features/agents/Agents'
import { Backups } from '../features/backups/Backups'
import { Commands } from '../features/commands/Commands'
import { Config } from '../features/config/Config'
import { Hooks } from '../features/hooks/Hooks'
import { Marketplace } from '../features/marketplace/Marketplace'
import { McpPage } from '../features/mcp/Mcp'
import { Onboarding } from '../features/onboarding/Onboarding'
import { Orgs } from '../features/organizations/Organizations'
import { Overview } from '../features/overview/Overview'
import { Plugins } from '../features/plugins/Plugins'
import { Presets } from '../features/presets/Presets'
import { Projects } from '../features/projects/Projects'
import { Security } from '../features/security/Security'
import { Settings } from '../features/settings/Settings'
import { MySkills } from '../features/skills/MySkills'
import { Studio } from '../features/studio/Studio'
import { type A, call, useCall } from '../shared/api'
import { BrandLogo, BrandSymbol, IconButton, ResizeHandle, ago, useAutoDismiss, useUi } from '../shared/ui'

/** full ≥1100px · rail (icons only) 760–1099px · drawer (<760px). */
function useMode(): 'full' | 'rail' | 'drawer' {
  const get = (): 'full' | 'rail' | 'drawer' => (window.innerWidth < 760 ? 'drawer' : window.innerWidth < 1100 ? 'rail' : 'full')
  const [m, setM] = useState(get)
  useEffect(() => { const f = () => setM(get()); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  return m
}
const THEMES = [{ id: 'system', label: 'System', Icon: Monitor }, { id: 'light', label: 'Light', Icon: Sun }, { id: 'dark', label: 'Dark', Icon: Moon }] as const

function Shell() {
  const { notes, clearNotes } = useUi()
  const [page, setPage] = useState('overview'); const [arg, setArg] = useState<A>(); const [nonce, setNonce] = useState(0)
  const [collapsed, setCollapsedState] = useState(() => { try { return localStorage.getItem('skilldock.sidebar') === 'collapsed' } catch { return false } }); const [palette, setPalette] = useState(false)
  const [bell, setBell] = useState(false); const [seen, setSeen] = useState(0); const [themeMenu, setThemeMenu] = useState(false); const [menuOpen, setMenuOpen] = useState(false)
  const settings = useCall<A>('settings:get'); const env = useCall<A[]>('env:detect'); const info = useCall<A>('app:info')
  const mode = useMode()
  const bellBtn = useRef<HTMLSpanElement>(null), panel = useRef<HTMLElement>(null), themeBtn = useRef<HTMLDivElement>(null), navRef = useRef<HTMLElement>(null)
  const go: Go = useCallback((p, a) => { setPage(p); setArg(a); setNonce((n) => n + 1) }, []) // every navigation remounts the page: clicking the active section returns to its start

  // Popovers close themselves: outside click, Escape, idle timeout (paused while in use), and on navigation.
  useAutoDismiss(bell, () => setBell(false), [bellBtn, panel], 9000)
  useAutoDismiss(themeMenu, () => setThemeMenu(false), [themeBtn], 12000)
  useAutoDismiss(menuOpen, () => setMenuOpen(false), [navRef], 0)
  useEffect(() => { setBell(false); setThemeMenu(false); setMenuOpen(false) }, [nonce])
  useEffect(() => { if (mode !== 'drawer') setMenuOpen(false) }, [mode])
  const toggleBell = () => { setThemeMenu(false); setBell((b) => { if (!b) setSeen(Date.now()); return !b }) }
  useEffect(() => { if (bell) setSeen(Date.now()) }, [bell, notes.length])

  // Theme/density: persisted by the settings store; mirrored to localStorage so the next launch paints the right theme before React loads.
  const theme: string = settings.data?.theme ?? 'system', density: string = settings.data?.density ?? 'comfortable'
  useEffect(() => { const r = document.documentElement; if (settings.data) { if (theme === 'dark' || theme === 'light') r.dataset.theme = theme; else delete r.dataset.theme; try { localStorage.setItem('skilldock.theme', theme) } catch { /* ignore */ } } }, [theme, settings.data])
  useEffect(() => { const r = document.documentElement; if (settings.data) { if (density === 'compact' || density === 'comfortable') r.dataset.density = density; else delete r.dataset.density; try { density === 'comfortable' ? localStorage.removeItem('skilldock.density') : localStorage.setItem('skilldock.density', density) } catch { /* ignore */ } } }, [density, settings.data])
  // Sidebar collapse is a persisted preference (settings store is the source of truth; localStorage avoids a layout jump at startup).
  const setCollapsed = useCallback((v: boolean) => { setCollapsedState(v); try { localStorage.setItem('skilldock.sidebar', v ? 'collapsed' : 'expanded') } catch { /* ignore */ } void call('settings:set', { sidebarCollapsed: v }) }, [])
  useEffect(() => { if (settings.data) { setCollapsedState(!!settings.data.sidebarCollapsed); try { localStorage.setItem('skilldock.sidebar', settings.data.sidebarCollapsed ? 'collapsed' : 'expanded') } catch { /* ignore */ } } }, [settings.data])
  const pickTheme = async (t: string) => { setThemeMenu(false); await call('settings:set', { theme: t }); settings.reload() }
  useEffect(() => { const k = (e: KeyboardEvent) => { if (!(e.metaKey || e.ctrlKey)) return; const k = e.key.toLowerCase(); if (k === 'k') { e.preventDefault(); setPalette((p) => !p) } else if (k === 'b') { e.preventDefault(); setCollapsed(!collapsed) } else if (k === ',') { e.preventDefault(); go('settings') } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [collapsed, setCollapsed, go])

  const label = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))).find((i) => i.id === page)
  const cc = env.data?.find((t: A) => t.id === 'claude-code')
  const missing = env.data?.filter((t: A) => t.status !== 'connected' && t.id !== 'claude-code').length ?? 0
  const unread = notes.filter((n) => n.ts > seen).length
  const body = useMemo(() => {
    const p = { go, arg }
    switch (page) {
      case 'overview': return <Overview {...p} />
      case 'marketplace': return <Marketplace {...p} />
      case 'skills': return <MySkills {...p} />
      case 'mcp': return <McpPage {...p} />
      case 'plugins': return <Plugins {...p} />
      case 'commands': return <Commands {...p} />
      case 'agents': return <Agents {...p} />
      case 'hooks': return <Hooks {...p} />
      case 'projects': return <Projects {...p} />
      case 'studio': return <Studio {...p} />
      case 'presets': return <Presets {...p} />
      case 'orgs': return <Orgs {...p} />
      case 'security': return <Security {...p} />
      case 'config': return <Config {...p} />
      case 'backups': return <Backups {...p} />
      case 'activity': return <Activity {...p} />
      case 'settings': return <Settings {...p} onChanged={settings.reload} />
      default: return null
    }
  }, [page, arg, go, settings.reload])

  const needOnboarding = settings.data && !settings.data.onboarded
  const rail = mode === 'rail' || (mode === 'full' && collapsed)
  const ThemeIcon = (THEMES.find((t) => t.id === theme) ?? THEMES[0]).Icon

  return (
    <div className={['app', mode === 'drawer' && 'drawer', rail && 'rail', menuOpen && 'menu-open', info.data && `p-${info.data.platform}`].filter(Boolean).join(' ')}>
            <nav aria-label="Primary" className="sidebar" ref={navRef} inert={mode === 'drawer' && !menuOpen}>
        <div className="dragzone" />
        <div className="brand"><span className="brand-full"><BrandLogo height={30} /></span><span className="brand-mark"><BrandSymbol height={28} title="SkillDock" /></span></div>
        {NAV.map((g) => (
          <div key={g.group}>
            <h2>{g.group}</h2>
            {g.items.map((i) => <button key={i.id} className={i.id === page ? 'nav active' : 'nav'} aria-current={i.id === page ? 'page' : undefined} data-label={i.label} onClick={() => go(i.id)}><span className="ico" aria-hidden="true">{i.icon}</span><span className="label">{i.label}</span></button>)}
          </div>
        ))}
        {mode === 'full' && <button className="nav collapse" title="Toggle sidebar (⌘B)" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} data-label={collapsed ? 'Expand sidebar' : 'Collapse'}><span className="ico" aria-hidden="true">{collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}</span><span className="label">{collapsed ? 'Expand sidebar' : 'Collapse'}</span></button>}
        {mode === 'full' && !collapsed && <ResizeHandle cssVar="--sidebar-w" storageKey="skilldock.sidebarw" label="Resize sidebar" min={200} max={420} className="sidebar-resize" />}
      </nav>
            {mode === 'drawer' && menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <div className="main">
        <header className="topbar">
          {mode === 'drawer' && <IconButton label="Open navigation" icon={<Menu size={18} />} onClick={() => setMenuOpen(true)} />}
          <div className="crumbs" aria-label="Breadcrumb">{label?.group} <span>/</span> <b>{label?.label}</b></div>
          <button className="search" onClick={() => setPalette(true)} title="Command palette (⌘K)"><Search size={15} aria-hidden="true" /><span className="search-text">Search or jump to…</span><kbd>⌘K</kbd></button>
          <div className="menu-anchor" ref={themeBtn}>
            <IconButton label="Theme" icon={<ThemeIcon size={18} />} aria-haspopup="menu" aria-expanded={themeMenu} onClick={() => { setBell(false); setThemeMenu((o) => !o) }} />
            {themeMenu && <div className="popover menu" role="menu" aria-label="Theme">{THEMES.map(({ id, label: l, Icon }) => <button key={id} role="menuitemradio" aria-checked={theme === id} onClick={() => pickTheme(id)}><Icon size={15} aria-hidden="true" />{l}</button>)}</div>}
          </div>
          <span ref={bellBtn}><button className="icon" onClick={toggleBell} aria-expanded={bell}><Bell size={18} aria-hidden="true" /><span className="sr">Notifications{unread > 0 ? ` (${unread} unread)` : ''}</span>{unread > 0 && <i className="dotbadge" aria-hidden="true">{unread}</i>}</button></span>
        </header>
        {bell && (
          <aside className="popover notes" aria-label="Notification center" ref={panel}>
            <div className="nhead"><b>Notifications</b><button onClick={clearNotes} disabled={notes.length === 0}>Clear all</button></div>
            <div className="nbody">{notes.length === 0 ? <p className="empty">You're all caught up. Messages about installs, saves and errors appear here.</p> : notes.map((n) => <div key={n.id} className={`note-item ${n.level}`}>{n.level === 'ok' ? <CircleCheck size={16} aria-hidden="true" /> : n.level === 'err' ? <CircleAlert size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}<div>{n.text}<small>{ago(new Date(n.ts).toISOString())}</small></div></div>)}</div>
          </aside>
        )}
        <main className="content" id="content"><Fragment key={nonce}>{body}</Fragment></main>
        <footer className="statusbar" aria-label="Status">
          <span className="status"><i className={cc?.status === 'connected' ? 'dot ok' : 'dot warn'} aria-hidden="true" />{cc?.status === 'connected' ? `Claude Code ${cc.version?.split(' ')[0]} connected` : 'Claude Code not detected'}</span>
          {missing > 0 && <span className="status"><i className="dot warn" aria-hidden="true" />{missing} optional {missing === 1 ? 'tool' : 'tools'} not found</span>}
          <span className="status"><i className="dot ok" aria-hidden="true" />Local only, no telemetry</span>
          <span>Community project, not an official Anthropic app</span>
        </footer>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} go={(p, a) => { go(p, a); setPalette(false) }} />}
      {needOnboarding && <Onboarding go={go} onDone={() => { void call('settings:set', { onboarded: true }).then(settings.reload) }} />}
    </div>
  )
}

export function App() { return <UiProvider><Shell /></UiProvider> }
