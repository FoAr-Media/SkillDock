import { useEffect, useMemo, useState } from 'react'
import { type Go } from '../../app/nav'


import { PlanDialog } from '../install/PlanDialog'
import { type Target, TargetPicker } from '../install/TargetPicker'



import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, Empty, EmptyState, Modal, Spinner, Tabs, ago, copy, secKind, secLabel, useUi , ResizeHandle } from '../../shared/ui'

const TABS = ['Overview', 'How to use', 'Commands', 'Files', 'Dependencies', 'Configuration', 'Permissions', 'Security', 'Version history', 'Changelog', 'Compatibility']

export function MySkills({ go, arg }: { go: Go; arg?: A }) {
  const skills = useCall<A[]>('skills:list'); const [q, setQ] = useState(''); const [scope, setScope] = useState('all'); const [category, setCategory] = useState(''); const [view, setView] = useState<'grid' | 'table'>('grid'); const [sel, setSel] = useState<string | undefined>(arg?.select)
  const list = useMemo(() => (skills.data ?? []).filter((s) => (scope === 'all' || s.scope === scope || (scope === 'conflicts' && (s.nameStatus !== 'active' || s.nameConflicts.some((c: A) => c.kind === 'duplicate')))) && (!category || (s.categories ?? []).includes(category)) && `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase())), [skills.data, q, scope, category])
  const facets = useMemo(() => { const m = new Map<string, number>(); for (const s of skills.data ?? []) for (const c of s.categories ?? []) m.set(c, (m.get(c) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)) }, [skills.data])
  return (
    <div className="split"><ResizeHandle cssVar="--list-w" storageKey="skilldock.listw" label="Resize list and detail panels" min={260} max={900} /><h1 className="sr">My Skills</h1>
      <section className="listpane">
        <div className="toolbar">
          <input placeholder="Search skills…" aria-label="Search skills" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Filter by scope" value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">All sources</option><option value="user">User</option><option value="project">Project</option><option value="plugin">Plugin</option><option value="legacy-command">Legacy commands</option><option value="conflicts">Name conflicts only</option></select>
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{facets.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}</select>
          <div className="seg"><button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>Grid</button><button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button></div>
        </div>
        {facets.length > 0 && <div className="chips" aria-label="Category shortcuts">{facets.slice(0, 10).map(([c, n]) => <button key={c} className={category === c ? 'chip on' : 'chip'} aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}>{c} <small>{n}</small></button>)}</div>}
        <p className="note">{list.length} of {skills.data?.length ?? 0} shown</p>
        <Async r={skills} empty={<EmptyState art="skills" title="No skills yet">No skills were found in your Claude directories. <button className="link" onClick={() => go('marketplace')}>Browse the marketplace</button></EmptyState>}>{() => view === 'grid' ? (
          <div className="grid">{list.map((s) => (
            <button key={s.id} className={s.id === sel ? 'tile active' : 'tile'} onClick={() => setSel(s.id)}>
              <b>{s.name}</b><span className="desc">{s.description || <i>no description</i>}</span>
              <span className="meta"><Badge kind="accent">{s.scope}</Badge>{s.realPath && <Badge>link</Badge>}{!s.enabled && <Badge kind="warn">disabled</Badge>}{s.nameStatus === 'shadowed' && <Badge kind="warn" title="Another skill wins this name">shadowed</Badge>}{s.nameStatus === 'partial' && <Badge kind="warn">partly shadowed</Badge>}{s.nameStatus === 'reserved' && <Badge kind="bad">not loaded</Badge>}{s.updateAvailable && <Badge kind="ok">update</Badge>}{s.errors.length > 0 && <Badge kind="bad">invalid</Badge>}</span>
            </button>))}</div>
        ) : (
          <table className="table"><thead><tr><th>Name</th><th>Source</th><th>Category</th><th>Version</th><th>Modified</th><th>Security</th></tr></thead><tbody>
            {list.map((s) => <tr key={s.id} className={s.id === sel ? 'active' : ''} onClick={() => setSel(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(s.id)}><td><b>{s.name}</b> {s.nameStatus !== 'active' && <Badge kind={s.nameStatus === 'reserved' ? 'bad' : 'warn'}>{s.nameStatus}</Badge>}</td><td>{s.scope}{s.source ? ` · ${String(s.source).split('/').slice(-1)[0]}` : ''}</td><td>{(s.categories ?? []).join(", ") || "—"}</td><td>{s.version?.slice(0, 10) ?? '—'}</td><td>{ago(s.lastModified)}</td><td><Badge kind={secKind(s.security)}>{secLabel(s.security)}</Badge></td></tr>)}
          </tbody></table>
        )}</Async>
      </section>
      <section className="detailpane">{sel ? <Detail id={sel} key={sel} go={go} onChanged={() => { skills.reload() }} onGone={() => { setSel(undefined); skills.reload() }} /> : <Empty>Select a skill to inspect it.</Empty>}</section>
    </div>
  )
}

function Detail({ id, go, onChanged, onGone }: { id: string; go: Go; onChanged: () => void; onGone: () => void }) {
  const { notify, confirm } = useUi()
  const d = useCall<A>('skills:read', { id }); const all = useCall<A[]>('skills:list'); const backups = useCall<A[]>('backups:list')
  const [tab, setTab] = useState('Overview'); const [plan, setPlan] = useState<A>(); const [copyTo, setCopyTo] = useState<Target | null>(null)
  const s = all.data?.find((x) => x.id === id)
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); notify('ok', ok); onChanged(); all.reload(); backups.reload() } catch (e) { notify('err', (e as Error).message) } }
  if (d.error) return <p className="empty">{d.error}</p>
  if (!d.data || !s) return <Spinner />
  const { skill, raw, body, scan, fm } = d.data
  const managedPlugin = skill.scope === 'plugin', legacy = skill.scope === 'legacy-command'
  const editable = skill.scope === 'user' || skill.scope === 'project'
  const planTo = async (fn: () => Promise<A>) => { try { const p = await fn(); if (p) setPlan(p) } catch (e) { notify('err', (e as Error).message) } }
  const uninstall = async () => { if (await confirm({ title: `Uninstall ${skill.name}?`, danger: true, confirmLabel: 'Uninstall', body: <><p>Removes <code>{skill.dir}</code>{skill.realPath && <> (only the link; the target <code>{skill.realPath}</code> is kept)</>}.</p><p>A backup is created first and can be restored from Backups.</p></> })) act(() => call('skills:uninstall', { id }).then(onGone), 'Uninstalled (backup kept)') }
  const reinstall = () => planTo(() => call('install:planGithub', { repo: `${s.installSource.owner}/${s.installSource.repo}`, ref: s.version, path: s.installSource.path, target: { scope: s.scope, project: skill.source } }))
  const history = (backups.data ?? []).filter((b) => b.label.includes(skill.name))
  const headings = [...body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1])
  const fileList: string[] = skill.files
  return (
    <div>
      <div className="dhead"><h2>{skill.name}</h2><div>
        {s.enabled ? <Badge kind="ok">enabled</Badge> : <Badge kind="warn">disabled</Badge>}{' '}<Badge kind="accent">{skill.scope}</Badge>
      </div></div>
      <p>{skill.description}</p>
      <div className="actions">
        {editable && <button onClick={() => act(() => call('skills:setEnabled', { name: skill.name, enabled: !s.enabled }), s.enabled ? 'Disabled via Claude skillOverrides (reversible)' : 'Enabled')} title="Uses the skillOverrides setting in ~/.claude/settings.json">{s.enabled ? 'Disable' : 'Enable'}</button>}
        {s.installationId && <button onClick={() => planTo(() => call('updates:plan', { installationId: s.installationId }))}>Update / check diff</button>}
        {s.installationId && <button onClick={() => act(() => call('skills:setPinned', { installationId: s.installationId, pinned: !s.pinned }), s.pinned ? 'Unpinned' : 'Pinned to this version')}>{s.pinned ? 'Unpin version' : 'Pin version'}</button>}
        {s.installSource?.type === 'github' && <button onClick={reinstall}>Reinstall</button>}
        {editable && <button onClick={() => go('studio', { editId: id })}>Edit in Studio</button>}
        {!legacy && !managedPlugin && <button onClick={() => setCopyTo({ scope: 'user' })}>Copy / duplicate to…</button>}
        {!legacy && editable && <button onClick={() => act(() => call('skills:export', { id }).then((p) => { if (!p) throw new Error('Export cancelled'); return p }), 'Exported')}>Export</button>}
        <button onClick={() => call('skills:reveal', { id }).catch((e: Error) => notify('err', e.message))}>Open directory</button>
        {editable && <button className="danger" onClick={uninstall}>Uninstall</button>}
      </div>
      {managedPlugin && <p className="note">Provided by plugin <code>{skill.source}</code>. Manage it from Plugins; individual plugin skills can't be removed here.</p>}
      {skill.errors.map((e: string) => <p key={e} className="warn">⚠ {e}</p>)}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="tabbody">
        {tab === 'Overview' && <dl>
          <dt>Location</dt><dd>{skill.dir}</dd>{skill.realPath && (<><dt>Symlink target</dt><dd>{skill.realPath}</dd></>)}
          <dt>Source</dt><dd>{s.installSource?.type === 'github' ? `github.com/${s.installSource.owner}/${s.installSource.repo}/${s.installSource.path}` : skill.source ?? (s.managed ? 'local import' : 'not installed by this app')}</dd>
          <dt>Version</dt><dd>{s.version ?? 'unknown'}{s.pinned && ' (pinned)'}</dd><dt>Category</dt><dd>{s.category ?? '—'} <small>(inferred)</small></dd>
          <dt>Modified</dt><dd>{new Date(skill.lastModified).toLocaleString()}</dd><dt>Files</dt><dd>{fileList.length}</dd>
          <dt>Invoked as</dt><dd>{s.commands.map((c: string) => <code key={c}>{c} </code>)} <small>(documented: frontmatter name and directory name both work)</small></dd>
          <dt>Name resolution</dt><dd>{s.nameStatus === 'active' && s.nameConflicts.length === 0 ? 'No conflicts with other installed skills.' : <ul className="findings">{s.nameConflicts.map((c: A, i: number) => <li key={i}><Badge kind={c.kind === 'shadows' || c.kind === 'replaces-builtin' ? 'neutral' : c.kind === 'reserved' ? 'bad' : 'warn'}>{c.kind.replace(/-/g, ' ')}</Badge> {c.detail.startsWith(c.name) ? null : <b>{c.name} </b>}{c.detail} {c.other && <button className="link" onClick={() => go('skills', { select: c.other.id })}>{c.other.label}</button>}</li>)}</ul>}<div className="note">Precedence per Claude Code docs: enterprise › personal › project; plugin skills are namespaced. Enterprise-managed, nested and added-directory skills are not modelled.</div></dd>
          <dt>Update</dt><dd>{s.updateAvailable ? <Badge kind="ok">available</Badge> : s.managed ? 'up to date (as of last check)' : 'not tracked (not installed by this app)'}</dd>
        </dl>}
        {tab === 'How to use' && <>
          <h4>Documented <Badge kind="ok">from SKILL.md</Badge></h4>
          <p>{skill.description || 'No description in frontmatter.'}</p>
          {headings.length > 0 && <><b>Sections in SKILL.md</b><ul>{headings.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul></>}
          {fm['argument-hint'] && <p>Argument hint: <code>{String(fm['argument-hint'])}</code></p>}
          <h4>Invocation <Badge kind="ok">per Claude Code docs</Badge></h4>
          <p>Claude loads skills automatically when a request matches the description. You can also type {s.commands.map((c: string) => <code key={c}>{c} </code>)} — the frontmatter name and the directory name both invoke it.</p>
          {s.commands.map((c: string) => <button key={c} onClick={() => copy(c, notify)}>Copy {c}</button>)}
          <h4>Raw SKILL.md</h4><pre>{raw}</pre>
        </>}
        {tab === 'Commands' && <>{legacy ? <p>Legacy custom command: <code>/{skill.name}</code></p> : <p>Invocation: {s.commands.map((c: string) => <code key={c}>{c}{fm['argument-hint'] ? ' ' + fm['argument-hint'] : ''} </code>)} <small>(documented: both the frontmatter name and the directory name invoke a skill)</small></p>}<button onClick={() => copy(s.commands[0], notify)}>Copy</button> <button onClick={() => void call('app:openTerminal', {}).catch((e: Error) => notify('err', e.message))}>Open terminal</button></>}
        {tab === 'Files' && <FileBrowser id={id} files={fileList} />}
        {tab === 'Dependencies' && <Deps files={fileList} scan={scan} fm={fm} />}
        {tab === 'Configuration' && <table className="table"><tbody>{Object.entries(fm).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>)}</tbody></table>}
        {tab === 'Permissions' && <>{fm['allowed-tools'] ? <><p>This skill declares <code>allowed-tools</code>:</p><pre>{Array.isArray(fm['allowed-tools']) ? fm['allowed-tools'].join('\n') : String(fm['allowed-tools'])}</pre></> : <p>No <code>allowed-tools</code> declared; normal permission prompts apply.</p>}{scan?.scripts.length > 0 && <p>Ships {scan.scripts.length} script file(s): {scan.scripts.slice(0, 8).join(', ')}</p>}</>}
        {tab === 'Security' && <>{scan ? <><p><Badge kind={secKind(scan.status)}>{secLabel(scan.status)}</Badge> <small>Static pattern matching. Not a guarantee of safety.</small></p>{scan.findings.length === 0 ? <p>No findings.</p> : <ul className="findings">{scan.findings.slice(0, 120).map((f: A, i: number) => <li key={i}><Badge kind={f.severity === 'high' ? 'bad' : f.severity === 'review' ? 'warn' : 'neutral'}>{f.severity}</Badge> {f.message} <code>{f.file}{f.line ? `:${f.line}` : ''}</code></li>)}</ul>}</> : <p>Commands are single files and are not scanned.</p>}</>}
        {tab === 'Version history' && <>
          <p>Installed version: <b>{s.version ?? 'unknown'}</b></p>
          <h4>Backups of this skill</h4>{history.length === 0 ? <p className="empty">No backups yet. One is created before every change.</p> :
            <table className="table"><tbody>{history.map((b) => <tr key={b.id}><td>{new Date(b.createdAt).toLocaleString()}</td><td>{b.label}</td><td><button onClick={async () => { if (await confirm({ title: 'Restore this version?', body: 'The current files are replaced by the backed-up ones (a new backup of the current state is not created automatically).', confirmLabel: 'Restore' })) act(() => call('backups:restore', { id: b.id }), 'Restored') }}>Restore</button></td></tr>)}</tbody></table>}
        </>}
        {tab === 'Changelog' && (fileList.find((f) => /^changelog/i.test(f)) ? <FileBrowser id={id} files={fileList.filter((f) => /^changelog/i.test(f))} /> : <p className="empty">This skill ships no CHANGELOG file. Upstream release notes are on its repository.</p>)}
        {tab === 'Compatibility' && <dl><dt>Claude Code</dt><dd>Discovered in a location Claude Code reads ({skill.scope}).</dd><dt>Claude Desktop / Cowork / cloud</dt><dd>Not verified by this app. Their skill locations are separate from Claude Code's.</dd><dt>OS</dt><dd>{scan?.scripts.some((x: string) => /\.(ps1|bat)$/.test(x)) ? 'Windows scripts present' : scan?.scripts.some((x: string) => /\.(sh|bash)$/.test(x)) ? 'Shell scripts: macOS/Linux' : 'No OS-specific scripts detected'}</dd></dl>}
      </div>
      {plan && <PlanDialog plan={plan} onClose={() => setPlan(undefined)} onDone={() => { onChanged(); all.reload(); backups.reload() }} />}
      {copyTo && <Modal title={`Copy ${skill.name} to…`} onClose={() => setCopyTo(null)} footer={<button className="primary" onClick={() => { const t = copyTo; setCopyTo(null); void planTo(() => call('install:planCopy', { skillId: id, target: t })) }}>Review plan</button>}><TargetPicker value={copyTo} onChange={setCopyTo} /><p className="note">Copies the files (no duplicate registry entries). You'll review the exact changes before anything is written.</p></Modal>}
    </div>
  )
}

function FileBrowser({ id, files }: { id: string; files: string[] }) {
  const [f, setF] = useState<string>(); const [text, setText] = useState<string>(); const [err, setErr] = useState<string>()
  useEffect(() => { if (!f) return; setText(undefined); setErr(undefined); call<string>('skills:file', { id, rel: f }).then(setText).catch((e: Error) => setErr(e.message)) }, [f, id])
  return <div className="two"><ul className="files">{files.map((x) => <li key={x}><button className={x === f ? 'link active' : 'link'} onClick={() => setF(x)}>{x}</button></li>)}</ul><div>{err ? <p className="warn">{err}</p> : text !== undefined ? <pre>{text}</pre> : <p className="empty">Select a file to preview.</p>}</div></div>
}
function Deps({ files, scan, fm }: { files: string[]; scan: A; fm: A }) {
  const manifests = files.filter((f) => /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Gemfile|Cargo\.toml)$/.test(f))
  const runtimes = new Set<string>(); for (const s of scan?.scripts ?? []) { if (/\.py$/.test(s)) runtimes.add('Python 3'); if (/\.(js|mjs|ts)$/.test(s)) runtimes.add('Node.js'); if (/\.(sh|bash)$/.test(s)) runtimes.add('POSIX shell'); if (/\.ps1$/.test(s)) runtimes.add('PowerShell'); if (/\.rb$/.test(s)) runtimes.add('Ruby') }
  const net = scan?.findings.filter((f: A) => f.rule === 'network').length ?? 0
  return <><p><b>Detected from file types</b> (inferred, not a verified requirement list)</p><ul><li>Runtimes: {runtimes.size ? [...runtimes].join(', ') : 'none implied by files'}</li><li>Dependency manifests: {manifests.length ? manifests.join(', ') : 'none'}</li><li>Network references: {net ? `${net} line(s)` : 'none found'}</li><li>Declared tools: {fm['allowed-tools'] ? String(fm['allowed-tools']) : 'none'}</li></ul><p className="note">Installing never runs these scripts or installs their dependencies.</p></>
}
