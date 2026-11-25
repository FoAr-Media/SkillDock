import { type Go } from '../../app/nav'
import { type A, useCall } from '../../shared/api'
import { Async, Badge } from '../../shared/ui'

export function Inheritance({ project, go }: { project?: string; go?: Go }) {
  const d = useCall<A>('inheritance:get', { project })
  return <Async r={d}>{({ layers, keys }) => <div className="tabbody">
    <p className="note">Precedence (highest first): managed › local › project › user. For single values the highest scope wins; objects and arrays are shown per scope without asserting how Claude merges them.</p>
    <table className="table"><thead><tr><th>Layer</th><th>File</th><th>Status</th><th>Keys</th></tr></thead><tbody>{layers.map((l: A) => <tr key={l.scope}><td><Badge kind={l.scope === 'managed' ? 'warn' : 'accent'}>{l.scope}</Badge></td><td className="trunc">{l.file}</td><td>{l.error ? <Badge kind="bad">invalid JSON</Badge> : l.exists ? <Badge kind="ok">present</Badge> : <Badge>absent</Badge>}</td><td>{l.keys.length}</td></tr>)}</tbody></table>
    <h4>Effective keys</h4>{keys.length === 0 ? <p className="empty">No settings keys defined.</p> : <table className="table"><thead><tr><th>Key</th><th>Winner</th><th>Defined in</th><th><span className="sr">Actions</span></th></tr></thead><tbody>{keys.map((k: A) => <tr key={k.key}><td><code>{k.key}</code></td><td>{k.winner}</td><td>{k.values.map((v: A) => <div key={v.scope}><b>{v.scope}</b>: <code>{JSON.stringify(v.value).slice(0, 70)}</code></div>)}</td><td>{k.conflict && <Badge kind="warn">conflict</Badge>}</td></tr>)}</tbody></table>}</div>}</Async>
}
