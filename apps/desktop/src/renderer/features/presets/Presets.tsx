import { useState } from 'react'
import { type Go } from '../../app/nav'
import { type Target, TargetPicker } from '../install/TargetPicker'
import { PlanList } from './PlanList'
import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, Modal, useUi } from '../../shared/ui'

export function Presets({}: { go: Go }) {
  const { notify, confirm } = useUi(); const l = useCall<A[]>('presets:list'); const [target, setTarget] = useState<Target>({ scope: 'user' }); const [review, setReview] = useState<A>(); const [creating, setCreating] = useState(false); const [busy, setBusy] = useState<string>()
  const apply = async (p: A) => { setBusy(p.id); try { setReview(await call('presets:plan', { id: p.id, target })) } catch (e) { notify('err', (e as Error).message) } finally { setBusy(undefined) } }
  return <div className="page"><h1>Presets</h1><p className="note">A preset is a reviewed bundle of skills. Applying one downloads each item to staging and shows a plan; you approve every install. Built-in presets only reference skills verified to exist in <code>anthropics/skills</code>.</p>
    <div className="toolbar"><TargetPicker value={target} onChange={setTarget} /><button onClick={() => setCreating(true)}>New preset</button></div>
    <Async r={l}>{(rows) => <div className="grid wide">{rows.map((p) => <div key={p.id} className="tile static"><b>{p.name}</b> {p.builtin ? <Badge>built-in</Badge> : <Badge kind="accent">custom</Badge>}<span className="desc">{p.description}</span><span className="note">{p.items.map((i: A) => i.label).join(', ')}</span><div className="actions"><button className="primary" disabled={busy === p.id} onClick={() => apply(p)}>{busy === p.id ? 'Staging…' : 'Review plan'}</button>{!p.builtin && <button className="danger" onClick={async () => { if (await confirm({ title: `Delete preset ${p.name}?`, danger: true, confirmLabel: 'Delete', body: <p>Only the preset definition is deleted, not installed skills.</p> })) { await call('presets:delete', { id: p.id }); l.reload() } }}>Delete</button>}</div></div>)}</div>}</Async>
    {review && <PlanList plans={review.plans} errors={review.errors} onClose={() => setReview(undefined)} onDone={() => {}} />}
    {creating && <NewPreset onClose={() => setCreating(false)} onSaved={() => { setCreating(false); l.reload() }} />}</div>
}
function NewPreset({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useUi(); const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [items, setItems] = useState('')
  const save = async () => {
    try {
      const parsed = items.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => { const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\/(?:tree\/[^/]+\/)?(.*))?$/.exec(s); if (!m) throw new Error(`Bad item: ${s}`); return { label: (m[3] || m[2]!).split('/').pop()!, source: { owner: m[1]!, repo: m[2]!, path: (m[3] ?? '').replace(/\/$/, '') } } })
      await call('presets:save', { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) || 'preset', name, description: desc, items: parsed }); notify('ok', 'Preset saved'); onSaved()
    } catch (e) { notify('err', (e as Error).message) }
  }
  return <Modal title="New preset" onClose={onClose} footer={<button className="primary" disabled={!name || !items.trim()} onClick={save}>Save</button>}>
    <label className="field">Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Preset name" /></label><label className="field">Description<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
    <label className="field">Skills, one per line: owner/repo/path/to/skill<textarea rows={6} value={items} onChange={(e) => setItems(e.target.value)} aria-label="Preset items" placeholder={'anthropics/skills/skills/pdf\nanthropics/skills/skills/docx'} /></label></Modal>
}
