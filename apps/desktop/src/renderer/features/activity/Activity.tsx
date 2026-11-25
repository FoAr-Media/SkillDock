import { useState } from 'react'
import { type Go } from '../../app/nav'
import { type A, useCall } from '../../shared/api'
import { Async, Badge, Empty, ago } from '../../shared/ui'

export function Activity({}: { go: Go }) {
  const a = useCall<A[]>('activity:list'); const [f, setF] = useState('all')
  return <div className="page"><h1>Activity</h1><p className="note">Local audit log of what this app did. Never leaves your device.</p><div className="toolbar"><select aria-label="Filter" value={f} onChange={(e) => setF(e.target.value)}><option value="all">All</option><option value="failed">Failed only</option></select><button onClick={a.reload}>Refresh</button></div>
    <Async r={a} empty={<Empty>No activity yet.</Empty>}>{(rows) => <table className="table"><thead><tr><th>When</th><th>Action</th><th>Detail</th><th>Result</th></tr></thead><tbody>{rows.filter((r) => f === 'all' || !r.ok).map((r) => <tr key={r.id}><td>{ago(r.ts)}</td><td><code>{r.action}</code></td><td className="trunc">{r.detail}</td><td><Badge kind={r.ok ? 'ok' : 'bad'}>{r.ok ? 'ok' : 'failed'}</Badge></td></tr>)}</tbody></table>}</Async></div>
}
