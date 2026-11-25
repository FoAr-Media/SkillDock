import { useState } from 'react'
import { type Go } from '../../app/nav'
import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, Empty, Modal, useUi , ResizeHandle } from '../../shared/ui'

export function Agents({ go }: { go: Go }) {
  const { notify } = useUi(); const l = useCall<A[]>('agents:list'); const [sel, setSel] = useState<string>(); const [creating, setCreating] = useState(false)
  return <div className="split"><ResizeHandle cssVar="--list-w" storageKey="skilldock.listw" label="Resize list and detail panels" min={260} max={900} /><h1 className="sr">Agents</h1><section className="listpane"><div className="toolbar"><button className="primary" onClick={() => setCreating(true)}>New agent</button></div>
    <Async r={l} empty={<Empty>No custom agents found.</Empty>}>{(rows) => <table className="table"><thead><tr><th>Name</th><th>Scope</th><th>Model</th></tr></thead><tbody>{rows.map((a) => <tr key={a.id} className={a.id === sel ? 'active' : ''} tabIndex={0} onClick={() => setSel(a.id)} onKeyDown={(e) => e.key === 'Enter' && setSel(a.id)}><td><b>{a.name}</b><div className="note trunc">{a.description}</div></td><td>{a.scope}</td><td>{a.model ?? '—'}</td></tr>)}</tbody></table>}</Async></section>
    <section className="detailpane">{sel ? <AgentEditor id={sel} key={sel} onSaved={l.reload} /> : <Empty>Select an agent to view or edit it.</Empty>}</section>
    {creating && <AgentCreate onClose={() => setCreating(false)} onDone={(f) => { setCreating(false); l.reload(); setSel(f); notify('ok', 'Agent created') }} />}</div>
}
function AgentEditor({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { notify } = useUi(); const d = useCall<A>('agents:read', { id }); const [text, setText] = useState<string>(); const [busy, setBusy] = useState(false)
  if (!d.data) return <p className="empty">{d.error ?? 'Loading…'}</p>
  const a = d.data.agent, cur = text ?? d.data.text, ro = a.scope === 'plugin'
  return <div><div className="dhead"><h2>{a.name}</h2><Badge kind="accent">{a.scope}</Badge></div><p className="note">{a.file}</p>{a.errors.map((e: string) => <p key={e} className="warn">⚠ {e}</p>)}
    <textarea className="code" rows={22} value={cur} readOnly={ro} onChange={(e) => setText(e.target.value)} aria-label="Agent file" spellCheck={false} />
    {ro ? <p className="note">Plugin agents are read-only.</p> : <div className="actions"><button className="primary" disabled={busy || text === undefined} onClick={async () => { setBusy(true); try { await call('agents:save', { id, text: cur, hash: d.data.hash }); notify('ok', 'Saved (backup kept)'); setText(undefined); d.reload(); onSaved() } catch (e) { notify('err', (e as Error).message) } finally { setBusy(false) } }}>Save</button></div>}</div>
}
function AgentCreate({ onClose, onDone }: { onClose: () => void; onDone: (file: string) => void }) {
  const { notify } = useUi(); const [f, setF] = useState({ name: '', description: '', prompt: '', tools: '', model: '', scope: 'user', project: '' }); const projects = useCall<A[]>('projects:list'); const up = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }))
  return <Modal title="New agent" onClose={onClose} footer={<button className="primary" disabled={!f.name || !f.description || !f.prompt} onClick={async () => { try { onDone(await call<string>('agents:create', { scope: f.scope, project: f.scope === 'project' ? f.project : undefined, name: f.name, description: f.description, prompt: f.prompt, tools: f.tools || undefined, model: f.model || undefined })) } catch (e) { notify('err', (e as Error).message) } }}>Create</button>}>
    <label className="field">Name (lowercase-hyphen)<input autoFocus value={f.name} onChange={(e) => up('name', e.target.value)} aria-label="Agent name" /></label>
    <label className="field">Description (when should Claude delegate to it?)<input value={f.description} onChange={(e) => up('description', e.target.value)} aria-label="Agent description" /></label>
    <div className="row2"><label className="field">Tools (comma-separated, optional)<input value={f.tools} onChange={(e) => up('tools', e.target.value)} /></label><label className="field">Model (optional)<input value={f.model} onChange={(e) => up('model', e.target.value)} /></label></div>
    <div className="row2"><label className="field">Scope<select value={f.scope} onChange={(e) => up('scope', e.target.value)}><option value="user">User</option><option value="project">Project</option></select></label>{f.scope === 'project' && <label className="field">Project<select value={f.project} onChange={(e) => up('project', e.target.value)}><option value="">Choose…</option>{(projects.data ?? []).map((p) => <option key={p.path}>{p.path}</option>)}</select></label>}</div>
    <label className="field">System prompt<textarea rows={8} value={f.prompt} onChange={(e) => up('prompt', e.target.value)} aria-label="Agent prompt" /></label></Modal>
}
