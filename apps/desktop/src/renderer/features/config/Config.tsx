import { useEffect, useState } from 'react'
import { type Go } from '../../app/nav'
import { Inheritance } from '../projects/Inheritance'
import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, DiffView, Empty, Modal, Spinner, Tabs, useUi , ResizeHandle } from '../../shared/ui'

export function Config({ arg }: { go: Go; arg?: A }) {
  const { notify } = useUi(); const files = useCall<A[]>('config:files'); const [sel, setSel] = useState<string | undefined>(arg?.select); const [tab, setTab] = useState('Files')
  return <div className="page"><h1>Configuration</h1><Tabs tabs={['Files', 'Inheritance']} value={tab} onChange={setTab} />
    {tab === 'Inheritance' ? <Inheritance /> : <div className="split"><ResizeHandle cssVar="--list-w" storageKey="skilldock.listw" label="Resize list and detail panels" min={260} max={900} /><section className="listpane"><Async r={files}>{(rows) => <ul className="plist">{rows.map((f) => <li key={f.id}><button className={f.id === sel ? 'link active' : 'link'} onClick={() => setSel(f.id)}>{f.label}</button> <Badge kind={f.scope === 'managed' ? 'warn' : 'accent'}>{f.scope}</Badge> {!f.exists && <Badge>not created</Badge>}<div className="note trunc">{f.path}</div></li>)}</ul>}</Async></section>
      <section className="detailpane">{sel ? <FileEditor id={sel} key={sel} onSaved={() => { files.reload(); notify('ok', 'Saved (backup kept)') }} /> : <Empty>Pick a file. Unknown keys are always preserved; a backup is made before every save; saves are refused if the file changed on disk meanwhile.</Empty>}</section></div>}</div>
}
function FileEditor({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { notify } = useUi(); const d = useCall<A>('config:read', { id }); const [text, setText] = useState<string>(); const [diff, setDiff] = useState<A>(); const [busy, setBusy] = useState(false)
  useEffect(() => { setText(undefined) }, [d.data?.hash])
  if (d.error) return <p className="empty">{d.error}</p>; if (!d.data) return <Spinner />
  const { file, hash } = d.data, cur = text ?? d.data.text, dirty = text !== undefined && text !== d.data.text
  const preview = async () => setDiff(await call('config:preview', { id, text: cur }))
  const save = async () => { setBusy(true); try { await call('config:save', { id, text: cur, hash }); setDiff(undefined); onSaved(); d.reload() } catch (e) { notify('err', (e as Error).message) } finally { setBusy(false) } }
  return <div><div className="dhead"><h2>{file.label}</h2>{file.readOnly ? <Badge kind="warn">read-only (managed)</Badge> : <Badge kind="accent">{file.scope}</Badge>}</div><p className="note">{file.path}</p>
    {d.data.error && <p className="warn">⚠ Not valid JSON: {d.data.error}. Fix it here or externally; saves require valid JSON.</p>}
    <textarea className="code" rows={24} value={cur} readOnly={file.readOnly} spellCheck={false} aria-label="File contents" onChange={(e) => setText(e.target.value)} />
    {!file.readOnly && <div className="actions"><button disabled={!dirty} onClick={preview}>Review changes</button><button onClick={() => { d.reload(); setText(undefined) }}>Reload from disk</button></div>}
    {diff && <Modal wide title="Review changes before saving" onClose={() => setDiff(undefined)} footer={<><button onClick={() => setDiff(undefined)}>Cancel</button><button className="primary" disabled={busy || !!diff.error} onClick={save}>{busy ? 'Saving…' : 'Save with backup'}</button></>}>{diff.error ? <p className="warn">Invalid JSON: {diff.error}</p> : <DiffView diff={diff.diff} />}</Modal>}</div>
}
