import { useState } from 'react'
import { Compass, PencilRuler, PlugZap } from 'lucide-react'
import { type Go } from '../../app/nav'
import { ConfigHealth } from '../config/ConfigHealth'
import { EnvTable } from '../environment/EnvTable'
import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, ago, useUi } from '../../shared/ui'

export function Overview({ go }: { go: Go }) {
  const { notify } = useUi(); const o = useCall<A>('overview:get'); const [env, setEnv] = useState(0); const [checking, setChecking] = useState(false)
  const check = async () => { setChecking(true); try { const r = await call<A[]>('updates:check'); notify('ok', `${r.filter((x) => x.available).length} update(s) available`); o.reload() } catch (e) { notify('err', (e as Error).message) } finally { setChecking(false) } }
  return (
    <div className="page">
      <h1>Overview</h1>
      <ConfigHealth />
      <section className="getstarted" aria-label="Get started"><button onClick={() => go('marketplace')}><Compass size={20} aria-hidden="true" /><b>Find a skill</b><span>Browse public skills, plugins and MCP servers, with a preview of every change.</span></button><button onClick={() => go('mcp', { add: true })}><PlugZap size={20} aria-hidden="true" /><b>Connect a tool</b><span>Add an MCP server so Claude can use your apps and data.</span></button><button onClick={() => go('studio')}><PencilRuler size={20} aria-hidden="true" /><b>Create your own skill</b><span>Start from a template and check it before you save.</span></button></section>
      <Async r={o}>{(d) => (
        <>
          {d.incomplete.length > 0 && <div className="errorbox" role="alert">⚠ {d.incomplete.length} operation(s) did not finish last time. <button onClick={() => go('backups')}>Review & recover</button></div>}
          <section className="cards">
            {([['Skills', d.counts.skills, 'skills'], ['Plugins', d.counts.plugins, 'plugins'], ['MCP servers', d.counts.mcp, 'mcp'], ['Agents', d.counts.agents, 'agents'], ['Commands', d.counts.commands, 'commands'], ['Hooks', d.counts.hooks, 'hooks'], ['Projects', d.counts.projects, 'projects'], ['Updates available', d.counts.updates, 'skills'], ['Config conflicts', d.counts.conflicts, 'config'], ['Name conflicts', d.counts.nameConflicts, 'skills'], ['MCP pending approval', d.counts.mcpPending, 'mcp'],
              ['Security findings', d.security ? d.security.high + d.security.review : '—', 'security']] as [string, A, string][]).map(([l, v, p]) => <button className="card" key={l} onClick={() => go(p)}><b>{v}</b><span>{l}</span></button>)}
          </section>
          <div className="two">
            <section>
              <h2>Quick actions</h2>
              <div className="actions">
                <button onClick={() => go('marketplace')}>Install a skill</button><button onClick={() => go('mcp', { add: true })}>Add MCP server</button><button onClick={() => go('studio')}>Create skill</button>
                <button onClick={() => go('marketplace', { importRepo: true })}>Import GitHub repository</button><button onClick={() => go('projects', { add: true })}>Register project</button>
                <button onClick={() => { o.reload(); setEnv((n) => n + 1); notify('info', 'Rescanned') }}>Scan configurations</button><button disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check updates'}</button>
                <button onClick={() => go('backups')}>Restore backup</button><button onClick={() => void call('app:openTerminal', {}).catch((e: Error) => notify('err', e.message))}>Open Claude Code (Terminal)</button>
              </div>
              <h2>Environment health</h2>
              <EnvTable key={env} />
              <p className="note">Last scan {ago(d.lastScan)}. Claude's files are authoritative; this view is re-read from disk each time.</p>
            </section>
            <section>
              <h2>Recent activity</h2>
              {d.activity.length === 0 ? <p className="empty">No activity yet. Installs, edits, restores and failures will show here.</p> :
                <ul className="activity">{d.activity.slice(0, 12).map((a: A) => <li key={a.id}><Badge kind={a.ok ? 'ok' : 'bad'}>{a.ok ? 'ok' : 'failed'}</Badge> <b>{a.action}</b> <span>{a.detail}</span><small>{ago(a.ts)}</small></li>)}</ul>}
              <button onClick={() => go('activity')}>All activity</button>
            </section>
          </div>
        </>
      )}</Async>
    </div>
  )
}
