import { useState } from 'react'
import { type Go } from '../../app/nav'
import { type A, call, useCall } from '../../shared/api'
import { Async, Badge, useUi } from '../../shared/ui'

export function Settings({ onChanged }: { go: Go; onChanged: () => void }) {
  const { notify, confirm } = useUi(); const s = useCall<A>('settings:get'); const info = useCall<A>('app:info'); const [token, setToken] = useState('')
  const set = async (p: A) => { await call('settings:set', p); s.reload(); onChanged() }
  return <div className="page"><h1>Settings</h1><Async r={s}>{(d) => <>
    <label className="field">Theme<select aria-label="Theme" value={d.theme} onChange={(e) => set({ theme: e.target.value })}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
    <label className="field">Density<select aria-label="Density" value={d.density} onChange={(e) => set({ density: e.target.value })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
    <label className="check"><input type="checkbox" checked={d.autoUpdateCheck} onChange={(e) => set({ autoUpdateCheck: e.target.checked })} /> Remind me to check for skill updates (updates are never applied automatically)</label>
    <h2>GitHub access</h2><p className="note">A token raises the rate limit and unlocks private repositories. It is encrypted with your OS keychain ({d.tokenStorage}) and never sent to the interface or stored in the database. Use a fine-grained, read-only token.</p>
    {d.hasToken ? <div className="actions"><Badge kind="ok">token stored</Badge><button className="danger" onClick={async () => { if (await confirm({ title: 'Remove GitHub token?', danger: true, confirmLabel: 'Remove', body: <p>Private catalogs will stop working.</p> })) { await call('settings:clearToken'); s.reload() } }}>Remove token</button></div>
      : <div className="toolbar"><input type="password" aria-label="GitHub token" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /><button className="primary" disabled={token.length < 10} onClick={async () => { try { await call('settings:setToken', { token }); setToken(''); notify('ok', 'Token stored securely'); s.reload() } catch (e) { notify('err', (e as Error).message) } }}>Save token</button></div>}
    <h2>Privacy</h2><ul><li>Telemetry: <b>{d.telemetry}</b> (none exists).</li><li>Network use: only GitHub (skills, catalogs), the MCP Registry, and servers you approve testing.</li><li>No account, no backend.</li></ul>
    <h2>About</h2>{info.data && <dl><dt>Version</dt><dd>{info.data.version}</dd><dt>Platform</dt><dd>{info.data.platform}/{info.data.arch}</dd><dt>Claude home</dt><dd>{info.data.home}</dd><dt>App data</dt><dd>{info.data.dataDir}</dd></dl>}
    <p className="note">SkillDock is an independent, community-driven open-source project and is not an official Anthropic application.</p>
    <button onClick={async () => { await call('settings:set', { onboarded: false }); s.reload(); onChanged() }}>Show welcome scan again</button></>}</Async></div>
}
