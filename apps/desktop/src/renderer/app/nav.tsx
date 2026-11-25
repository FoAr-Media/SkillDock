import { type ReactNode } from 'react'
import { Archive, Bell, Boxes, Bot, Building2, Compass, Folders, Layers, LayoutGrid, PencilRuler, PlugZap, Puzzle, Settings2, ShieldCheck, SlidersHorizontal, Terminal, Webhook, History } from 'lucide-react'
import { type A } from '../shared/api'

const ico = (I: typeof Bell) => <I size={18} strokeWidth={1.75} />
export const NAV: { group: string; items: { id: string; label: string; icon: ReactNode }[] }[] = [
  { group: 'Workspace', items: [{ id: 'overview', label: 'Overview', icon: ico(LayoutGrid) }, { id: 'marketplace', label: 'Marketplace', icon: ico(Compass) }, { id: 'skills', label: 'My Skills', icon: ico(Boxes) }, { id: 'mcp', label: 'MCP Servers', icon: ico(PlugZap) }, { id: 'plugins', label: 'Plugins', icon: ico(Puzzle) }, { id: 'commands', label: 'Commands', icon: ico(Terminal) }, { id: 'agents', label: 'Agents', icon: ico(Bot) }, { id: 'hooks', label: 'Hooks', icon: ico(Webhook) }, { id: 'studio', label: 'Skill Studio', icon: ico(PencilRuler) }] },
  { group: 'Collections', items: [{ id: 'projects', label: 'Projects', icon: ico(Folders) }, { id: 'presets', label: 'Presets', icon: ico(Layers) }, { id: 'orgs', label: 'Organizations', icon: ico(Building2) }] },
  { group: 'System', items: [{ id: 'security', label: 'Security', icon: ico(ShieldCheck) }, { id: 'config', label: 'Configuration', icon: ico(SlidersHorizontal) }, { id: 'backups', label: 'Backups', icon: ico(Archive) }, { id: 'activity', label: 'Activity', icon: ico(History) }, { id: 'settings', label: 'Settings', icon: ico(Settings2) }] }
]
export type Go = (page: string, arg?: A) => void
