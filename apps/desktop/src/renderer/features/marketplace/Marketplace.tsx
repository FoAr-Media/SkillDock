import { useCallback, useEffect, useRef, useState } from 'react'
import { type Go } from '../../app/nav'
import { PlanDialog } from '../install/PlanDialog'
import { type Target, TargetPicker } from '../install/TargetPicker'
import { Resource } from './Resource'

import { type A, call, useCall } from '../../shared/api'
import { Badge, Empty, Modal, ago, useUi } from '../../shared/ui'

const PAGE = 48
const STATUS: Record<string, ['ok' | 'warn' | 'bad' | 'neutral', string]> = { verified: ['ok', 'verified'], partial: ['warn', 'partial'], error: ['bad', 'error'], 'rate-limited': ['warn', 'rate-limited'], never: ['neutral', 'not verified'] }

export function Marketplace({ go, arg }: { go: Go; arg?: A }) {
  const { notify } = useUi()
  const [f, setF] = useState<A>({ sort: 'stars' }); const [type, setType] = useState('skill'); const [q, setQ] = useState('')
  const cats = useCall<string[]>('market:categories'); const sources = useCall<A[]>('market:sources'); const facets = useCall<A>('market:facets'); const featured = useCall<A[]>('market:featured'); const rate = useCall<A>('market:rateLimit')
  const [items, setItems] = useState<A[]>([]); const [total, setTotal] = useState(0); const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false); const [sel, setSel] = useState<string>(); const [imp, setImp] = useState(!!arg?.importRepo); const [find, setFind] = useState(false); const [addSrc, setAddSrc] = useState('')
  const [regQ, setRegQ] = useState(''); const [regBusy, setRegBusy] = useState(false); const [tick, setTick] = useState(0); const reqId = useRef(0)

  const payload = useCallback((offset: number) => ({ ...f, q: q || undefined, type: type === 'all' ? undefined : type, limit: PAGE, offset }), [f, q, type])
  useEffect(() => { const id = ++reqId.current; setLoading(true); call<A>('market:query', payload(0)).then((r) => { if (id === reqId.current) { setItems(r.items); setTotal(r.total) } }).catch((e: Error) => notify('err', e.message)).finally(() => id === reqId.current && setLoading(false)) }, [payload, tick]) // eslint-disable-line
  const more = async () => { setLoading(true); try { const r = await call<A>('market:query', payload(items.length)); setItems((l) => [...l, ...r.items]); setTotal(r.total) } catch (e) { notify('err', (e as Error).message) } finally { setLoading(false) } }
  const reloadAll = () => { sources.reload(); facets.reload(); featured.reload(); rate.reload(); setTick((n) => n + 1) }

  const refresh = async (sourceId?: string, force = false) => {
    setRefreshing(true)
    try {
      const r: A[] = await call('market:refresh', { sourceId, force }); const bad = r.filter((x) => !x.ok)
      notify(bad.length ? 'err' : 'ok', bad.length ? `Refresh issues: ${bad.map((b) => `${b.id}: ${b.error}`).join(' | ')}` : `Verified ${r.length} source(s)${r.some((x) => x.reused) ? ` (${r.filter((x) => x.reused).length} unchanged, served from cache)` : ''}`)
    } catch (e) { notify('err', (e as Error).message) } finally { setRefreshing(false); reloadAll() }
  }
  const addSource = async (repo: string) => { try { const r: A = await call('market:addSource', { repo }); notify('ok', `Added ${r.id}: ${r.count} entries${r.mode === 'index-only' ? ' (large repository: indexed from its file tree; details load when you open an entry)' : ''}`); reloadAll(); return true } catch (e) { notify('err', (e as Error).message); reloadAll(); return false } }
  useEffect(() => { if (sources.data && sources.data.every((s) => s.status === 'never') && !refreshing) void refresh() }, [sources.data?.length]) // eslint-disable-line
  const searchRegistry = async () => { setRegBusy(true); try { const r = await call<A[]>('market:registry', { q: regQ }); notify('ok', `${r.length} MCP server(s) from the official registry`); reloadAll() } catch (e) { notify('err', `MCP registry unreachable: ${(e as Error).message}`) } finally { setRegBusy(false) } }
  const set = (k: string, v: unknown) => setF((o: A) => ({ ...o, [k]: v === '' ? undefined : v })) // false is a real value (e.g. official: false = community)

  if (sel) return <Resource entryId={sel} go={go} onBack={() => setSel(undefined)} onOpen={setSel} />
  const topCats = Object.entries(facets.data?.categories ?? {}).sort((a: A, b: A) => b[1] - a[1]).slice(0, 10)
  const licenses = Object.keys(facets.data?.licenses ?? {}).sort()
  return (
    <div className="page">
      <h1>Marketplace</h1>
      <p className="note">A free discovery catalog built live from public sources you can inspect below. <b>★ is repository-level popularity</b>, read from the GitHub API, not a rating of an individual skill. Categories are inferred from names, paths, topics and descriptions. No reviews, downloads or verification badges are invented.</p>
      <div className="toolbar wrap">
        <button className="primary" disabled={refreshing} onClick={() => refresh()}>{refreshing ? 'Refreshing…' : 'Refresh sources'}</button>
        <button onClick={() => setImp(true)}>Import GitHub repository / skill URL</button>
        <button onClick={() => setFind(true)}>Find repositories on GitHub…</button>
        <button onClick={async () => { try { const r: A | null = await call('market:addLocalSource'); if (r) { notify('ok', `Indexed ${r.count} local skill(s)`); reloadAll() } } catch (e) { notify('err', (e as Error).message) } }}>Add local folder…</button>
        <input placeholder="Add source: owner/repo" aria-label="Add source repository" value={addSrc} onChange={(e) => setAddSrc(e.target.value)} />
        <button disabled={!addSrc} onClick={async () => { if (await addSource(addSrc)) setAddSrc('') }}>Add</button>
      </div>
      {rate.data && <p className="note" title="Unauthenticated GitHub allows 60 requests/hour. Add a token in Settings for more.">GitHub API budget: <b>{rate.data.remaining}</b> / {rate.data.limit} requests left{rate.data.remaining < 15 && ' — low: refreshes may be skipped until it resets'} (resets {new Date(rate.data.reset * 1000).toLocaleTimeString()}).</p>}
      <details><summary>Sources &amp; verification ({sources.data?.length ?? 0})</summary>
        <table className="table"><thead><tr><th>Source</th><th>Kind</th><th>Verification</th><th>Entries</th><th>Repo ★</th><th><span className="sr">Actions</span></th></tr></thead><tbody>{(sources.data ?? []).map((s) => <tr key={s.id}>
          <td className="trunc" title={s.id}>{s.id}{s.archived && <> <Badge kind="bad">archived</Badge></>}</td><td>{s.kind === 'local' ? <Badge>local</Badge> : s.official ? <Badge kind="ok">official</Badge> : <Badge>community</Badge>}</td>
          <td title={s.error ?? ''}><Badge kind={STATUS[s.status]?.[0]}>{STATUS[s.status]?.[1]}</Badge>{s.stale && <> <Badge kind="warn">stale &gt;24h</Badge></>}{s.mode === 'index-only' && <> <Badge title="Too large to read every SKILL.md: listed from the file tree, details load on open">index-only</Badge></>}{s.verifiedAt && <small> {ago(s.verifiedAt)}{s.commit && ` · ${s.commit.slice(0, 7)}`}</small>}{s.error && <div className="note">{s.error}</div>}</td>
          <td>{s.entryCount}</td><td>{s.stars !== undefined ? s.stars.toLocaleString() : '—'}</td>
          <td><button onClick={() => refresh(s.id, true)}>Re-verify</button>{!s.builtin && <button onClick={() => call('market:removeSource', { id: s.id }).then(reloadAll)}>Remove</button>}</td></tr>)}</tbody></table>
        <h4>Featured community sources <small>(each was inspected and found to contain SKILL.md files; stars and counts appear after you add one)</small></h4>
        <table className="table"><tbody>{(featured.data ?? []).map((s) => <tr key={s.id}><td>{s.area}</td><td><b>{s.id}</b><div className="note">{s.note} · inspected {s.verifiedOn}</div></td><td>{s.added ? <Badge kind="ok">added</Badge> : <button aria-label={`Add ${s.id}`} onClick={() => addSource(s.id)}>Add</button>}</td></tr>)}</tbody></table>
      </details>
      <div className="tabs" role="tablist">{['skill', 'plugin', 'mcp', 'all'].map((t) => <button key={t} role="tab" aria-selected={t === type} className={t === type ? 'tab active' : 'tab'} onClick={() => setType(t)}>{{ skill: 'Skills', plugin: 'Plugins', mcp: 'MCP servers', all: 'All' }[t]}</button>)}</div>
      {type === 'mcp' && <div className="toolbar"><input placeholder="Search the official MCP Registry (network)…" aria-label="Search MCP registry" value={regQ} onChange={(e) => setRegQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && regQ && searchRegistry()} /><button disabled={!regQ || regBusy} onClick={searchRegistry}>{regBusy ? 'Searching…' : 'Search registry'}</button></div>}
      <div className="toolbar wrap">
        <input placeholder="Filter results…" aria-label="Search marketplace" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Category" value={f.category ?? ''} onChange={(e) => set('category', e.target.value)}><option value="">All categories</option>{(cats.data ?? []).map((c) => <option key={c} value={c}>{c}{facets.data?.categories?.[c] ? ` (${facets.data.categories[c]})` : ''}</option>)}</select>
        <select aria-label="Sort" value={f.sort} onChange={(e) => set('sort', e.target.value)}><option value="stars">Repository stars</option><option value="updated">Recently updated</option><option value="relevance">Relevance</option><option value="added">Recently added</option><option value="activity">Repository activity</option><option value="compatibility">Compatibility</option></select>
        <select aria-label="License" value={f.license ?? ''} onChange={(e) => set('license', e.target.value)}><option value="">Any license</option>{licenses.map((l) => <option key={l} value={l}>{l}</option>)}</select>
        <select aria-label="Operating system" onChange={(e) => set('os', e.target.value)}><option value="">Any OS</option><option value="macos">macOS</option><option value="linux">Linux</option><option value="windows">Windows</option></select>
        <select aria-label="Install complexity" onChange={(e) => set('complexity', e.target.value)}><option value="">Any complexity</option><option value="simple">Simple (docs only)</option><option value="moderate">Moderate (scripts)</option><option value="complex">Complex (dependencies)</option></select>
        <select aria-label="Source type" onChange={(e) => set('official', e.target.value === '' ? undefined : e.target.value === 'official')}><option value="">Official + community</option><option value="official">Official</option><option value="community">Community</option></select>
        <select aria-label="Installed status" onChange={(e) => set('installed', e.target.value === '' ? undefined : e.target.value === 'yes')}><option value="">Installed or not</option><option value="yes">Installed</option><option value="no">Not installed</option></select>
        <input type="number" min={0} placeholder="Min ★" aria-label="Minimum stars" className="w90" onChange={(e) => set('minStars', e.target.value ? +e.target.value : undefined)} />
        <label className="check"><input type="checkbox" aria-label="Hide archived" onChange={(e) => set('excludeArchived', e.target.checked || '')} /> Hide archived</label>
        <label className="check"><input type="checkbox" aria-label="Installable only" onChange={(e) => set('installableOnly', e.target.checked || '')} /> Installable only</label>
      </div>
      {topCats.length > 0 && <div className="chips" aria-label="Category shortcuts">{topCats.map(([c, n]: A) => <button key={c} className={f.category === c ? 'chip on' : 'chip'} onClick={() => set('category', f.category === c ? '' : c)}>{c} <small>{n}</small></button>)}</div>}
      <p className="note" aria-live="polite">{loading && !items.length ? 'Loading…' : `Showing ${items.length} of ${total}`}</p>
      {!loading && items.length === 0 ? <Empty>{refreshing ? 'Fetching sources…' : 'No matching entries. Try Refresh sources (needs internet), add a featured source above, or clear filters. Cached entries stay browsable offline.'}</Empty> : (
        <div className="grid wide">{items.map((e) => (
          <button key={e.id} className="tile" onClick={() => setSel(e.id)}>
            <b>{e.name}</b>{e.path && <small className="note trunc" title={e.path}>{e.container ? `${e.container} › ` : ''}{e.path.split('/').slice(-1)[0] !== e.name ? e.path : ''}</small>}<span className="desc">{e.description || <i>details load when opened</i>}</span>
            <span className="meta"><Badge kind="accent">{e.type}</Badge>{e.official && <Badge kind="ok">official source</Badge>}{e.installed && <Badge kind="ok">installed</Badge>}{e.repo && <Badge title="Stars of the whole repository">★ {e.repo.stars.toLocaleString()} repo</Badge>}{e.categories.slice(0, 2).map((c: string) => <Badge key={c}>{c}</Badge>)}
              {e.mirrors?.length > 0 && <Badge title={`Identical copy also at: ${e.mirrors.join(', ')}`}>+{e.mirrors.length} mirror{e.mirrors.length > 1 ? 's' : ''}</Badge>}{!e.install.ok && <Badge kind="warn" title={e.install.reason}>not auto-installable</Badge>}{e.repo?.archived && <Badge kind="bad">archived</Badge>}</span>
          </button>))}</div>
      )}
      {items.length < total && <div className="actions"><button disabled={loading} onClick={more}>{loading ? 'Loading…' : `Load more (${total - items.length} left)`}</button></div>}
      {imp && <ImportRepo onClose={() => setImp(false)} onDone={reloadAll} />}
      {find && <FindRepos onClose={() => setFind(false)} onAdd={addSource} />}
    </div>
  )
}

function ImportRepo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useUi(); const [repo, setRepo] = useState(''); const [ref, setRef] = useState(''); const [p, setP] = useState(''); const [target, setTarget] = useState<Target>({ scope: 'user' }); const [busy, setBusy] = useState(false); const [plan, setPlan] = useState<A>()
  const go = async () => { setBusy(true); try { setPlan(await call('install:planGithub', { repo, ref: ref || undefined, path: p || undefined, target })) } catch (e) { notify('err', (e as Error).message) } finally { setBusy(false) } }
  const local = async () => { try { const pl = await call('install:planLocal', { target }); if (pl) setPlan(pl) } catch (e) { notify('err', (e as Error).message) } }
  if (plan) return <PlanDialog plan={plan} onClose={onClose} onDone={onDone} />
  return (
    <Modal title="Import a skill" onClose={onClose} footer={<><button onClick={local}>Choose local folder…</button><button className="primary" disabled={!repo || busy} onClick={go}>{busy ? 'Downloading to staging…' : 'Review plan'}</button></>}>
      <p className="note">Downloads only the chosen skill folder into a temporary staging area, inspects it, and shows the plan. It does not run anything. Paste a skill folder URL (…/tree/main/skills/name) or enter owner/repo and a path.</p>
      <label className="field">GitHub URL or owner/repo<input autoFocus value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="anthropics/skills" /></label>
      <label className="field">Path inside repo (folder containing SKILL.md)<input value={p} onChange={(e) => setP(e.target.value)} placeholder="skills/frontend-design" /></label>
      <label className="field">Branch, tag or commit SHA (optional; pinned to a SHA when installed)<input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="default branch" /></label>
      <TargetPicker value={target} onChange={setTarget} />
    </Modal>
  )
}

const TOPICS = ['claude-skills', 'agent-skills', 'claude-code-skills', 'claude-code-plugin']
function FindRepos({ onClose, onAdd }: { onClose: () => void; onAdd: (repo: string) => Promise<boolean> }) {
  const { notify } = useUi(); const [topic, setTopic] = useState('claude-skills'); const [text, setText] = useState(''); const [minStars, setMin] = useState(100); const [res, setRes] = useState<A[]>(); const [busy, setBusy] = useState(false); const [adding, setAdding] = useState<string>()
  const search = async () => { setBusy(true); try { setRes(await call<A[]>('market:findSources', { topic: topic || undefined, q: text || undefined, minStars })) } catch (e) { notify('err', `GitHub search failed: ${(e as Error).message}`) } finally { setBusy(false) } }
  return (
    <Modal wide title="Find repositories on GitHub" onClose={onClose} footer={<button className="primary" disabled={busy} onClick={search}>{busy ? 'Searching…' : 'Search GitHub'}</button>}>
      <p className="note">Searches GitHub's public repository index by topic. Results are <b>candidates</b>: nothing is inspected until you add one, and adding only reads its file tree. Stars are GitHub's live numbers for the whole repository.</p>
      <div className="toolbar wrap"><select aria-label="GitHub topic" value={topic} onChange={(e) => setTopic(e.target.value)}><option value="">Any topic</option>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select><input aria-label="Search text" placeholder="keywords, e.g. video" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /><label className="field">Min ★<input type="number" aria-label="Minimum repository stars" className="w90" value={minStars} onChange={(e) => setMin(+e.target.value || 0)} /></label></div>
      {res && (res.length === 0 ? <p className="empty">No repositories matched.</p> : <table className="table"><thead><tr><th>Repository</th><th>★</th><th>License</th><th>Updated</th><th><span className="sr">Actions</span></th></tr></thead><tbody>{res.map((r) => <tr key={r.fullName}><td><b>{r.fullName}</b><div className="note">{r.description}</div><div>{r.topics.slice(0, 5).map((t: string) => <Badge key={t}>{t}</Badge>)} <Badge>not yet inspected</Badge></div></td><td>{r.stars.toLocaleString()}</td><td>{r.license ?? '—'}</td><td>{ago(r.pushedAt)}</td>
        <td>{r.added ? <Badge kind="ok">added</Badge> : <button disabled={adding === r.fullName} onClick={async () => { setAdding(r.fullName); if (await onAdd(r.fullName)) setRes((l) => l?.map((x) => (x.fullName === r.fullName ? { ...x, added: true } : x))); setAdding(undefined) }}>{adding === r.fullName ? 'Inspecting…' : 'Add & inspect'}</button>}</td></tr>)}</tbody></table>)}
    </Modal>
  )
}
