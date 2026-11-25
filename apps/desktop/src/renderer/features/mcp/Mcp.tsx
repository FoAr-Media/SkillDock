import { useEffect, useState } from 'react'
import { type Go } from '../../app/nav'

import { ConfigHealth } from '../config/ConfigHealth'


import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, Empty, EmptyState, Modal, copy, useUi , ResizeHandle } from '../../shared/ui'

const MASK = '••••••••'
type Draft = { name: string; scope: string; project?: string; transport: 'stdio' | 'http'; command: string; args: string; url: string; env: string; headers: string; originalName?: string; expectedHash?: string }
const kv = (t: string, mask = false) => Object.fromEntries(t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1)] }))
const toKv = (o?: Record<string, string>) => Object.entries(o ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')
function toConfig(d: Draft) {
  const c: A = d.transport === 'http' ? { type: 'http', url: d.url } : { command: d.command, ...(d.args.trim() ? { args: d.args.split('\n').map((s) => s).filter((s) => s !== '') } : {}) }
  const env = kv(d.env), headers = kv(d.headers)
  if (Object.keys(env).length) c.env = env; if (Object.keys(headers).length) c.headers = headers
  return c
}
const draftFrom = (s: A): Draft => ({ name: s.name, originalName: s.name, scope: s.scope, project: s.project, transport: s.transport === 'stdio' ? 'stdio' : 'http', command: s.config.command ?? '', args: (s.config.args ?? []).join('\n'), url: s.config.url ?? '', env: toKv(s.config.env), headers: toKv(s.config.headers), expectedHash: s.fileHash })

export function McpPage({ go, arg }: { go: Go; arg?: A }) {
  const { notify, confirm } = useUi(); const list = useCall<A[]>('mcp:list'); const [sel, setSel] = useState<string>(); const [edit, setEdit] = useState<Draft | null>(null); const [imp, setImp] = useState(false)
  const [diag, setDiag] = useState<A>(); const [testing, setTesting] = useState(false)
  useEffect(() => {
    if (arg?.draft) setEdit({ name: arg.draft.name, scope: 'user', transport: arg.draft.config.type === 'http' ? 'http' : 'stdio', command: arg.draft.config.command ?? '', args: (arg.draft.config.args ?? []).join('\n'), url: arg.draft.config.url ?? '', env: toKv(arg.draft.config.env), headers: toKv(arg.draft.config.headers) })
    else if (arg?.add) setEdit({ name: '', scope: 'user', transport: 'stdio', command: '', args: '', url: '', env: '', headers: '' })
  }, [arg])
  const key = (s: A) => `${s.scope}|${s.project ?? ''}|${s.name}`
  const s = list.data?.find((x) => key(x) === sel)
  const ref = (x: A) => ({ scope: x.scope, project: x.project, name: x.name })

  const test = async () => {
    if (!s) return
    const ok = await confirm({ title: `Start and test “${s.name}”?`, confirmLabel: 'Start & test', body: <><p>This will {s.transport === 'stdio' ? <>run <code>{s.command} {s.args.join(' ')}</code> on this computer</> : <>connect to <code>{s.url}</code></>}, perform the MCP handshake and <b>list</b> its tools, resources and prompts.</p><p><b>No tool will be called.</b> Only start servers you trust.</p></> })
    if (!ok) return
    setTesting(true); setDiag(undefined)
    try { setDiag(await call('mcp:test', { ...ref(s), approved: true })) } catch (e) { notify('err', (e as Error).message) } finally { setTesting(false) }
  }
  const del = async () => { if (!s || !(await confirm({ title: `Delete ${s.name}?`, danger: true, confirmLabel: 'Delete', body: <p>Removes it from <code>{s.file}</code> ({s.scope} scope). A backup is created first and can be restored.</p> }))) return; try { await call('mcp:delete', { ...ref(s), expectedHash: s.fileHash }); notify('ok', 'Deleted (backup kept)'); setSel(undefined); list.reload() } catch (e) { notify('err', (e as Error).message) } }
  const exp = async () => { if (!s) return; const j = await call('mcp:export', ref(s)); void copy(JSON.stringify(j, null, 2), notify) }
  const copyTo = async (scope: string) => { if (!s) return; try { await call('mcp:copy', { from: ref(s), to: { scope, project: s.project } }); notify('ok', `Copied to ${scope} scope`); list.reload() } catch (e) { notify('err', (e as Error).message) } }

  return (
    <div className="split"><ResizeHandle cssVar="--list-w" storageKey="skilldock.listw" label="Resize list and detail panels" min={260} max={900} /><h1 className="sr">MCP Servers</h1>
      <section className="listpane">
        <ConfigHealth />
        <div className="toolbar"><button className="primary" onClick={() => setEdit({ name: '', scope: 'user', transport: 'stdio', command: '', args: '', url: '', env: '', headers: '' })}>Add server</button><button onClick={() => setImp(true)}>Import JSON</button><button onClick={() => go('marketplace')}>Browse registry</button></div>
        <Async r={list} empty={<EmptyState art="mcp" title="No MCP servers connected">None are configured in the user, local, project or managed scopes. Add one, or find servers in the Marketplace.</EmptyState>}>{(rows) => (
          <table className="table"><thead><tr><th>Name</th><th>Scope</th><th>State</th><th>Transport</th><th>Target</th></tr></thead><tbody>
            {rows.map((r) => <tr key={key(r)} className={key(r) === sel ? 'active' : ''} tabIndex={0} onClick={() => { setSel(key(r)); setDiag(undefined) }} onKeyDown={(e) => e.key === 'Enter' && setSel(key(r))}><td><b>{r.name}</b></td><td><Badge kind={r.scope === 'managed' ? 'warn' : 'accent'}>{r.scope}</Badge></td><td><StateBadge s={r.state} /></td><td>{r.transport}</td><td className="trunc">{r.url ?? `${r.command ?? ''} ${r.args.join(' ')}`}</td></tr>)}
          </tbody></table>
        )}</Async>
      </section>
      <section className="detailpane">
        {!s ? <Empty>Select a server to inspect, test or edit it.</Empty> : (
          <div>
            <div className="dhead"><h2>{s.name}</h2><Badge kind="accent">{s.scope}</Badge></div>
            <StateDetail s={s.state} />
            <dl><dt>Transport</dt><dd>{s.transport}</dd>{s.command && (<><dt>Executable</dt><dd>{s.command}</dd><dt>Arguments</dt><dd>{s.args.join(' ') || '—'}</dd></>)}{s.url && (<><dt>URL</dt><dd>{s.url}</dd></>)}
              <dt>Environment variables</dt><dd>{s.envKeys.length ? s.envKeys.map((k: string) => <div key={k}><code>{k}</code> = {MASK}</div>) : '—'}</dd>
              <dt>Headers</dt><dd>{s.headerKeys.length ? s.headerKeys.map((k: string) => <div key={k}><code>{k}</code> = {MASK}</div>) : '—'}</dd>
              <dt>Config file</dt><dd>{s.file}{s.project && <><br />project: {s.project}</>}</dd></dl>
            <p className="note">Secret values are masked here and never sent to the interface. Claude requires them in its own config file; this app stores them nowhere else.</p>
            <div className="actions">
              <button className="primary" disabled={testing} onClick={test}>{testing ? 'Testing…' : 'Test connection…'}</button>
              {!s.readOnly && <button onClick={() => setEdit(draftFrom(s))}>Edit</button>}
              <button onClick={exp}>Export (no secrets)</button>
              {!s.readOnly && s.scope !== 'user' && <button onClick={() => copyTo('user')}>Copy to user scope</button>}
              {!s.readOnly && s.project && s.scope !== 'project' && <button onClick={() => copyTo('project')}>Copy to project (.mcp.json)</button>}
              {!s.readOnly && <button className="danger" onClick={del}>Delete</button>}
            </div>
            {s.readOnly && <p className="note">Managed by your organization/system: read-only.</p>}
            {diag && <Diagnostics d={diag} />}
          </div>
        )}
      </section>
      {edit && <Wizard d={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload() }} />}
      {imp && <ImportJson onClose={() => setImp(false)} onDone={() => { setImp(false); list.reload() }} />}
    </div>
  )
}

function Diagnostics({ d }: { d: A }) {
  const row = (ok: boolean | undefined, label: string, detail?: string) => <li><span className={ok === undefined ? 'st na' : ok ? 'st ok' : 'st bad'}>{ok === undefined ? '–' : ok ? '✓' : '✗'}</span> {label}{detail && <small> — {detail}</small>}</li>
  return (
    <div className="diag"><h4>Diagnostic result <small>{new Date(d.ranAt).toLocaleTimeString()}</small></h4>
      <ul>{row(d.configValid, 'Configuration valid')}{row(d.dependency.ok, 'Dependency available', d.dependency.detail || 'n/a for HTTP')}{row(d.reachable, 'Server reachable')}{row(d.handshake, 'Protocol handshake', d.serverInfo ? `${d.serverInfo.name} ${d.serverInfo.version ?? ''}` : undefined)}{row(d.authRequired === undefined ? undefined : !d.authRequired, 'Authentication', d.authRequired ? 'required / rejected' : undefined)}{row(d.handshake ? d.tools.length > 0 : undefined, `Tools discovered (${d.tools.length})`)}</ul>
      {d.error && <p className="warn">Error: {d.error}</p>}
      {d.tools.length > 0 && <><b>Tools</b><ul>{d.tools.map((t: A) => <li key={t.name}><code>{t.name}</code> {t.description}</li>)}</ul></>}
      {d.resources.length > 0 && <p><b>Resources:</b> {d.resources.join(', ')}</p>}{d.prompts.length > 0 && <p><b>Prompts:</b> {d.prompts.join(', ')}</p>}
      {d.logs.length > 0 && <><b>Sanitized logs</b><pre>{d.logs.join('\n')}</pre></>}
      <p className="note"><b>Claude runtime status: unknown.</b> This independent test does not prove that Claude has loaded this server.</p>
    </div>
  )
}

function Wizard({ d: init, onClose, onSaved }: { d: Draft; onClose: () => void; onSaved: () => void }) {
  const { notify, confirm } = useUi(); const [d, setD] = useState(init); const projects = useCall<A[]>('projects:list'); const [step, setStep] = useState<'form' | 'review'>('form'); const [diag, setDiag] = useState<A>(); const [busy, setBusy] = useState(false)
  const up = (k: keyof Draft, v: string) => setD((o) => ({ ...o, [k]: v })); const cfg = toConfig(d)
  const needsProject = d.scope === 'local' || d.scope === 'project'
  const valid = /^[A-Za-z0-9][\w.-]{0,63}$/.test(d.name) && (d.transport === 'stdio' ? !!d.command.trim() : /^https?:\/\//.test(d.url)) && (!needsProject || d.project)
  const testDraft = async () => {
    if (!(await confirm({ title: 'Start this server to test it?', confirmLabel: 'Start & test', body: <p>This runs/connects to the configuration in the form, lists tools only, and never calls them. Only continue if you trust it.</p> }))) return
    setBusy(true); try { setDiag(await call('mcp:testDraft', { config: cfg, approved: true })) } catch (e) { notify('err', (e as Error).message) } finally { setBusy(false) }
  }
  const save = async () => { setBusy(true); try { await call('mcp:save', { scope: d.scope, project: d.project, name: d.name, originalName: d.originalName, config: cfg, expectedHash: d.expectedHash }); notify('ok', `Saved ${d.name} (backup kept)`); onSaved() } catch (e) { notify('err', (e as Error).message); setBusy(false) } }
  const file = d.scope === 'user' ? '~/.claude.json (mcpServers)' : d.scope === 'local' ? `~/.claude.json (projects → ${d.project ?? '…'})` : `${d.project ?? '…'}/.mcp.json`
  return (
    <Modal wide title={d.originalName ? `Edit ${d.originalName}` : 'Add MCP server'} onClose={onClose} footer={step === 'form' ? <><button disabled={!valid || busy} onClick={testDraft}>Test…</button><button className="primary" disabled={!valid} onClick={() => setStep('review')}>Review</button></> : <><button onClick={() => setStep('form')}>Back</button><button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save (with backup)'}</button></>}>
      {step === 'form' ? <>
        <label className="field">Name<input autoFocus value={d.name} onChange={(e) => up('name', e.target.value)} aria-label="Server name" /></label>
        <div className="row2"><label className="field">Transport<select value={d.transport} onChange={(e) => up('transport', e.target.value)} aria-label="Transport"><option value="stdio">stdio (local command)</option><option value="http">Streamable HTTP (remote URL)</option></select></label>
          <label className="field">Scope<select value={d.scope} onChange={(e) => up('scope', e.target.value)} aria-label="Scope"><option value="user">User (all projects)</option><option value="local">Local (this project, private)</option><option value="project">Project (.mcp.json, shared)</option></select></label></div>
        {needsProject && <label className="field">Project<select value={d.project ?? ''} onChange={(e) => up('project', e.target.value)} aria-label="Project"><option value="">Choose…</option>{(projects.data ?? []).map((p) => <option key={p.path}>{p.path}</option>)}</select></label>}
        {d.transport === 'stdio' ? <><label className="field">Command<input value={d.command} onChange={(e) => up('command', e.target.value)} placeholder="npx" aria-label="Command" /></label><label className="field">Arguments (one per line)<textarea rows={3} value={d.args} onChange={(e) => up('args', e.target.value)} aria-label="Arguments" /></label></>
          : <label className="field">URL<input value={d.url} onChange={(e) => up('url', e.target.value)} placeholder="https://example.com/mcp" aria-label="URL" /></label>}
        <label className="field">Environment variables (KEY=value per line; {MASK} keeps the stored value)<textarea rows={3} value={d.env} onChange={(e) => up('env', e.target.value)} aria-label="Environment variables" /></label>
        {d.transport === 'http' && <label className="field">Headers / authentication (Header=value per line, e.g. Authorization=Bearer …)<textarea rows={2} value={d.headers} onChange={(e) => up('headers', e.target.value)} aria-label="Headers" /></label>}
        <p className="note">Claude Code reads secrets from its own config file, so values are written there (the safest officially supported place). They are masked everywhere in this app, and exports replace them with placeholders.</p>
        {diag && <Diagnostics d={diag} />}
      </> : <>
        <p>Will write to <code>{file}</code>. A backup is made first; unrelated keys are preserved; the write is refused if the file changed since you opened it.</p>
        <pre>{JSON.stringify({ [d.name]: { ...cfg, env: cfg.env && Object.fromEntries(Object.keys(cfg.env).map((k) => [k, MASK])), headers: cfg.headers && Object.fromEntries(Object.keys(cfg.headers).map((k) => [k, MASK])) } }, null, 2)}</pre>
      </>}
    </Modal>
  )
}

function ImportJson({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useUi(); const [t, setT] = useState(''); const [scope, setScope] = useState('user'); const [project, setProject] = useState(''); const projects = useCall<A[]>('projects:list')
  return <Modal title="Import MCP configuration" onClose={onClose} footer={<button className="primary" disabled={!t.trim()} onClick={async () => { try { const n: string[] = await call('mcp:import', { json: t, scope, project: project || undefined }); notify('ok', `Imported ${n.join(', ')}`); onDone() } catch (e) { notify('err', (e as Error).message) } }}>Import</button>}>
    <p className="note">Paste a <code>{'{"mcpServers": {…}}'}</code> object (e.g. from a README or exported file).</p>
    <textarea rows={10} value={t} onChange={(e) => setT(e.target.value)} aria-label="MCP JSON" />
    <div className="row2"><label className="field">Scope<select value={scope} onChange={(e) => setScope(e.target.value)}><option value="user">User</option><option value="local">Local</option><option value="project">Project</option></select></label>
      {scope !== 'user' && <label className="field">Project<select value={project} onChange={(e) => setProject(e.target.value)}><option value="">Choose…</option>{(projects.data ?? []).map((p) => <option key={p.path}>{p.path}</option>)}</select></label>}</div>
  </Modal>
}

const KIND: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = { approved: 'ok', pending: 'warn', rejected: 'bad', disabled: 'warn', managed: 'neutral', 'not-required': 'neutral' }
const LABEL: Record<string, string> = { approved: 'approved', pending: 'pending approval', rejected: 'rejected', disabled: 'disabled here', managed: 'managed', 'not-required': 'no approval needed' }
function StateBadge({ s }: { s: A }) {
  return <span title={s.reason}><Badge kind={KIND[s.status]}>{LABEL[s.status]}</Badge>{s.shadowedBy && <Badge kind="warn" title={`The ${s.shadowedBy}-scope server with this name takes precedence`}>overridden</Badge>}{s.shadowedInProjects?.length > 0 && <Badge kind="warn" title="Overridden by a local/project server of the same name in some projects">overridden in {s.shadowedInProjects.length}</Badge>}</span>
}
function StateDetail({ s }: { s: A }) {
  return (
    <div className={s.status === 'pending' || s.status === 'rejected' ? 'errorbox' : 'note'}>
      <b>Configuration state: </b><StateBadge s={s} /> {s.reason}
      {s.observedOnly && <div className="note">Decision found only in per-project arrays observed in ~/.claude.json; current docs describe settings files instead.</div>}
      {s.shadowedBy && <div>Another server with this name in <b>{s.shadowedBy}</b> scope takes precedence; entries are used whole, not merged.</div>}
      {s.shadowedInProjects?.length > 0 && <div>Overridden by a local/project server of the same name in: {s.shadowedInProjects.join(', ')}.</div>}
      {s.disabledInProjects?.length > 0 && <div>Disabled for: {s.disabledInProjects.join(', ')}.</div>}
      <div className="note">This reflects configuration files only. Whether Claude actually connected is unknown here; approvals are made in Claude Code itself (<code>claude</code>), never by this app.</div>
    </div>
  )
}
