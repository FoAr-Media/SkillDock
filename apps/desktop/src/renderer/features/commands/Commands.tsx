import { useState } from 'react'
import { type Go } from '../../app/nav'
import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, copy, useUi } from '../../shared/ui'

export function Commands({}: { go: Go }) {
  const { notify, confirm } = useUi(); const l = useCall<A[]>('commands:list'); const [q, setQ] = useState(''); const [cat, setCat] = useState('all')
  const open = async () => { if (await confirm({ title: 'Open Terminal?', confirmLabel: 'Open', body: <p>Opens a Terminal window in your home folder. Nothing is typed or run for you; paste the command yourself.</p> })) void call('app:openTerminal', {}).catch((e: Error) => notify('err', e.message)) }
  return <div className="page"><h1>Commands</h1><p className="note">Built-in commands are a curated list (use <code>/help</code> in Claude Code for your version). Skill, custom and plugin commands are read from disk. This app never runs commands; it copies them or opens a terminal.</p>
    <div className="toolbar"><input placeholder="Search commands…" aria-label="Search commands" value={q} onChange={(e) => setQ(e.target.value)} /><select aria-label="Command category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">All categories</option>{[...new Set((l.data ?? []).map((c) => c.category as string))].sort().map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
    <Async r={l}>{(rows) => <table className="table"><thead><tr><th>Command</th><th>Syntax</th><th>Description</th><th>Category / source</th><th><span className="sr">Actions</span></th></tr></thead><tbody>{rows.filter((c) => (cat === 'all' || c.category === cat) && `${c.name} ${c.description}`.toLowerCase().includes(q.toLowerCase())).slice(0, 400).map((c, i) => <tr key={c.name + i}><td><code>{c.name}</code></td><td><code>{c.syntax}</code></td><td className="trunc">{c.description}</td><td><Badge>{c.category}</Badge> <small>{c.source}</small></td><td><button onClick={() => copy(c.syntax, notify)}>Copy</button><button onClick={open}>Terminal</button></td></tr>)}</tbody></table>}</Async></div>
}
