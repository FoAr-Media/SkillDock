import { type ReactNode } from 'react'

/** Minimal safe Markdown preview: builds React nodes (no HTML injection path). Headings, lists, code fences, paragraphs. */
export function Md({ text }: { text: string }) {
  const out: ReactNode[] = []; const lines = text.split('\n'); let i = 0
  while (i < lines.length) {
    const l = lines[i]!
    if (l.startsWith('```')) { const buf: string[] = []; i++; while (i < lines.length && !lines[i]!.startsWith('```')) buf.push(lines[i++]!); i++; out.push(<pre key={i}>{buf.join('\n')}</pre>); continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(l); if (h) { const L = h[1]!.length; out.push(L === 1 ? <h2 key={i}>{h[2]}</h2> : L === 2 ? <h3 key={i}>{h[2]}</h3> : <h4 key={i}>{h[2]}</h4>); i++; continue }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, '')); out.push(<ul key={i}>{items.map((x, j) => <li key={j}>{x}</li>)}</ul>); continue }
    if (l.trim()) out.push(<p key={i}>{l}</p>); i++
  }
  return <div className="md">{out}</div>
}
