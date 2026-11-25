import { useEffect, useState } from 'react'
import { type Go } from '../../app/nav'
import { type Target, TargetPicker } from '../install/TargetPicker'
import { type A, call, useCall } from '../../shared/api'
import { Badge, DiffView, Md, Spinner, Tabs, useUi } from '../../shared/ui'

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const EMPTY = { name: '', description: '', purpose: '', triggers: '', instructions: '', workflows: '', dependencies: '', exampleInputs: '', expectedOutputs: '' }

export function Studio({ arg }: { go: Go; arg?: A }) {
  const { notify } = useUi(); const templates = useCall<A[]>('studio:templates')
  const [files, setFiles] = useState<Record<string, string> | null>(null); const [deleted, setDeleted] = useState<string[]>([]); const [base, setBase] = useState<Record<string, string>>({}); const [cur, setCur] = useState('SKILL.md')
  const [dirName, setDirName] = useState(''); const [target, setTarget] = useState<Target>({ scope: 'user' }); const [existing, setExisting] = useState(false)
  const [w, setW] = useState(EMPTY); const [tpl, setTpl] = useState('')
  useEffect(() => { if (arg?.editId) call<A>('studio:load', { id: arg.editId }).then((r) => { setFiles(r.files); setBase(r.files); setDirName(r.name); setTarget(r.scope === 'project' ? { scope: 'project', project: r.project } : { scope: 'user' }); setExisting(true); setCur('SKILL.md') }).catch((e: Error) => notify('err', e.message)) }, [arg]) // eslint-disable-line

  if (!files) {
    const gen = async () => { try { const f: Record<string, string> = await call('studio:generate', { name: w.name, description: w.description, purpose: w.purpose || undefined, triggers: w.triggers || undefined, instructions: w.instructions, workflows: lines(w.workflows), dependencies: lines(w.dependencies), exampleInputs: lines(w.exampleInputs), expectedOutputs: lines(w.expectedOutputs) }); setFiles(f); setBase({}); setDirName(w.name); setExisting(false) } catch (e) { notify('err', (e as Error).message) } }
    const up = (k: string, v: string) => setW((o) => ({ ...o, [k]: v }))
    return <div className="page"><h1>Skill Studio</h1><p className="note">Build a skill visually. Nothing is saved or executed until you choose to. Edit an existing user/project skill from My Skills → Edit in Studio.</p>
      <div className="two"><section><h2>New skill wizard</h2>
        <label className="field">Start from a template<select value={tpl} aria-label="Template" onChange={(e) => { setTpl(e.target.value); const t = templates.data?.find((x) => x.id === e.target.value); if (t) setW((o) => ({ ...o, description: t.description, instructions: t.instructions })) }}><option value="">Blank</option>{(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <label className="field">Name (lowercase-hyphen)<input value={w.name} onChange={(e) => up('name', e.target.value)} aria-label="Skill name" placeholder="my-skill" /></label>
        <label className="field">Description (what it does)<textarea rows={2} value={w.description} onChange={(e) => up('description', e.target.value)} aria-label="Skill description" /></label>
        <label className="field">Trigger conditions (“Use when …”)<input value={w.triggers} onChange={(e) => up('triggers', e.target.value)} placeholder="the user asks to …" /></label>
        <label className="field">Purpose<input value={w.purpose} onChange={(e) => up('purpose', e.target.value)} /></label>
        <label className="field">Instructions (Markdown)<textarea rows={8} value={w.instructions} onChange={(e) => up('instructions', e.target.value)} aria-label="Skill instructions" /></label>
        <div className="row2"><label className="field">Workflows (one per line)<textarea rows={3} value={w.workflows} onChange={(e) => up('workflows', e.target.value)} /></label><label className="field">Required dependencies (one per line)<textarea rows={3} value={w.dependencies} onChange={(e) => up('dependencies', e.target.value)} /></label></div>
        <div className="row2"><label className="field">Example inputs<textarea rows={3} value={w.exampleInputs} onChange={(e) => up('exampleInputs', e.target.value)} /></label><label className="field">Expected outputs<textarea rows={3} value={w.expectedOutputs} onChange={(e) => up('expectedOutputs', e.target.value)} /></label></div>
        <button className="primary" disabled={!w.name || !w.description || !w.instructions} onClick={gen}>Generate skill files</button></section>
        <section><h2>Templates</h2><ul>{(templates.data ?? []).map((t) => <li key={t.id}><b>{t.label}</b><div className="note">{t.description}</div></li>)}</ul></section></div></div>
  }
  return <Editor deleted={deleted} setDeleted={setDeleted} files={files} setFiles={setFiles} base={base} cur={cur} setCur={setCur} dirName={dirName} setDirName={setDirName} target={target} setTarget={setTarget} existing={existing} onClose={() => { setFiles(null); setExisting(false) }} onSaved={(f) => { setBase(f); setExisting(true) }} />
}

function Editor(p: { deleted: string[]; setDeleted: (d: string[]) => void; files: Record<string, string>; setFiles: (f: Record<string, string>) => void; base: Record<string, string>; cur: string; setCur: (s: string) => void; dirName: string; setDirName: (s: string) => void; target: Target; setTarget: (t: Target) => void; existing: boolean; onClose: () => void; onSaved: (f: Record<string, string>) => void }) {
  const { notify, confirm } = useUi(); const [tab, setTab] = useState('Preview'); const [issues, setIssues] = useState<A[]>([]); const [diff, setDiff] = useState('')
  const text = p.files[p.cur] ?? ''
  useEffect(() => { const t = setTimeout(() => { call<A[]>('studio:validate', { files: p.files }).then(setIssues).catch(() => {}) }, 300); return () => clearTimeout(t) }, [p.files])
  useEffect(() => { if (tab === 'Diff') call<string>('studio:diff', { name: p.cur, before: p.base[p.cur] ?? '', after: text }).then(setDiff).catch(() => {}) }, [tab, p.cur, text, p.base])
  const save = async () => {
    let overwrite = p.existing
    if (overwrite && !(await confirm({ title: `Overwrite ${p.dirName}?`, confirmLabel: 'Save', body: <p>Replaces the files of the existing skill. A backup is created first. Changes are shown in the Diff tab.</p> }))) return
    try { await call('studio:save', { target: p.target, dirName: p.dirName, files: p.files, overwrite, deleted: p.deleted }); notify('ok', `Saved ${p.dirName} (backup kept; verified discoverable)`); p.setDeleted([]); p.onSaved(p.files) }
    catch (e) { const m = (e as Error).message; if (/already exists/.test(m) && await confirm({ title: 'A skill with this name exists', confirmLabel: 'Overwrite', danger: true, body: <p>{m} Overwriting keeps a backup.</p> })) { try { await call('studio:save', { target: p.target, dirName: p.dirName, files: p.files, overwrite: true, deleted: p.deleted }); notify('ok', 'Saved'); p.onSaved(p.files) } catch (e2) { notify('err', (e2 as Error).message) } } else notify('err', m) }
  }
  const [adding, setAdding] = useState<string | null>(null)
  const addFile = () => { const n = (adding ?? '').trim(); if (/^[\w./-]+$/.test(n) && !n.includes('..') && !n.startsWith('/') && !(n in p.files)) { p.setFiles({ ...p.files, [n]: '' }); p.setCur(n); setAdding(null) } else notify('err', 'Use a relative path like references/guide.md (letters, digits, . _ - /)') }
  const errs = issues.filter((i) => i.level === 'error').length
  return <div className="studio">
    <div className="toolbar wrap"><button onClick={p.onClose}>← New / open</button><label>Folder<input value={p.dirName} onChange={(e) => p.setDirName(e.target.value)} aria-label="Skill folder name" disabled={p.existing} className="w180" /></label><TargetPicker value={p.target} onChange={p.setTarget} />
      <button className="primary" disabled={errs > 0 || !p.dirName} onClick={save} title={errs ? 'Fix validation errors first' : ''}>Save to Claude</button>
      <button onClick={async () => { try { const r = await call<string | null>('studio:export', { name: p.dirName, files: p.files }); if (r) notify('ok', `Exported to ${r}`) } catch (e) { notify('err', (e as Error).message) } }}>Export…</button></div>
    <div className="studio-grid">
      <aside><b>Files</b><ul className="files">{Object.keys(p.files).sort().map((f) => <li key={f}><button className={f === p.cur ? 'link active' : 'link'} onClick={() => p.setCur(f)}>{f}</button>{f !== 'SKILL.md' && <button className="icon" aria-label={`Delete ${f}`} onClick={() => { const { [f]: _, ...rest } = p.files; p.setFiles(rest); p.setDeleted([...p.deleted, f]); p.setCur('SKILL.md') }}><span aria-hidden="true">✕</span></button>}</li>)}</ul>{adding === null ? <button onClick={() => setAdding('')}>+ Add file</button> : <div><input autoFocus aria-label="New file path" placeholder="references/guide.md" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addFile()} /><button onClick={addFile}>Add</button></div>}</aside>
      <section><textarea className="code" aria-label={`Editing ${p.cur}`} value={text} spellCheck={false} onChange={(e) => p.setFiles({ ...p.files, [p.cur]: e.target.value })} /></section>
      <section className="side"><Tabs tabs={['Preview', 'Validation', 'Diff', 'Tests']} value={tab} onChange={setTab} />
        {tab === 'Preview' && <Preview text={text} name={p.cur} />}
        {tab === 'Validation' && <div><p className="note">Static validation only: no Claude, no network.</p>{issues.length === 0 ? <p><Badge kind="ok">No issues</Badge></p> : <ul className="findings">{issues.map((i, n) => <li key={n}><Badge kind={i.level === 'error' ? 'bad' : i.level === 'warning' ? 'warn' : 'neutral'}>{i.level}</Badge> {i.message} {i.file && <code>{i.file}</code>}</li>)}</ul>}</div>}
        {tab === 'Diff' && <div><p className="note">Current file vs last saved/generated version.</p><DiffView diff={diff || ' '} /></div>}
        {tab === 'Tests' && <Tests files={p.files} skillKey={`studio:${p.target.scope}:${p.dirName}`} />}
      </section></div></div>
}

function Preview({ text, name }: { text: string; name: string }) {
  if (!name.endsWith('.md')) return <pre>{text}</pre>
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  return <div>{m && <pre className="fm">{m[1]}</pre>}<Md text={m ? m[2]! : text} /></div>
}

function Tests({ files, skillKey }: { files: Record<string, string>; skillKey: string }) {
  const { notify, confirm } = useUi(); const [cases, setCases] = useState<A[]>([]); const [res, setRes] = useState<A[]>([]); const [out, setOut] = useState<A>(); const [busy, setBusy] = useState(false)
  useEffect(() => { call<A[]>('studio:cases', { skillId: skillKey }).then(setCases).catch(() => {}) }, [skillKey])
  const persist = (c: A[]) => { setCases(c); void call('studio:setCases', { skillId: skillKey, cases: c }).catch((e: Error) => notify('err', e.message)) }
  const upd = (i: number, k: string, v: unknown) => persist(cases.map((c, n) => (n === i ? { ...c, [k]: v } : c)))
  const runClaude = async (c: A) => {
    if (!(await confirm({ title: 'Run this prompt with real Claude?', confirmLabel: 'Run (uses my usage)', body: <><p>This is <b>actual Claude execution</b> through your own <code>claude</code> login. It uses your plan/API usage (typically one short turn, up to 3 agent turns; cost is shown afterwards).</p><p>Prompt: <i>{c.prompt}</i></p><p className="note">The skill must already be saved to ~/.claude/skills for Claude to see it.</p></> }))) return
    setBusy(true); setOut(undefined); try { setOut(await call('studio:runClaude', { prompt: c.prompt, approved: true })) } catch (e) { notify('err', (e as Error).message) } finally { setBusy(false) }
  }
  return <div>
    <p className="note"><Badge kind="ok">static</Badge> checks the case definition. <Badge kind="warn">simulated</Badge> is a word-overlap heuristic, not Claude behavior. <Badge kind="accent">actual</Badge> runs real Claude (costs usage; always asks first).</p>
    {cases.map((c, i) => <div key={c.id} className="case"><label className="field">Input prompt<input value={c.prompt} onChange={(e) => upd(i, 'prompt', e.target.value)} aria-label="Test prompt" /></label><label className="field">Expected behavior<input value={c.expectedBehavior} onChange={(e) => upd(i, 'expectedBehavior', e.target.value)} /></label><label className="field">Expected output format<input value={c.expectedFormat ?? ''} onChange={(e) => upd(i, 'expectedFormat', e.target.value)} /></label><label className="field">Required tools (comma)<input value={(c.requiredTools ?? []).join(', ')} onChange={(e) => upd(i, 'requiredTools', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></label><label className="field">Evaluation criteria (comma)<input value={(c.criteria ?? []).join(', ')} onChange={(e) => upd(i, 'criteria', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></label>
      <button disabled={busy || !c.prompt} onClick={() => runClaude(c)}>Run with Claude…</button><button onClick={() => persist(cases.filter((_, n) => n !== i))}>Remove</button></div>)}
    <div className="actions"><button onClick={() => persist([...cases, { id: String(Date.now()), prompt: '', expectedBehavior: '' }])}>+ Add test case</button><button onClick={async () => setRes(await call('studio:evaluate', { files, cases }))}>Evaluate (static + simulated)</button></div>
    {res.map((r, i) => <p key={i}><Badge kind={r.ok ? 'ok' : 'warn'}>{r.level}</Badge> {r.notes.join(' ')}</p>)}
    {busy && <Spinner label="Running Claude…" />}{out && <div className="diag"><h4>Actual Claude result {out.costUsd !== undefined && <small>cost ${out.costUsd.toFixed(4)}</small>}</h4><pre>{out.result}</pre></div>}
  </div>
}
