import { useEffect, useState } from 'react'
import { type Go } from '../../app/nav'


import { Inheritance } from './Inheritance'
import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, Empty, Spinner, Tabs, useUi , ResizeHandle } from '../../shared/ui'

export function Projects({ go, arg }: { go: Go; arg?: A }) {
  const { notify, confirm } = useUi(); const l = useCall<A[]>('projects:list'); const [sel, setSel] = useState<string>()
  const add = async () => { try { const p = await call<string | null>('projects:add'); if (p) { notify('ok', `Registered ${p}`); l.reload(); setSel(p) } } catch (e) { notify('err', (e as Error).message) } }
  useEffect(() => { if (arg?.add) void add() }, [arg]) // eslint-disable-line
  return <div className="split"><ResizeHandle cssVar="--list-w" storageKey="skilldock.listw" label="Resize list and detail panels" min={260} max={900} /><h1 className="sr">Projects</h1><section className="listpane"><div className="toolbar"><button className="primary" onClick={add}>Register project…</button></div><p className="note">Only folders you pick are registered; nothing scans your disk.</p>
    <Async r={l} empty={<Empty>No projects registered yet.</Empty>}>{(rows) => <ul className="plist">{rows.map((p) => <li key={p.path}><button className={p.path === sel ? 'link active' : 'link'} onClick={() => setSel(p.path)}>{p.path.split('/').slice(-2).join('/')}</button> {p.isGit && <Badge>git</Badge>} {!p.exists && <Badge kind="bad">missing</Badge>}</li>)}</ul>}</Async></section>
    <section className="detailpane">{sel ? <Overview key={sel} path={sel} go={go} onRemove={async () => { if (await confirm({ title: 'Unregister project?', body: <p>Only removes it from this app. Files in the project are untouched.</p>, confirmLabel: 'Unregister' })) { await call('projects:remove', { path: sel }); setSel(undefined); l.reload() } }} /> : <Empty>Select a project to see its Claude configuration.</Empty>}</section></div>
}

function Overview({ path, go, onRemove }: { path: string; go: Go; onRemove: () => void }) {
  const d = useCall<A>('projects:overview', { path }); const [tab, setTab] = useState('Resources')
  if (d.error) return <p className="empty">{d.error}</p>; if (!d.data) return <Spinner />
  const o = d.data
  return <div><div className="dhead"><h2>{path.split('/').pop()}</h2><button onClick={onRemove}>Unregister</button></div><p className="note">{path}</p>
    <div className="actions"><button onClick={() => go('marketplace')}>Install a skill here (choose project scope)</button><button onClick={() => go('mcp', { add: true })}>Add MCP server</button><button onClick={() => go('presets')}>Apply preset</button><button onClick={() => void call('app:openTerminal', { project: path })}>Open Terminal here</button></div>
    <Tabs tabs={['Resources', 'Inheritance', 'Files']} value={tab} onChange={setTab} />
    {tab === 'Resources' && <div className="tabbody"><h4>Project skills ({o.skills.length})</h4>{o.skills.length ? <ul>{o.skills.map((s: A) => <li key={s.id}><button className="link" onClick={() => go('skills', { select: s.id })}>{s.name}</button> — {s.description.slice(0, 90)}</li>)}</ul> : <p className="empty">None in <code>.claude/skills</code>. User skills still apply.</p>}
      <h4>MCP servers ({o.mcp.length})</h4>{o.mcp.length ? <ul>{o.mcp.map((m: A) => <li key={m.scope + m.name}>{m.name} <Badge>{m.scope}</Badge></li>)}</ul> : <p className="empty">None.</p>}
      <h4>Agents ({o.agents.length})</h4>{o.agents.length ? <ul>{o.agents.map((a: A) => <li key={a.id}>{a.name}</li>)}</ul> : <p className="empty">None.</p>}
      <h4>Hooks ({o.hooks.length})</h4>{o.hooks.length ? <ul>{o.hooks.map((h: A, i: number) => <li key={i}>{h.event}: <code>{h.summary}</code> <Badge>{h.status}</Badge></li>)}</ul> : <p className="empty">None.</p>}</div>}
    {tab === 'Inheritance' && <Inheritance project={path} go={go} />}
    {tab === 'Files' && <div className="tabbody"><table className="table"><tbody>{o.files.map((f: A) => <tr key={f.id}><td>{f.label}</td><td className="trunc">{f.path}</td><td>{f.exists ? <Badge kind="ok">exists</Badge> : <Badge>not created</Badge>}</td><td><button onClick={() => go('config', { select: f.id })}>{f.exists ? 'Open' : 'Create'}</button></td></tr>)}</tbody></table></div>}
  </div>
}
