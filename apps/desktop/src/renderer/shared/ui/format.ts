import { type Ui } from './notifications'

export const copy = async (text: string, notify: Ui['notify']) => { try { await navigator.clipboard.writeText(text); notify('ok', 'Copied to clipboard') } catch { notify('err', 'Copy failed') } }
export const ago = (iso?: string) => { if (!iso) return '—'; const s = (Date.now() - +new Date(iso)) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : new Date(iso).toLocaleDateString() }
export const secKind = (s: string) => (s === 'high-risk' || s === 'blocked' ? 'bad' : s === 'review-recommended' ? 'warn' : s === 'inspection-completed' ? 'ok' : 'neutral')
export const secLabel = (s: string) => ({ 'not-inspected': 'Not inspected', 'inspection-completed': 'No findings (advisory)', 'review-recommended': 'Review recommended', 'high-risk': 'High-risk behavior detected', blocked: 'Blocked by policy', 'user-approved': 'User-approved exception' } as Record<string, string>)[s] ?? s
