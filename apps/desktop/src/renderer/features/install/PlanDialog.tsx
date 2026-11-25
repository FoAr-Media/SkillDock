import { useState } from 'react'
import { Findings } from './Findings'

import { type A, call } from '../../shared/api'
import { Badge, Modal, secKind, secLabel, useUi } from '../../shared/ui'

// ---------- install plan review (lifecycle steps 9–16) ----------
export function PlanDialog({ plan, onClose, onDone }: { plan: A; onClose: () => void; onDone: () => void }) {
  const { notify } = useUi(); const [busy, setBusy] = useState(false); const [overwrite, setOverwrite] = useState(false); const [risk, setRisk] = useState(false)
  const cancel = () => { void call('install:cancel', { planId: plan.id }); onClose() }
  const needsOverwrite = plan.conflict !== 'none', needsRisk = plan.security === 'high-risk'
  const blocked = (needsOverwrite && !overwrite) || (needsRisk && !risk)
  const apply = async () => {
    setBusy(true)
    try { await call('install:apply', { planId: plan.id, overwrite, approveHighRisk: risk }); notify('ok', `Installed ${plan.name}`); onDone(); onClose() }
    catch (e) { notify('err', `Install failed and was rolled back: ${(e as Error).message}`); setBusy(false) }
  }
  const src = plan.source.type === 'github' ? `github.com/${plan.source.owner}/${plan.source.repo}${plan.source.path ? '/' + plan.source.path : ''}` : plan.source.dir
  const stat = { add: '+', modify: '~', remove: '−', same: ' ' } as Record<string, string>
  return (
    <Modal wide title={`Review installation: ${plan.name}`} onClose={cancel} footer={<><button onClick={cancel}>Cancel</button><button className="primary" disabled={busy || blocked} onClick={apply}>{busy ? 'Installing…' : needsOverwrite ? 'Replace & install' : 'Approve & install'}</button></>}>
      <p>{plan.description || <i>No description.</i>}</p>
      <dl>
        <dt>Source</dt><dd>{src}</dd>
        <dt>Version</dt><dd>{plan.version ? `commit ${plan.version.slice(0, 10)} (pinned)` : 'local copy'}</dd>
        <dt>Will write to</dt><dd>{plan.targetDir}</dd>
        <dt>Files</dt><dd>{plan.files.length} ({(plan.files.reduce((n: number, f: A) => n + f.size, 0) / 1024).toFixed(1)} KB) · scripts: {plan.scripts.length}</dd>
        <dt>Security</dt><dd><Badge kind={secKind(plan.security)}>{secLabel(plan.security)}</Badge> <small>static, advisory only</small></dd>
        {plan.org && (<><dt>Organization</dt><dd>{plan.org}</dd></>)}
      </dl>
      {plan.names?.length > 0 && <p className="note">Will be invoked as <code>{plan.names.join('</code> or <code>')}</code> (frontmatter name and directory name both work).</p>}
      {plan.nameConflicts?.filter((c: A) => c.kind !== 'shadows').map((c: A, i: number) => <p key={i} className={c.kind === 'reserved' || c.kind === 'shadowed-by' || c.kind === 'duplicate' ? 'warn' : 'note'}>⚠ <b>{c.name}</b>: {c.detail}</p>)}
      {plan.nameConflicts?.filter((c: A) => c.kind === 'shadows').map((c: A, i: number) => <p key={`s${i}`} className="note">{c.name}: {c.detail}</p>)}
      {plan.skipped?.length > 0 && <p className="warn">Skipped {plan.skipped.length} symlink/submodule entries.</p>}
      <p className="note">Nothing has been written to your Claude directories yet. Approving creates a backup first, installs, verifies the files match this plan, and rolls back on any failure. No script in this resource is executed by the install.</p>
      <h4>Exact file changes</h4>
      <ul className="files">{plan.changes.map((c: A) => <li key={c.path} className={`chg ${c.status}`}>{stat[c.status]} {c.path}</li>)}</ul>
      {plan.findings.length > 0 && <Findings findings={plan.findings} />}
      {needsOverwrite && <label className="check"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> {plan.conflict === 'exists-modified' ? 'This skill was modified locally since install. ' : plan.conflict === 'exists-foreign' ? 'A skill with this name already exists that this app did not install. ' : 'This replaces the installed version. '}Replace it (a backup is kept).</label>}
      {needsRisk && <label className="check"><input type="checkbox" checked={risk} onChange={(e) => setRisk(e.target.checked)} /> I reviewed the high-risk findings and accept installing anyway.</label>}
    </Modal>
  )
}
