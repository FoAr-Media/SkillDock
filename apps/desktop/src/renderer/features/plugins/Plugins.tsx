import { useState } from 'react'
import { type Go } from '../../app/nav'

import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, EmptyState, useUi } from '../../shared/ui'

export function Plugins({ go }: { go: Go }) {
  const { notify, confirm } = useUi(); const l = useCall<A[]>('plugins:list'); const [busy, setBusy] = useState<string>()
  const act = async (action: string, p: A) => {
    if (!(await confirm({ title: `${action} ${p.name}?`, danger: action === 'uninstall', confirmLabel: action, body: <><p>Runs <code>claude plugin {action} {p.id}</code> through the official Claude CLI.</p>{action === 'enable' && <p>Plugins can include hooks and MCP servers that run programs. Components: {p.components.skills} skills, {p.components.commands} commands, {p.components.agents} agents{p.components.hooks ? ', hooks' : ''}{p.components.mcp ? ', MCP servers' : ''}.</p>}</> }))) return
    setBusy(p.id); try { notify('ok', (await call<string>('plugins:action', { action, id: p.id })) || `${action} done`); l.reload() } catch (e) { notify('err', (e as Error).message) } finally { setBusy(undefined) }
  }
  return <div className="page"><h1>Plugins</h1><p className="note">Plugin lifecycle uses the official <code>claude plugin</code> CLI. Find new plugins in the <button className="link" onClick={() => go('marketplace', {})}>Marketplace</button>.</p>
    <Async r={l} empty={<EmptyState art="plugins" title="No plugins installed">Plugins bundle skills, commands, agents and MCP servers. Install one from the Marketplace.</EmptyState>}>{(rows) => <table className="table"><thead><tr><th>Plugin</th><th>Marketplace</th><th>Version</th><th>Components</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead><tbody>{rows.map((p) => <tr key={p.id}><td><b>{p.name}</b></td><td>{p.marketplace}</td><td>{p.version ?? '—'}</td><td>{p.components.skills} skills · {p.components.commands} cmds · {p.components.agents} agents{p.components.hooks && ' · hooks'}{p.components.mcp && ' · MCP'}</td><td>{p.enabled ? <Badge kind="ok">enabled</Badge> : <Badge kind="warn">disabled</Badge>}</td><td><button disabled={busy === p.id} onClick={() => act(p.enabled ? 'disable' : 'enable', p)}>{p.enabled ? 'Disable' : 'Enable'}</button><button className="danger" disabled={busy === p.id} onClick={() => act('uninstall', p)}>Uninstall</button></td></tr>)}</tbody></table>}</Async></div>
}
