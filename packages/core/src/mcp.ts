import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readJsonFile, updateJson } from './config'
import { exists } from './fsutil'
import { managedSettingsFiles } from './managed'
import type { Ctx } from './backup'
import type { ClaudePaths } from './paths'

export const MASK = '••••••••'
export type McpScope = 'user' | 'local' | 'project' | 'managed'

export const McpConfigSchema = z.object({
  type: z.enum(['stdio', 'http', 'sse']).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().url().refine((u) => /^https?:/.test(u), 'must be http(s)').optional(),
  headers: z.record(z.string(), z.string()).optional()
}).passthrough().refine((c) => (c.type === 'http' || c.type === 'sse' ? !!c.url : !!c.command || !!c.url), 'stdio needs a command; http/sse needs a url')
export type McpConfig = z.infer<typeof McpConfigSchema>
export const NameSchema = z.string().regex(/^[A-Za-z0-9][\w.-]{0,63}$/, 'letters, digits, . _ - only')

/**
 * Configuration decision for a server, mirroring `claude mcp list` statuses. NOT proof of a live connection.
 * Rules (code.claude.com/docs/en/mcp "Project server approvals and workspace trust", settings-reference):
 *  - .mcp.json servers need approval: enabledMcpjsonServers / enableAllProjectMcpServers from user or managed settings always count;
 *    from the project's shared or local settings they count only once the workspace is trusted (projects[path].hasTrustDialogAccepted).
 *  - disabledMcpjsonServers in ANY settings file rejects, and beats approval.
 *  - ~/.claude.json projects[path].disabledMcpServers turns a server off for that project.
 *  - Same name in several scopes: local > project > user; the winning entry is used whole (not merged).
 */
export type McpStatus = 'approved' | 'pending' | 'rejected' | 'disabled' | 'managed' | 'not-required'
export interface McpState {
  status: McpStatus; reason: string
  /** approval/rejection came only from per-project arrays observed in ~/.claude.json (not in the current docs) */
  observedOnly?: boolean
  shadowedBy?: McpScope; shadowedInProjects?: string[]; disabledInProjects?: string[]
}
export interface McpServer {
  name: string; scope: McpScope; project?: string; file: string; fileHash: string; readOnly: boolean
  transport: 'stdio' | 'http' | 'sse'; command?: string; args: string[]; url?: string
  envKeys: string[]; headerKeys: string[]; config: McpConfig // config has secrets masked
  state: McpState
}

const SENSITIVE_ARG = /^(--?[\w-]*(token|key|secret|password|auth)[\w-]*)=(.+)$/i
const maskRecord = (r?: Record<string, string>) => r && Object.fromEntries(Object.keys(r).map((k) => [k, MASK]))
function maskUrl(u?: string) { if (!u) return u; try { const x = new URL(u); x.password = x.password ? 'xxxx' : ''; for (const k of [...x.searchParams.keys()]) if (/token|key|secret|auth|sig/i.test(k)) x.searchParams.set(k, 'xxxx'); return x.toString() } catch { return u } }
export function maskConfig(c: McpConfig): McpConfig {
  return { ...c, args: c.args?.map((a) => a.replace(SENSITIVE_ARG, `$1=${MASK}`)), env: maskRecord(c.env), headers: maskRecord(c.headers), url: maskUrl(c.url) }
}
/** Replace MASK placeholders in an edited config with the stored values so editing never wipes secrets. */
export function unmaskConfig(edited: McpConfig, original?: McpConfig): McpConfig {
  const out = { ...edited }
  for (const k of ['env', 'headers'] as const) if (edited[k]) out[k] = Object.fromEntries(Object.entries(edited[k]!).map(([n, v]) => [n, v === MASK ? (original?.[k]?.[n] ?? '') : v]))
  if (edited.args) out.args = edited.args.map((a, i) => (a.includes(MASK) ? (original?.args?.[i] ?? a) : a))
  if (edited.url?.includes('xxxx') && original?.url) out.url = original.url
  return out
}
const transportOf = (c: McpConfig): McpServer['transport'] => (c.type === 'http' || c.type === 'sse' ? c.type : c.url && !c.command ? 'http' : 'stdio')

/** Claude keys ~/.claude.json projects by the folder path it ran in; match ours by realpath so /var vs /private/var or symlinked folders still line up. */
export async function projectKeyFor(userJson: Record<string, any>, project: string): Promise<string> {
  const entries = (userJson.projects ?? {}) as Record<string, unknown>
  if (project in entries) return project
  const real = await fs.realpath(project).catch(() => project)
  for (const k of Object.keys(entries)) if ((await fs.realpath(k).catch(() => k)) === real) return k
  return project
}

export async function listMcp(paths: ClaudePaths, projects: string[]): Promise<McpServer[]> {
  const out: McpServer[] = []
  const push = (file: string, fileHash: string, scope: McpScope, servers: any, project?: string) => {
    for (const [name, raw] of Object.entries(servers ?? {})) {
      const c = raw as McpConfig
      if (!c || typeof c !== 'object') continue
      out.push({ state: { status: 'not-required', reason: '' }, name, scope, project, file, fileHash, readOnly: scope === 'managed', transport: transportOf(c), command: c.command, args: maskConfig(c).args ?? [], url: maskUrl(c.url), envKeys: Object.keys(c.env ?? {}), headerKeys: Object.keys(c.headers ?? {}), config: maskConfig(c) })
    }
  }
  const uj = await readJsonFile(paths.userJson)
  push(paths.userJson, uj.hash, 'user', uj.data.mcpServers)
  for (const p of projects) {
    push(paths.userJson, uj.hash, 'local', (uj.data.projects as any)?.[await projectKeyFor(uj.data, p)]?.mcpServers, p)
    const pj = await readJsonFile(path.join(p, '.mcp.json'))
    push(path.join(p, '.mcp.json'), pj.hash, 'project', pj.data.mcpServers, p)
  }
  for (const d of paths.managedDirs) { const m = await readJsonFile(path.join(d, 'managed-mcp.json')); push(path.join(d, 'managed-mcp.json'), m.hash, 'managed', m.data.mcpServers) }
  await computeStates(paths, projects, uj.data, out)
  return out
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
async function computeStates(paths: ClaudePaths, projects: string[], userJson: Record<string, any>, servers: McpServer[]) {
  const user = (await readJsonFile(paths.userSettings)).data
  const managed = (await managedSettingsFiles(paths)).map((f) => f.data) // managed-settings.json + managed-settings.d/*.json
  const ctx = new Map<string, { trusted: boolean; shared: Record<string, any>; local: Record<string, any>; entry: Record<string, any> }>()
  for (const p of projects) { const k = await projectKeyFor(userJson, p); ctx.set(p, { trusted: userJson.projects?.[k]?.hasTrustDialogAccepted === true, shared: (await readJsonFile(path.join(p, '.claude', 'settings.json'))).data, local: (await readJsonFile(path.join(p, '.claude', 'settings.local.json'))).data, entry: userJson.projects?.[k] ?? {} }) }
  const RANK: Record<string, number> = { local: 0, project: 1, user: 2 }
  for (const s of servers) {
    const c = s.project ? ctx.get(s.project) : undefined
    if (s.scope === 'managed') { s.state = { status: 'managed', reason: 'Provided by your organization; read-only here.' }; continue }
    if (s.scope === 'user') {
      const inProj = [...ctx].filter(([, v]) => strs(v.entry.disabledMcpServers).includes(s.name)).map(([p]) => p)
      const shadowed = servers.filter((o) => o.name === s.name && o.project && (o.scope === 'local' || o.scope === 'project')).map((o) => o.project!)
      s.state = { status: 'not-required', reason: 'User-scoped servers need no approval.', disabledInProjects: inProj, shadowedInProjects: [...new Set(shadowed)] }
      if (s.state.shadowedInProjects!.length) s.state.reason += ` In ${s.state.shadowedInProjects!.length} registered project(s) a local/project server with the same name takes precedence (entries are not merged).`
      continue
    }
    if (!c) continue
    const winner = servers.filter((o) => o.name === s.name && o.project === s.project && RANK[o.scope]! < RANK[s.scope]!)[0]
    const disabled = strs(c.entry.disabledMcpServers).includes(s.name)
    if (s.scope === 'local') { s.state = { status: disabled ? 'disabled' : 'not-required', reason: disabled ? 'Disabled for this project (re-enable via /mcp in Claude Code).' : 'Local servers need no approval.' }; continue }
    // project scope (.mcp.json)
    const layers: { name: string; data: Record<string, any>; counts: boolean }[] = [
      ...managed.map((d) => ({ name: 'managed settings', data: d, counts: true })), { name: 'user settings', data: user, counts: true },
      { name: 'project settings.local.json', data: c.local, counts: c.trusted }, { name: 'project settings.json (shared)', data: c.shared, counts: c.trusted }]
    const approves = (d: Record<string, any>) => d.enableAllProjectMcpServers === true || strs(d.enabledMcpjsonServers).includes(s.name)
    const rejectedBy = [...layers, { name: 'project settings.local.json', data: c.local, counts: true }, { name: 'project settings.json (shared)', data: c.shared, counts: true }].find((l) => strs(l.data.disabledMcpjsonServers).includes(s.name))
    const approvedBy = layers.find((l) => l.counts && approves(l.data))
    const ignored = layers.find((l) => !l.counts && approves(l.data))
    const obsApprove = strs(c.entry.enabledMcpjsonServers).includes(s.name), obsReject = strs(c.entry.disabledMcpjsonServers).includes(s.name)
    let st: McpState
    if (rejectedBy) st = { status: 'rejected', reason: `Rejected by disabledMcpjsonServers in ${rejectedBy.name}.` }
    else if (obsReject) st = { status: 'rejected', observedOnly: true, reason: 'Listed in disabledMcpjsonServers inside ~/.claude.json for this project (observed storage, not in current docs).' }
    else if (approvedBy) st = { status: 'approved', reason: `Approved via ${approvedBy.name}.` }
    else if (obsApprove) st = { status: 'approved', observedOnly: true, reason: 'Listed in enabledMcpjsonServers inside ~/.claude.json for this project (observed storage, not in current docs).' }
    else st = { status: 'pending', reason: ignored ? `Approval found in ${ignored.name} is ignored until the workspace is trusted: run \`claude\` in the project and accept the trust dialog.` : 'Not approved yet: run `claude` in this project to review and approve it. (`claude -p`, SDK and cloud sessions load project servers without asking.)' }
    if (st.status === 'approved' && disabled) st = { status: 'disabled', reason: 'Approved, but disabled for this project (re-enable via /mcp in Claude Code).' }
    if (winner) st.shadowedBy = winner.scope
    s.state = st
  }
}

function fileFor(paths: ClaudePaths, scope: McpScope, project?: string, key?: string): { file: string; get: (d: any, create: boolean) => Record<string, any> } {
  if (scope === 'managed') throw new Error('Managed MCP configuration is read-only')
  if (scope === 'user') return { file: paths.userJson, get: (d) => (d.mcpServers ??= {}) }
  if (!project) throw new Error('project required')
  if (scope === 'project') return { file: path.join(project, '.mcp.json'), get: (d) => (d.mcpServers ??= {}) }
  return { file: paths.userJson, get: (d) => (((d.projects ??= {})[key ?? project] ??= {}).mcpServers ??= {}) }
}

export interface McpWrite { scope: McpScope; project?: string; name: string; originalName?: string; config: McpConfig; expectedHash?: string }
export async function saveMcp(ctx: Ctx, paths: ClaudePaths, registered: string[], w: McpWrite) {
  NameSchema.parse(w.name); const cfg0 = McpConfigSchema.parse(w.config)
  if (w.project && !registered.includes(w.project)) throw new Error('Project is not registered')
  const { file, get } = fileFor(paths, w.scope, w.project, w.scope === 'local' && w.project ? await projectKeyFor((await readJsonFile(paths.userJson)).data, w.project) : undefined)
  return updateJson(ctx, file, `mcp save ${w.name}`, (d) => {
    const servers = get(d, true), prev = servers[w.originalName ?? w.name]
    if (w.originalName !== w.name && servers[w.name]) throw new Error(`A server named ${w.name} already exists in this scope`)
    if (w.originalName && w.originalName !== w.name) delete servers[w.originalName]
    servers[w.name] = unmaskConfig(cfg0, prev)
  }, w.expectedHash)
}
export async function deleteMcp(ctx: Ctx, paths: ClaudePaths, registered: string[], w: { scope: McpScope; project?: string; name: string; expectedHash?: string }) {
  if (w.project && !registered.includes(w.project)) throw new Error('Project is not registered')
  const { file, get } = fileFor(paths, w.scope, w.project, w.scope === 'local' && w.project ? await projectKeyFor((await readJsonFile(paths.userJson)).data, w.project) : undefined)
  return updateJson(ctx, file, `mcp delete ${w.name}`, (d) => { const s = get(d, false); if (!(w.name in s)) throw new Error('Server not found'); delete s[w.name] }, w.expectedHash)
}
/** Shareable config: secrets replaced by ${NAME} placeholders. Works from the real (unmasked) config. */
export function exportWithoutSecrets(c: McpConfig): McpConfig {
  const ph = (r?: Record<string, string>) => r && Object.fromEntries(Object.keys(r).map((k) => [k, `\${${k.toUpperCase().replace(/[^A-Z0-9]/g, '_')}}`]))
  return { ...c, env: ph(c.env), headers: ph(c.headers), args: c.args?.map((a) => a.replace(SENSITIVE_ARG, '$1=${SECRET}')), url: maskUrl(c.url) }
}
export async function readRawServer(paths: ClaudePaths, s: Pick<McpServer, 'file' | 'scope' | 'project' | 'name'>): Promise<McpConfig> {
  const d = (await readJsonFile(s.file)).data as any
  const servers = s.scope === 'local' ? d.projects?.[await projectKeyFor(d, s.project!)]?.mcpServers : d.mcpServers
  if (!servers?.[s.name]) throw new Error('Server not found')
  return servers[s.name]
}

// ---------- diagnostics ----------
export interface McpDiagnostic {
  configValid: boolean; dependency: { ok: boolean; detail: string }
  reachable?: boolean; handshake?: boolean; authRequired?: boolean
  serverInfo?: { name?: string; version?: string }
  tools: { name: string; description?: string }[]; resources: string[]; prompts: string[]
  error?: string; logs: string[]; ranAt: string
  /** A successful test here is NOT evidence that Claude itself loaded this server. */
  claudeRuntime: 'unknown'
}

async function which(cmd: string, env = process.env): Promise<string | null> {
  if (cmd.includes(path.sep)) return (await exists(cmd)) ? cmd : null
  for (const d of (env.PATH ?? '').split(path.delimiter)) { const p = path.join(d, cmd); if (await fs.access(p, fs.constants.X_OK).then(() => true, () => false)) return p }
  return null
}

const redact = (s: string, secrets: string[]) => secrets.filter((x) => x.length > 3).reduce((a, x) => a.split(x).join(MASK), s)

/** Starts the server process / opens the connection. Caller MUST have obtained user approval (`approved`). Lists only; never calls tools. */
export async function testMcp(config: McpConfig, opts: { approved: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<McpDiagnostic> {
  if (!opts.approved) throw new Error('Approval required before starting an MCP server')
  const d: McpDiagnostic = { configValid: false, dependency: { ok: true, detail: '' }, tools: [], resources: [], prompts: [], logs: [], ranAt: new Date().toISOString(), claudeRuntime: 'unknown' }
  const parsed = McpConfigSchema.safeParse(config)
  if (!parsed.success) { d.error = parsed.error.issues.map((i) => i.message).join('; '); return d }
  d.configValid = true
  const c = parsed.data, secrets = [...Object.values(c.env ?? {}), ...Object.values(c.headers ?? {})]
  const t = transportOf(c)
  let transport: StdioClientTransport | StreamableHTTPClientTransport
  if (t === 'stdio') {
    const bin = await which(c.command!, opts.env ?? process.env)
    d.dependency = bin ? { ok: true, detail: `${c.command} → ${bin}` } : { ok: false, detail: `${c.command} not found on PATH` }
    if (!bin) { d.error = d.dependency.detail; return d }
    transport = new StdioClientTransport({ command: bin, args: c.args ?? [], env: { ...(Object.fromEntries(Object.entries(opts.env ?? process.env).filter(([, v]) => v !== undefined)) as Record<string, string>), ...(c.env ?? {}) }, stderr: 'pipe' })
    transport.stderr?.on('data', (b: Buffer) => { if (d.logs.length < 50) d.logs.push(redact(b.toString().trim(), secrets)) })
  } else {
    if (t === 'sse') { d.error = 'Legacy SSE transport testing is not supported; use Streamable HTTP'; return d }
    transport = new StreamableHTTPClientTransport(new URL(c.url!), { requestInit: { headers: c.headers ?? {} } })
  }
  const client = new Client({ name: 'skilldock', version: '0.1.0' })
  const timer = setTimeout(() => { void client.close() }, opts.timeoutMs ?? 15_000)
  try {
    await client.connect(transport)
    d.reachable = true; d.handshake = true
    const v = client.getServerVersion(); d.serverInfo = { name: v?.name, version: v?.version }
    const caps = client.getServerCapabilities() ?? {}
    if (caps.tools) d.tools = (await client.listTools()).tools.map((x) => ({ name: x.name, description: x.description }))
    if (caps.resources) d.resources = (await client.listResources()).resources.map((x) => x.uri)
    if (caps.prompts) d.prompts = (await client.listPrompts()).prompts.map((x) => x.name)
  } catch (e) {
    const msg = redact((e as Error).message, secrets)
    d.error = msg; d.authRequired = /401|403|unauthori[sz]ed|forbidden/i.test(msg)
    d.reachable = d.reachable ?? (t === 'http' ? !/ENOTFOUND|ECONNREFUSED|fetch failed|timed? ?out/i.test(msg) : undefined)
    d.handshake = d.handshake ?? false
  } finally { clearTimeout(timer); await client.close().catch(() => {}) }
  return d
}
