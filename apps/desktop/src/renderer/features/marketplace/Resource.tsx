import { useState } from 'react'
import { type Go } from '../../app/nav'
import { PlanDialog } from '../install/PlanDialog'
import { type Target, TargetPicker } from '../install/TargetPicker'


import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, Md, Tabs, ago, copy, secLabel, useUi } from '../../shared/ui'

const TABS = ['Overview', 'Documentation', 'Files', 'Security & install', 'Versions', 'Related']

/** Full resource page for one marketplace entry (skill, plugin or MCP server). All numbers come from the cached live source data. */
export function Resource({ entryId, go, onBack, onOpen }: { entryId: string; go: Go; onBack: () => void; onOpen: (id: string) => void }) {
  const { notify, confirm } = useUi(); const r = useCall<A>('market:entry', { entryId }); const [tab, setTab] = useState('Overview'); const [target, setTarget] = useState<Target>({ scope: 'user' }); const [plan, setPlan] = useState<A>(); const [busy, setBusy] = useState(false); const [raw, setRaw] = useState(false)
  return (
    <div className="page resource-page">
      <Async r={r}>{(d) => {
        const e = d.entry
        const planIt = async () => { setBusy(true); try { setPlan(await call('install:planEntry', { entryId: e.id, target })) } catch (er) { notify('err', (er as Error).message) } finally { setBusy(false) } }
        const installPlugin = async () => {
          if (!(await confirm({ title: `Install plugin ${e.name}?`, confirmLabel: 'Run claude plugin install', body: <><p>This uses the official Claude CLI and runs, in order:</p><pre>claude plugin marketplace add {e.plugin.marketplaceSource}{'\n'}claude plugin install {e.plugin.installId}</pre><p>Plugins can contain hooks and MCP servers that execute programs. Review the plugin source first: <code>{e.repo?.htmlUrl}</code></p></> }))) return
          setBusy(true)
          try { await call('plugins:addMarketplace', { source: e.plugin.marketplaceSource }).catch((er: Error) => { if (!/already/i.test(er.message)) throw er }); notify('ok', (await call<string>('plugins:action', { action: 'install', id: e.plugin.installId })) || 'Plugin installed') } catch (er) { notify('err', (er as Error).message) } finally { setBusy(false) }
        }
        const inst = d.installed.byApp[0], others = d.installed.sameName
        return <>
          <div className="crumbs-line"><button className="link" onClick={onBack}>← Back to results</button> <span className="note">Marketplace / {e.source} / <b>{e.name}</b></span></div>
          <div className="dhead"><h1>{e.name}</h1><div>
            <Badge kind="accent">{e.type}</Badge> {e.official ? <Badge kind="ok">official source</Badge> : <Badge>community source</Badge>}{' '}
            {inst && (inst.current ? <Badge kind="ok">installed · current</Badge> : <Badge kind="warn">installed · update available</Badge>)}{!inst && others.length > 0 && <Badge kind="warn" title="A skill with this name exists that this app did not install from here">name already in use</Badge>}
            {e.repo?.archived && <Badge kind="bad">archived repository</Badge>}{e.partial && <Badge title="Details were loaded just now from SKILL.md">index entry</Badge>}
          </div></div>
          <p>{e.description || <i>No description.</i>}</p>
          <dl className="stats">
            {e.repo && <><dt>Repository stars</dt><dd>★ {e.repo.stars.toLocaleString()} <small>(whole repository, not this resource)</small></dd><dt>License</dt><dd>{e.repo.license ?? 'none declared'}</dd><dt>Last repo update</dt><dd>{ago(e.repo.pushedAt)}</dd></>}
            {e.commit && <><dt>Commit</dt><dd><code>{e.commit.slice(0, 10)}</code> <small>(installs are pinned to this commit)</small></dd></>}
            <dt>Verified</dt><dd>{ago(e.verifiedAt)} <small>from {e.source}</small></dd>
            {e.fileCount !== undefined && <><dt>Size</dt><dd>{e.fileCount} files{e.sizeBytes !== undefined && ` · ${(e.sizeBytes / 1024).toFixed(1)} KB`}</dd></>}
          </dl>
          <div className="actions">
            {e.type === 'skill' && <><TargetPicker value={target} onChange={setTarget} /><button className="primary" disabled={busy || !e.install.ok} onClick={planIt}>{busy ? 'Staging…' : 'Review installation plan'}</button></>}
            {e.type === 'plugin' && <button className="primary" disabled={busy} onClick={installPlugin}>Install via Claude CLI…</button>}
            {e.type === 'mcp' && (e.mcp?.install ? <button className="primary" onClick={() => go('mcp', { draft: { name: e.name.split('/').pop(), config: e.mcp.install } })}>Configure in MCP wizard…</button> : <span className="note">{e.mcp?.installNote}</span>)}
            {e.repo && <button onClick={() => void call('app:openExternal', { url: e.type === 'skill' && e.commit ? `${e.repo.htmlUrl}/tree/${e.commit}/${e.path ?? ''}` : e.repo.htmlUrl })}>Open on GitHub ↗</button>}
          </div>
          {!e.install.ok && e.type === 'skill' && <div className="errorbox">Cannot be installed automatically: {e.install.reason}</div>}
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          <div className="tabbody">
            {tab === 'Overview' && <>
              <dl>
                <dt>Categories</dt><dd>{e.categories.length ? e.categories.map((c: string) => <span key={c} title={`evidence: ${(e.classification?.evidence?.[c] ?? []).join(', ')}`}><Badge>{c}</Badge> </span>) : 'none inferred'} <small>(inferred from names, paths, repo topics and descriptions; hover for the matched terms)</small></dd>
                {e.classification?.declared && <><dt>Declared category</dt><dd>{e.classification.declared} <small>(from SKILL.md frontmatter)</small></dd></>}
                <dt>Author / source</dt><dd>{e.author ?? '—'} · {e.source}{e.path !== undefined && <> · <code>{e.path || '(repository root)'}</code></>}</dd>
                {e.container && <><dt>Part of plugin</dt><dd><code>{e.container}</code> <small>(the skill can be installed on its own)</small></dd></>}
                {e.mirrors?.length > 0 && <><dt>Also found at</dt><dd>{e.mirrors.map((m: string) => <code key={m}>{m || '(root)'} </code>)} <small>({e.mirrorsDiffer ? 'per-agent copies; some differ slightly from the one shown' : 'identical copies'} in other tool folders; listed once)</small></dd></>}
                <dt>Compatibility</dt><dd>{e.compatibility.join(', ')} · OS: {e.os.join(', ')} <small>(inferred from files)</small></dd>
                <dt>Complexity</dt><dd>{e.complexity}</dd>
                <dt>Dependencies</dt><dd>{e.dependencies?.length ? e.dependencies.join(', ') : 'none detected'}</dd>
                <dt>Scripts</dt><dd>{e.scripts?.length ? `${e.scripts.length}: ${e.scripts.slice(0, 6).join(', ')}` : 'none'}</dd>
                <dt>Network</dt><dd>{e.type === 'skill' ? (e.local ? 'None: local folder.' : `Install downloads ${e.fileCount ?? '?'} file(s) from github.com / raw.githubusercontent.com only.`) : e.type === 'mcp' ? 'The server may contact its own endpoints when started.' : 'Runs the Claude CLI, which fetches from the marketplace repository.'}</dd>
                <dt>Estimated actions</dt><dd>{e.type === 'skill' ? `Create ~/.claude/skills/${(e.path || e.name).split('/').pop()} (or the project's .claude/skills) with ${e.fileCount ?? '?'} files, after a backup. No script is run.` : e.type === 'mcp' ? `Add an entry to the chosen Claude config scope. ${e.mcp?.installNote ?? ''}` : 'Install the plugin through Claude Code.'}</dd>
              </dl>
              {d.usage && <><h4>Usage <Badge kind="ok">documented in SKILL.md</Badge></h4>
                {d.usage.argumentHint && <p>Argument hint: <code>{d.usage.argumentHint}</code></p>}
                {d.usage.headings.length > 0 && <><b>Sections</b><ul>{d.usage.headings.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul></>}
                {d.usage.examples.length > 0 ? <><b>Examples from the document</b>{d.usage.examples.map((x: string, i: number) => <pre key={i}>{x}</pre>)}</> : <p className="note">The document contains no code examples.</p>}</>}
              {e.type === 'mcp' && e.mcp?.install && <><h4>Configuration that would be created</h4><pre>{JSON.stringify(e.mcp.install, null, 2)}</pre><button onClick={() => copy(JSON.stringify(e.mcp.install, null, 2), notify)}>Copy</button></>}
            </>}
            {tab === 'Documentation' && <><div className="seg"><button className={!raw ? 'on' : ''} onClick={() => setRaw(false)}>Rendered</button><button className={raw ? 'on' : ''} onClick={() => setRaw(true)}>Raw</button></div><p className="note">{d.doc.title} · shown as safe text; no HTML or scripts from the source are executed.</p>
              {raw ? <pre className="doc">{d.doc.text.slice(0, 40000)}</pre> : <div className="doc"><Md text={d.doc.text.slice(0, 40000)} /></div>}</>}
            {tab === 'Files' && (e.files?.length ? <><p className="note">{e.files.length < (e.fileCount ?? 0) ? `First ${e.files.length} of ${e.fileCount} files.` : `${e.files.length} file(s).`}</p><ul className="files">{e.files.map((f: string) => <li key={f}>{f}</li>)}</ul></> : <p className="empty">File list not available for this entry type.</p>)}
            {tab === 'Security & install' && <>
              <p><Badge>{secLabel('not-inspected')}</Badge> Nothing has been downloaded yet, so nothing has been inspected.</p>
              <ol><li>“Review installation plan” downloads only this folder, pinned to commit <code>{e.commit?.slice(0, 10) ?? '—'}</code>, into a temporary staging area outside your Claude folders.</li>
                <li>It then scans scripts, network calls, credential references, obfuscation and binaries (advisory pattern matching, never a guarantee), checks name conflicts and your existing files, and shows the exact file changes.</li>
                <li>Only after you approve: backup → install → verify against the plan → record. Any failure rolls everything back. Nothing from the resource is executed.</li></ol>
              <p className="note">Scope: choose Global or a registered project above before reviewing the plan.</p></>}
            {tab === 'Versions' && <dl>
              <dt>Available</dt><dd>{e.commit ? <><code>{e.commit.slice(0, 10)}</code> on {e.repo?.owner}/{e.repo?.repo}</> : '—'} <small>verified {ago(e.verifiedAt)}</small></dd>
              <dt>Installed (by this app)</dt><dd>{d.installed.byApp.length ? d.installed.byApp.map((i: A) => <div key={i.id}><code>{i.version?.slice(0, 10) ?? 'unknown'}</code> · {i.scope}{i.project ? ` (${i.project.split('/').pop()})` : ''} {i.current ? <Badge kind="ok">current</Badge> : <Badge kind="warn">differs from available</Badge>} {i.pinned && <Badge>pinned</Badge>}</div>) : 'not installed from this entry'}</dd>
              <dt>Same name on disk</dt><dd>{others.length ? others.map((o: A, i: number) => <div key={i}>{o.scope}: <code>{o.dir}</code></div>) : 'none'}</dd></dl>}
            {tab === 'Related' && (d.related.length ? <div className="grid wide">{d.related.map((x: A) => <button key={x.id} className="tile" onClick={() => onOpen(x.id)}><b>{x.name}</b><span className="desc">{x.description || <i>details load when opened</i>}</span></button>)}</div> : <p className="empty">No other entries from this {e.container ? 'plugin' : 'folder'}.</p>)}
          </div>
          {plan && <PlanDialog plan={plan} onClose={() => setPlan(undefined)} onDone={r.reload} />}
        </>
      }}</Async>
    </div>
  )
}
