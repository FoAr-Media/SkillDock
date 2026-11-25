import { type A, useCall } from '../../shared/api'
import { Async, Badge } from '../../shared/ui'

const LABEL: Record<string, [string, 'ok' | 'bad' | 'warn']> = { connected: ['Connected', 'ok'], 'not-installed': ['Not installed', 'bad'], 'config-missing': ['Configuration missing', 'warn'], 'config-invalid': ['Configuration invalid', 'bad'], 'permission-required': ['Permission required', 'warn'] }
const HELP: Record<string, string> = {
  'claude-code': 'Install Claude Code from the official docs (https://code.claude.com/docs/). Skills and MCP management still work for the config files without it, but testing and plugin actions need the CLI.',
  git: 'Install Git (macOS: `xcode-select --install`). Needed only for your own tooling; GitHub installs here use the GitHub API, not git.',
  node: 'Install Node.js (https://nodejs.org). Needed by many npm-based MCP servers (`npx`).',
  npm: 'Comes with Node.js.', python: 'Install Python 3 if a skill ships Python scripts.', uv: 'Install uv (https://docs.astral.sh/uv/) to run Python MCP servers via `uvx`.',
  'claude-desktop': 'Optional. Claude Desktop is configured separately from Claude Code; this app does not modify its internal data.',
  'claude-config': 'Created by Claude Code on first run. Nothing is written here until you approve an operation.'
}
export function EnvTable() {
  const env = useCall<A[]>('env:detect')
  return (
    <Async r={env}>{(rows) => (
      <table className="table"><thead><tr><th>Component</th><th>Status</th><th>Details</th></tr></thead><tbody>
        {rows.map((t) => { const [l, k] = LABEL[t.status] ?? [t.status, 'warn']; return <tr key={t.id}><td>{t.label}</td><td><Badge kind={k}>{l}</Badge></td><td className="mono">{t.version ?? t.path ?? ''}{t.status !== 'connected' && <div className="note">{HELP[t.id]}</div>}</td></tr> })}
      </tbody></table>
    )}</Async>
  )
}
