import { useState } from 'react'
import { type Go } from '../../app/nav'
import { type A, call } from '../../shared/api'
import { Badge, Empty, secKind, secLabel, useUi } from '../../shared/ui'

export function Security({ go }: { go: Go }) {
  const { notify } = useUi(); const [r, setR] = useState<A>(); const [busy, setBusy] = useState(false)
  const scan = async () => { setBusy(true); try { setR(await call('security:scanAll')); notify('ok', 'Scan complete') } catch (e) { notify('err', (e as Error).message) } finally { setBusy(false) } }
  return <div className="page"><h1>Security</h1>
    <p className="note">Local, read-only static analysis of installed skills (scripts, network calls, credential references, obfuscation, binaries) and hooks. Results are <b>advisory</b>: a clean result is not a guarantee of safety, and findings are not proof of malice. Third-party content is never executed by this app.</p>
    <div className="toolbar"><button className="primary" disabled={busy} onClick={scan}>{busy ? 'Scanning…' : 'Scan installed skills & hooks'}</button></div>
    {!r ? <Empty>Not inspected yet. Run a scan.</Empty> : <>
      <section className="cards"><div className="card static"><b>{r.summary.skills}</b><span>skills inspected</span></div><div className="card static"><b>{r.summary.high}</b><span>high-risk behavior</span></div><div className="card static"><b>{r.summary.review}</b><span>review recommended</span></div><div className="card static"><b>{r.summary.hookWarnings}/{r.summary.hooks}</b><span>hooks with warnings</span></div></section>
      <table className="table"><thead><tr><th>Skill</th><th>Source</th><th>Status</th><th>High</th><th>Review</th><th>Scripts</th><th><span className="sr">Actions</span></th></tr></thead><tbody>{[...r.rows].sort((a: A, b: A) => b.high - a.high || b.review - a.review).map((x: A) => <tr key={x.id}><td><b>{x.name}</b></td><td>{x.scope}</td><td><Badge kind={secKind(x.status)}>{secLabel(x.status)}</Badge></td><td>{x.high}</td><td>{x.review}</td><td>{x.scripts}</td><td><button onClick={() => go('skills', { select: x.id })}>Details</button></td></tr>)}</tbody></table></>}
    <h2>Policy &amp; safeguards in effect</h2><ul><li>Renderer is sandboxed with context isolation, no Node, strict CSP, validated IPC, blocked navigation.</li><li>Downloads are size-limited, path-validated, symlink-free and staged outside Claude's directories.</li><li>High-risk plans need explicit approval; MCP servers only start after approval and tools are never called.</li><li>Secrets are masked in the interface; the GitHub token is kept in the OS keychain; no telemetry.</li></ul></div>
}
