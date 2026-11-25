import { useState } from 'react'
import { PlanDialog } from '../install/PlanDialog'
import { type A, call } from '../../shared/api'
import { Badge, Modal, secKind, secLabel } from '../../shared/ui'

export function PlanList({ plans, errors, onClose, onDone }: { plans: A[]; errors?: A[]; onClose: () => void; onDone: () => void }) {
  const [open, setOpen] = useState<A>(); const [done, setDone] = useState<Set<string>>(new Set())
  const close = () => { plans.filter((p) => !done.has(p.id)).forEach((p) => void call('install:cancel', { planId: p.id })); onClose() }
  return <Modal wide title="Review installation plans" onClose={close} footer={<button onClick={close}>Close</button>}>
    <p className="note">Nothing is installed until you review and approve each plan.</p>
    {errors?.map((e) => <p key={e.item} className="warn">⚠ {e.item}: {e.error}</p>)}
    <table className="table"><tbody>{plans.map((p) => <tr key={p.id}><td><b>{p.name}</b><div className="note">{p.files.length} files → {p.targetDir}</div></td><td><Badge kind={secKind(p.security)}>{secLabel(p.security)}</Badge></td><td>{p.conflict !== 'none' && <Badge kind="warn">{p.conflict.replace('exists-', 'exists: ')}</Badge>}</td><td>{done.has(p.id) ? <Badge kind="ok">installed</Badge> : <button className="primary" onClick={() => setOpen(p)}>Review & install</button>}</td></tr>)}</tbody></table>
    {open && <PlanDialog plan={open} onClose={() => setOpen(undefined)} onDone={() => { setDone(new Set(done).add(open.id)); onDone() }} />}
  </Modal>
}
