import { BRAND, type EmptyArt } from '../brand'
import { type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

export const Badge = ({ kind = 'neutral', children, title }: { kind?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent'; children: ReactNode; title?: string }) => <span className={`badge ${kind}`} title={title}>{children}</span>
/** Empty view with optional brand illustration. All text is HTML; the artwork is decorative. */
export function EmptyState({ art, title, children }: { art?: EmptyArt; title: string; children?: ReactNode }) {
  return <div className="empty-state">{art && <img className="empty-art" src={BRAND.empty[art]} alt="" width={324} height={154} />}<h2>{title}</h2>{children && <p>{children}</p>}</div>
}
export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>
export const Spinner = ({ label = 'Loading…' }: { label?: string }) => <div role="status"><Skeleton lines={3} label={label} /><span className="sr">{label}</span></div>
export const ErrorBox = ({ error, retry }: { error: string; retry?: () => void }) => <div className="errorbox" role="alert"><TriangleAlert size={16} aria-hidden="true" /> <b>Something went wrong.</b> {error} {retry && <button onClick={retry}>Try again</button>}</div>
export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (t: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t} role="tab" aria-selected={t === value} className={t === value ? 'tab active' : 'tab'} onClick={() => onChange(t)}>{t}</button>)}</div>
}
export function Async<T>({ r, children, empty }: { r: { data?: T; error?: string; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; empty?: ReactNode }) {
  if (r.error) return <ErrorBox error={r.error} retry={r.reload} />
  if (r.loading && !r.data) return <Spinner />
  if (r.data === undefined) return null
  if (empty && Array.isArray(r.data) && !r.data.length) return <>{empty}</>
  return <>{children(r.data)}</>
}
export function DiffView({ diff }: { diff: string }) {
  return <pre className="diff">{diff.split('\n').filter((l) => !l.startsWith('===') && !l.startsWith('Index')).map((l, i) => <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>{l || ' '}</div>)}</pre>
}

export function Skeleton({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return <div role="status" aria-label={label}>{Array.from({ length: lines }, (_, i) => <span key={i} className="skeleton" data-w={i === lines - 1 ? 'short' : 'full'} />)}</div>
}
