import { type Go } from '../../app/nav'
import { type A, call, useCall } from '../../shared/api'
import { Async, Empty, useUi } from '../../shared/ui'

export function Backups({}: { go: Go }) {
  const { notify, confirm } = useUi(); const b = useCall<A[]>('backups:list'); const inc = useCall<A[]>('backups:incomplete')
  const restore = async (x: A) => { if (!(await confirm({ title: 'Restore this backup?', confirmLabel: 'Restore', body: <><p><b>{x.label}</b> from {new Date(x.createdAt).toLocaleString()}.</p><p>Restores {x.entries.length} path(s): {x.entries.map((e: A) => e.orig).slice(0, 4).join(', ')}. Files that did not exist then are removed.</p></> }))) return; try { await call('backups:restore', { id: x.id }); notify('ok', 'Restored') } catch (e) { notify('err', (e as Error).message) } }
  return <div className="page"><h1>Backups &amp; recovery</h1><p className="note">A backup is taken before every change this app makes. Backups are stored privately (owner-only) in the app data folder, may contain secrets, and are never exported or logged.</p>
    <Async r={inc}>{(rows) => rows.length > 0 ? <div className="errorbox" role="alert"><b>Incomplete operations detected</b> (the app stopped mid-operation):{rows.map((j) => <div key={j.id} className="actions">{j.label} · {new Date(j.startedAt).toLocaleString()}<button className="primary" onClick={async () => { await call('backups:resolve', { id: j.id, action: 'rollback' }); notify('ok', 'Rolled back'); inc.reload(); b.reload() }}>Roll back</button><button onClick={async () => { await call('backups:resolve', { id: j.id, action: 'keep' }); inc.reload() }}>Keep changes</button></div>)}</div> : null}</Async>
    <Async r={b} empty={<Empty>No backups yet.</Empty>}>{(rows) => <table className="table"><thead><tr><th>When</th><th>Operation</th><th>Paths</th><th><span className="sr">Actions</span></th></tr></thead><tbody>{rows.map((x) => <tr key={x.id}><td>{new Date(x.createdAt).toLocaleString()}</td><td>{x.label}</td><td className="trunc">{x.entries.map((e: A) => e.orig).join(', ')}</td><td><button onClick={() => restore(x)}>Restore</button></td></tr>)}</tbody></table>}</Async></div>
}
