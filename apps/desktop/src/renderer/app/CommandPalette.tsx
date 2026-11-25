import { useMemo, useState } from 'react'
import { type Go, NAV } from './nav'
import { type A, useCall } from '../shared/api'
import { Modal } from '../shared/ui'

export function Palette({ onClose, go }: { onClose: () => void; go: Go }) {
  const [q, setQ] = useState(''); const skills = useCall<A[]>('skills:list')
  const items = useMemo(() => {
    const s = q.toLowerCase()
    const pages = NAV.flatMap((g) => g.items).filter((i) => i.label.toLowerCase().includes(s)).map((i) => ({ key: i.id, label: `Go to ${i.label}`, run: () => go(i.id) }))
    const sk = s.length > 1 ? (skills.data ?? []).filter((x) => `${x.name} ${x.description}`.toLowerCase().includes(s)).slice(0, 8).map((x) => ({ key: x.id, label: `Skill: ${x.name}`, run: () => go('skills', { select: x.id }) })) : []
    return [...pages, ...sk]
  }, [q, skills.data, go])
  return (
    <Modal title="Command palette" onClose={onClose}>
      <input autoFocus placeholder="Type a page or skill name…" aria-label="Command palette search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && items[0]?.run()} />
      <ul className="palette">{items.map((i) => <li key={i.key}><button onClick={i.run}>{i.label}</button></li>)}</ul>
    </Modal>
  )
}
