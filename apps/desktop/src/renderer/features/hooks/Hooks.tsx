import { useState } from 'react'
import { type Go } from '../../app/nav'
import { type A, useCall } from '../../shared/api'
import { Async, Badge, Empty } from '../../shared/ui'

const HSTATUS: Record<string, ['ok' | 'warn' | 'bad' | 'neutral', string]> = { configured: ['ok', 'configured'], blocked: ['bad', 'blocked by policy'], disabled: ['warn', 'disabled'], inactive: ['neutral', 'plugin disabled'], 'trust-gated': ['warn', 'trust-gated'], 'on-demand': ['neutral', 'on demand'] }
const SOURCES: Record<string, string> = { 'user-settings': 'User settings', 'project-settings': 'Project settings', 'local-settings': 'Local settings', 'managed-settings': 'Managed settings', plugin: 'Plugins', 'skill-frontmatter': 'Skill frontmatter', 'agent-frontmatter': 'Agent frontmatter' }
export function Hooks({ go }: { go: Go }) {
  const r = useCall<A>('hooks:list'); const [src, setSrc] = useState('all'); const [st, setSt] = useState('all')
  return <div className="page"><h1>Hooks</h1>
    <div className="errorbox">⚠ Hooks run programs, call URLs, or invoke models automatically when Claude works. A hook can read files or send what Claude sees anywhere. Review every one. Warnings are static pattern matches, not a safety verdict, and a hook shown here is <b>configured</b>, not proven to have run.</div>
    <Async r={r}>{(d) => <>
      {d.policy.allowManagedHooksOnly && <div className="errorbox">Managed policy <code>allowManagedHooksOnly</code> is on: only managed hooks (and plugins your organization force-enables) run.</div>}
      {d.policy.strictPluginOnlyHooks && <div className="errorbox">Managed policy <code>strictPluginOnlyCustomization</code> locks <b>hooks</b>: user/project/local settings and skill/agent frontmatter hooks do not run.</div>}
      {d.policy.disableAllHooks.global === true && <div className="note">⚠ <code>disableAllHooks</code> is true in your effective settings: non-managed hooks are disabled. A project can override it (local › project › user).</div>}
      <p className="note">Sources read: user, project and local settings; managed settings (<code>managed-settings.json</code> + <code>managed-settings.d/</code>); plugin <code>hooks/hooks.json</code> and the manifest <code>hooks</code> key; skill, command and agent frontmatter. Interactive sessions also hold back settings hooks until you accept the workspace trust dialog for a folder; <code>claude -p</code> and SDK sessions do not ask.</p>
      <div className="toolbar"><select aria-label="Hook source" value={src} onChange={(e) => setSrc(e.target.value)}><option value="all">All sources</option>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Hook status" value={st} onChange={(e) => setSt(e.target.value)}><option value="all">Any status</option>{Object.entries(HSTATUS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select><span className="note">{d.hooks.filter((h: A) => (src === 'all' || h.source === src) && (st === 'all' || h.status === st)).length} of {d.hooks.length} hook(s)</span></div>
      {d.hooks.length === 0 ? <Empty>No hooks configured in any documented location.</Empty> :
      <table className="table"><thead><tr><th>Source</th><th>Event</th><th>Handler</th><th>Status</th><th>Warnings</th><th><span className="sr">Actions</span></th></tr></thead><tbody>
        {d.hooks.filter((h: A) => (src === 'all' || h.source === src) && (st === 'all' || h.status === st)).map((h: A) => <tr key={h.id}>
          <td>{h.label}{h.project && <div className="note trunc" title={h.project}>{h.project.split('/').slice(-1)[0]}</div>}</td>
          <td>{h.event}{h.matcher && <div className="note">matcher: {h.matcher}</div>}</td>
          <td><Badge kind="accent">{h.type}</Badge>{h.form && <Badge>{h.form} form</Badge>} <code>{h.summary}</code>{h.scriptFindings && <div className="note">{h.scriptFindings.map((f: A) => `${f.file}: ${f.messages.join('; ')}`).join(' | ')}</div>}</td>
          <td title={h.statusReason}><Badge kind={HSTATUS[h.status]?.[0]}>{HSTATUS[h.status]?.[1] ?? h.status}</Badge>{h.status !== 'configured' && <div className="note">{h.statusReason}</div>}</td>
          <td>{h.warnings.length ? h.warnings.map((w: string) => <Badge key={w} kind="warn">{w}</Badge>) : <Badge>none matched</Badge>}</td>
          <td>{['user', 'project', 'local'].includes(h.scope) && <button onClick={() => go('config', { select: h.file })}>Edit settings</button>}</td></tr>)}
      </tbody></table>}</>}</Async></div>
}
