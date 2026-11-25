import { useState } from 'react'
import { type Go } from '../../app/nav'
import { PlanDialog } from '../install/PlanDialog'
import { type Target, TargetPicker } from '../install/TargetPicker'

import { PlanList } from '../presets/PlanList'

import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, Empty, ago, useUi } from '../../shared/ui'

export function Orgs({}: { go: Go }) {
  const { notify, confirm } = useUi(); const l = useCall<A[]>('orgs:list'); const [kind, setKind] = useState('url'); const [val, setVal] = useState(''); const [target, setTarget] = useState<Target>({ scope: 'user' }); const [plan, setPlan] = useState<A>(); const [review, setReview] = useState<A>(); const [busy, setBusy] = useState(false)
  const connect = async () => { setBusy(true); try { const m: A = await call('orgs:connect', { kind, value: val }); notify('ok', `Connected ${m.organization.name} v${m.catalogVersion}`); setVal(''); l.reload() } catch (e) { notify('err', (e as Error).message) } finally { setBusy(false) } }
  const fromFile = async () => { try { const m: A | null = await call('orgs:connectFile'); if (m) { notify('ok', `Connected ${m.organization.name}`); l.reload() } } catch (e) { notify('err', (e as Error).message) } }
  const planOne = async (orgId: string, rid: string) => { try { setPlan(await call('orgs:plan', { orgId, resourceId: rid, target })) } catch (e) { notify('err', (e as Error).message) } }
  const planMany = async (orgId: string, ids: string[]) => { const plans: A[] = [], errors: A[] = []; for (const id of ids) { try { plans.push(await call('orgs:plan', { orgId, resourceId: id, target })) } catch (e) { errors.push({ item: id, error: (e as Error).message }) } } setReview({ plans, errors }) }
  return <div className="page"><h1>Organizations</h1>
    <p className="note">Connect a catalog your organization publishes (a JSON manifest in a private/self-hosted Git repo, a URL or a local file). This distributes <b>resources</b> only. It does not administer Claude accounts, and it never overrides managed Claude policies. Optional manifest signatures are shown but not cryptographically verified in this version.</p>
    <div className="toolbar wrap"><select aria-label="Catalog source type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="url">HTTPS URL</option><option value="github">GitHub repo file (supports private with token)</option></select><input className="grow" aria-label="Catalog location" value={val} onChange={(e) => setVal(e.target.value)} placeholder={kind === 'url' ? 'https://example.com/claude-catalog.json' : 'owner/repo/path/catalog.json@main'} /><button className="primary" disabled={!val || busy} onClick={connect}>Connect</button><button onClick={fromFile}>Choose local file…</button></div>
    <div className="toolbar"><TargetPicker value={target} onChange={setTarget} /></div>
    <Async r={l} empty={<Empty>No catalogs connected. Private GitHub repositories need a token in Settings.</Empty>}>{(orgs) => <>{orgs.map((o) => <section key={o.id} className="card-block"><div className="dhead"><h2>{o.manifest.organization.name} <small>v{o.manifest.catalogVersion}</small></h2><div><button onClick={async () => { try { await call('orgs:connect', o.location.kind === 'url' ? { kind: 'url', value: o.location.url } : o.location.kind === 'github' ? { kind: 'github', value: o.location.spec } : { kind: 'file', value: o.location.path }); notify('ok', 'Catalog refreshed'); l.reload() } catch (e) { notify('err', (e as Error).message) } }}>Refresh</button><button className="danger" onClick={async () => { if (await confirm({ title: 'Disconnect catalog?', danger: true, confirmLabel: 'Disconnect', body: <p>Installed skills stay. Only the catalog link is removed.</p> })) { await call('orgs:disconnect', { id: o.id }); l.reload() } }}>Disconnect</button></div></div>
      <p className="note">Fetched {ago(o.fetchedAt)} · {o.manifest.signature ? 'signature present (not verified)' : 'unsigned'}</p>
      <table className="table"><thead><tr><th>Resource</th><th>Pinned</th><th>Integrity</th><th>Installed</th><th><span className="sr">Actions</span></th></tr></thead><tbody>{o.manifest.resources.map((r: A) => { const inst = o.installed.find((i: A) => i.name === r.name || i.target.endsWith('/' + r.id)); const pin = r.sha ?? r.ref; return <tr key={r.id}><td><b>{r.name}</b><div className="note">{r.description}</div></td><td>{pin.slice(0, 10)}</td><td>{r.checksum ? <Badge kind="ok">checksum</Badge> : <Badge>none declared</Badge>}</td><td>{inst ? <>{inst.version?.slice(0, 10)} {r.sha && inst.version !== r.sha ? <Badge kind="warn">update</Badge> : <Badge kind="ok">current</Badge>}</> : '—'}</td><td><button onClick={() => planOne(o.id, r.id)}>{inst ? 'Reinstall / update' : 'Install'}</button></td></tr> })}</tbody></table>
      {o.manifest.presets.length > 0 && <><h4>Organization presets</h4>{o.manifest.presets.map((p: A) => <div key={p.id} className="actions"><b>{p.name}</b> <small>{p.resourceIds.length} resources</small><button onClick={() => planMany(o.id, p.resourceIds)}>Review plan</button></div>)}</>}
    </section>)}</>}</Async>
    {plan && <PlanDialog plan={plan} onClose={() => setPlan(undefined)} onDone={l.reload} />}
    {review && <PlanList plans={review.plans} errors={review.errors} onClose={() => setReview(undefined)} onDone={l.reload} />}</div>
}
