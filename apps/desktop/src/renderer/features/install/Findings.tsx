import { type A } from '../../shared/api'
import { Badge } from '../../shared/ui'

/** Findings grouped by rule + file (a docs file mentioning URLs 40 times is one line, not 40). Highest severity first. */
export function Findings({ findings }: { findings: A[] }) {
  const sev = { high: 0, review: 1, info: 2 } as Record<string, number>
  const g = new Map<string, A>(); for (const f of findings) { const k = `${f.rule}|${f.file}`; const x = g.get(k) ?? { ...f, lines: [] as number[] }; if (f.line) x.lines.push(f.line); g.set(k, x) }
  const rows = [...g.values()].sort((a, b) => sev[a.severity]! - sev[b.severity]! || (a.file < b.file ? -1 : 1))
  const count = (s: string) => findings.filter((f) => f.severity === s).length
  return <><h4>Findings ({findings.length}: {count('high')} high · {count('review')} review · {count('info')} info) <small>grouped by rule and file; advisory pattern matches in docs are common</small></h4>
    <ul className="findings">{rows.slice(0, 80).map((f, i) => <li key={i}><Badge kind={f.severity === 'high' ? 'bad' : f.severity === 'review' ? 'warn' : 'neutral'}>{f.severity}</Badge> {f.message} <code>{f.file}</code>{f.lines.length > 0 && <small> {f.lines.length > 1 ? `×${f.lines.length} · lines ${f.lines.slice(0, 6).join(', ')}${f.lines.length > 6 ? '…' : ''}` : `line ${f.lines[0]}`}</small>}</li>)}{rows.length > 80 && <li className="note">…and {rows.length - 80} more groups</li>}</ul></>
}
