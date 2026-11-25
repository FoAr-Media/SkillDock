import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readJsonFile } from './config'
import { safeJoin } from './fsutil'
import { managedSettingsFiles, mergeManaged } from './managed'
import { projectKeyFor } from './mcp'
import type { ClaudePaths } from './paths'
import { scanText } from './security'
import { discoverSkills } from './skills'
import { listAgents, listPlugins } from './workspace'

export type HookSource = 'user-settings' | 'project-settings' | 'local-settings' | 'managed-settings' | 'plugin' | 'skill-frontmatter' | 'agent-frontmatter'
/**
 * Configuration-level status (NOT proof a hook ran):
 * configured · blocked (allowManagedHooksOnly / strictPluginOnlyCustomization) · disabled (disableAllHooks) · inactive (plugin disabled)
 * · trust-gated (project hook; held back interactively until the workspace is trusted, but `claude -p` runs it) · on-demand (skill/agent frontmatter)
 */
export type HookStatus = 'configured' | 'blocked' | 'disabled' | 'inactive' | 'trust-gated' | 'on-demand'
export interface HookEntry {
  id: string; source: HookSource; scope: 'user' | 'project' | 'local' | 'managed' | 'plugin' | 'skill' | 'agent'; label: string; file: string; project?: string; owner?: string
  event: string; matcher?: string; type: string; summary: string; command?: string; args?: string[]; form?: 'exec' | 'shell'; url?: string
  warnings: string[]; scriptFindings?: { file: string; messages: string[] }[]
  status: HookStatus; statusReason: string
}
export interface HooksReport {
  hooks: HookEntry[]
  policy: { allowManagedHooksOnly: boolean; strictPluginOnlyHooks: boolean; disableAllHooks: { global?: boolean; byProject: Record<string, boolean | undefined> }; managedFiles: string[] }
}

const WARN: [RegExp, string][] = [[/curl|wget|https?:\/\//i, 'network access'], [/\brm\s|sudo|chmod|mv\s/i, 'modifies files/permissions'], [/\|\s*(ba)?sh|eval|base64/i, 'dynamic execution'], [/\.ssh|\.aws|token|secret|password/i, 'touches credentials']]
const isObj = (o: unknown): o is Record<string, any> => !!o && typeof o === 'object' && !Array.isArray(o)
const events = (o: unknown): Record<string, any[]> => { if (!isObj(o)) return {}; const h = isObj(o.hooks) ? o.hooks : o; return Object.fromEntries(Object.entries(h).filter(([, v]) => Array.isArray(v))) as Record<string, any[]> }
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

async function scriptFindings(command: string, args: string[], bases: Record<string, string | undefined>): Promise<{ file: string; messages: string[] }[]> {
  const out: { file: string; messages: string[] }[] = []
  for (const m of `${command} ${args.join(' ')}`.matchAll(/\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR)\}([^\s"'`;|&)]*)/g)) {
    const base = bases[m[1]!]; const rel = (m[2] ?? '').replace(/^\/+/, ''); if (!base || !rel) continue
    try {
      const f = safeJoin(base, rel), st = await fs.lstat(f)
      if (!st.isFile() || st.isSymbolicLink() || st.size > 256 * 1024) continue
      const msgs = [...new Set(scriptFindingsText(rel, await fs.readFile(f, 'utf8')))]
      if (msgs.length) out.push({ file: rel, messages: msgs.slice(0, 4) })
    } catch { /* outside the base, missing, or unreadable: not inspected */ }
  }
  return out
}
const scriptFindingsText = (rel: string, text: string) => scanText(rel, text).filter((f) => f.severity !== 'info').map((f) => f.message)

interface Origin { source: HookSource; scope: HookEntry['scope']; label: string; file: string; project?: string; owner?: string; pluginId?: string; pluginRoot?: string; projectDir?: string }

async function build(o: Origin, evs: Record<string, any[]>): Promise<HookEntry[]> {
  const out: HookEntry[] = []; let n = 0
  for (const [event, groups] of Object.entries(evs)) for (const g of groups) {
    if (!isObj(g)) continue
    for (const h of Array.isArray(g.hooks) ? g.hooks : []) {
      if (!isObj(h)) continue
      const type = String(h.type ?? 'command'); const warnings: string[] = []
      let summary = '', command: string | undefined, args: string[] | undefined, form: 'exec' | 'shell' | undefined, url: string | undefined, findings: HookEntry['scriptFindings']
      if (type === 'command') {
        command = String(h.command ?? ''); args = Array.isArray(h.args) ? h.args.map(String) : undefined; form = args ? 'exec' : 'shell'
        summary = args ? [command, ...args].join(' ') : command
        for (const [re, w] of WARN) if (re.test(summary)) warnings.push(w)
        findings = await scriptFindings(command, args ?? [], { CLAUDE_PLUGIN_ROOT: o.pluginRoot, CLAUDE_PROJECT_DIR: o.projectDir })
        for (const f of findings) warnings.push(`script ${f.file}: ${f.messages[0]}`)
      } else if (type === 'http') {
        url = String(h.url ?? ''); summary = `POST ${url}`
        try { const u = new URL(url); if (!LOCAL_HOSTS.has(u.hostname)) warnings.push(`sends event data to ${u.hostname}`); if (u.protocol === 'http:') warnings.push('plain HTTP') } catch { warnings.push('invalid URL') }
        if (Array.isArray(h.allowedEnvVars) && h.allowedEnvVars.length) warnings.push(`passes env vars into headers: ${h.allowedEnvVars.join(', ')}`)
      } else if (type === 'mcp_tool') summary = `MCP tool ${String(h.tool ?? '?')} on ${String(h.server ?? '?')}`
      else if (type === 'prompt') { summary = `Prompt: ${String(h.prompt ?? '').slice(0, 120)}`; warnings.push('uses your Claude usage') }
      else if (type === 'agent') { summary = `Agent: ${String(h.prompt ?? '').slice(0, 120)}`; warnings.push('spawns a subagent that can use tools (experimental)'); warnings.push('uses your Claude usage') }
      else summary = `(${type})`
      out.push({ id: `${o.source}|${o.file}|${event}|${n++}`, source: o.source, scope: o.scope, label: o.label, file: o.file, project: o.project, owner: o.owner, event, matcher: typeof g.matcher === 'string' ? g.matcher : undefined,
        type, summary, command, args, form, url, warnings, scriptFindings: findings?.length ? findings : undefined, status: 'configured', statusReason: 'Defined in configuration.' })
      ;(out[out.length - 1] as HookEntry & { _o?: Origin })._o = o
    }
  }
  return out
}

/** Hooks from every location the docs list, with the policy/trust state that decides whether each can run. */
export async function listHooks(paths: ClaudePaths, projects: string[]): Promise<HooksReport> {
  const mfiles = await managedSettingsFiles(paths), managed = mergeManaged(mfiles)
  const user = (await readJsonFile(paths.userSettings)).data
  const uj: Record<string, any> = (await readJsonFile(paths.userJson)).data
  const all: HookEntry[] = []
  all.push(...await build({ source: 'user-settings', scope: 'user', label: 'User settings', file: paths.userSettings }, events(user.hooks)))
  for (const f of mfiles) all.push(...await build({ source: 'managed-settings', scope: 'managed', label: `Managed ${path.basename(f.file)}`, file: f.file }, events(f.data.hooks)))
  const projCtx = new Map<string, { trusted: boolean; shared: Record<string, any>; local: Record<string, any> }>()
  for (const p of projects) {
    const k = await projectKeyFor(uj, p)
    const shared = (await readJsonFile(path.join(p, '.claude', 'settings.json'))).data, local = (await readJsonFile(path.join(p, '.claude', 'settings.local.json'))).data
    projCtx.set(p, { trusted: uj.projects?.[k]?.hasTrustDialogAccepted === true, shared, local })
    all.push(...await build({ source: 'project-settings', scope: 'project', label: 'Project settings', file: path.join(p, '.claude', 'settings.json'), project: p, projectDir: p }, events(shared.hooks)))
    all.push(...await build({ source: 'local-settings', scope: 'local', label: 'Local settings', file: path.join(p, '.claude', 'settings.local.json'), project: p, projectDir: p }, events(local.hooks)))
  }
  const plugins = await listPlugins(paths)
  for (const pl of plugins) {
    if (!pl.installPath) continue
    const root = pl.installPath, origin = (file: string): Origin => ({ source: 'plugin', scope: 'plugin', label: `Plugin ${pl.id}`, file, owner: pl.id, pluginId: pl.id, pluginRoot: root })
    const hj = await readJsonFile(path.join(root, 'hooks', 'hooks.json')); if (hj.exists) all.push(...await build(origin(path.join(root, 'hooks', 'hooks.json')), events(hj.data)))
    const mf = path.join(root, '.claude-plugin', 'plugin.json'), manifest = (await readJsonFile(mf)).data
    for (const item of ([] as unknown[]).concat(manifest.hooks ?? [])) { // path, inline object, or array of either; loads together with hooks/hooks.json
      if (typeof item === 'string') { try { const f = safeJoin(root, item.replace(/^\.\//, '')); const j = await readJsonFile(f); if (j.exists) all.push(...await build(origin(f), events(j.data))) } catch { /* path escapes plugin root: ignored */ } }
      else if (isObj(item)) all.push(...await build(origin(mf), events(item)))
    }
  }
  const fm = (kind: 'skill' | 'agent', owner: string, scope: 'user' | 'project' | 'plugin', file: string, project: string | undefined, hooks: unknown, pluginRoot?: string, pluginId?: string) =>
    build({ source: kind === 'skill' ? 'skill-frontmatter' : 'agent-frontmatter', scope: kind, label: `${kind === 'skill' ? 'Skill' : 'Agent'} “${owner}”${scope === 'plugin' ? ` (${pluginId})` : scope === 'project' ? ' (project)' : ''}`, file, project: scope === 'project' ? project : undefined, owner, pluginRoot, pluginId, projectDir: scope === 'project' ? project : undefined }, events(hooks))
  for (const s of await discoverSkills({ claudeDir: paths.claudeDir, projects })) {
    if (!isObj(s.frontmatter.hooks)) continue
    const pl = s.scope === 'plugin' ? plugins.find((p) => p.id === s.source) : undefined
    all.push(...await fm('skill', s.name, s.scope === 'plugin' ? 'plugin' : s.scope === 'project' ? 'project' : 'user', s.skillFile, s.source, s.frontmatter.hooks, pl?.installPath, pl?.id))
  }
  for (const a of await listAgents(paths, projects)) if (isObj(a.hooks)) {
    const pl = a.scope === 'plugin' ? plugins.find((p) => p.id === a.project) : undefined
    all.push(...await fm('agent', a.name, a.scope, a.file, a.project, a.hooks, pl?.installPath, pl?.id))
  }

  // ---- policy + status
  const strictRaw = managed.strictPluginOnlyCustomization, strictHooks = strictRaw === true || (Array.isArray(strictRaw) && strictRaw.includes('hooks'))
  const allowManagedOnly = managed.allowManagedHooksOnly === true
  const eff = (...layers: Record<string, any>[]): boolean | undefined => layers.find((l) => typeof l.disableAllHooks === 'boolean')?.disableAllHooks
  const dGlobal = eff(managed, user), byProject: Record<string, boolean | undefined> = {}
  for (const p of projects) { const c = projCtx.get(p)!; byProject[p] = eff(managed, c.local, c.shared, user) }
  const forceEnabled = (id?: string) => !!id && isObj(managed.enabledPlugins) && managed.enabledPlugins[id] === true
  for (const h of all) {
    const o = (h as HookEntry & { _o?: Origin })._o!; delete (h as { _o?: Origin })._o
    const pluginHook = h.source === 'plugin' || ((h.source === 'skill-frontmatter' || h.source === 'agent-frontmatter') && !!o.pluginId)
    const dis = h.scope === 'managed' ? managed.disableAllHooks === true : (h.project ? byProject[h.project] : dGlobal) === true
    const plugin = o.pluginId ? plugins.find((p) => p.id === o.pluginId) : undefined
    if (allowManagedOnly && h.scope !== 'managed' && !(pluginHook && forceEnabled(o.pluginId))) { h.status = 'blocked'; h.statusReason = 'Blocked by managed policy allowManagedHooksOnly: only managed and force-enabled plugin hooks run.'; continue }
    if (strictHooks && (['user-settings', 'project-settings', 'local-settings'].includes(h.source) || ((h.source === 'skill-frontmatter' || h.source === 'agent-frontmatter') && !o.pluginId))) { h.status = 'blocked'; h.statusReason = 'Blocked by managed policy strictPluginOnlyCustomization (hooks): only managed and plugin hooks run.'; continue }
    if (dis) { h.status = 'disabled'; h.statusReason = h.scope === 'managed' ? 'Managed settings set disableAllHooks.' : 'disableAllHooks is true after settings precedence (local › project › user; managed hooks are unaffected).'; continue }
    if (plugin && !plugin.enabled) { h.status = 'inactive'; h.statusReason = `Plugin ${plugin.id} is disabled; its hooks load only when it is enabled.`; continue }
    const trusted = h.project ? projCtx.get(h.project)?.trusted : undefined
    if (h.project && trusted === false && h.scope !== 'plugin') { h.status = 'trust-gated'; h.statusReason = 'This folder has not accepted the workspace trust dialog: interactive sessions hold the hook back, but `claude -p` / SDK sessions run it without asking. Review it before scripting over this repository.'; if (h.source === 'project-settings' || h.source === 'local-settings') h.warnings.unshift('committed to a repository you have not trusted'); continue }
    if (h.source === 'skill-frontmatter' || h.source === 'agent-frontmatter') { h.status = 'on-demand'; h.statusReason = h.source === 'skill-frontmatter' ? 'Registered only after the skill is invoked; removed when the conversation is cleared.' : 'Registered only while that subagent is running.'; continue }
  }
  return { hooks: all, policy: { allowManagedHooksOnly: allowManagedOnly, strictPluginOnlyHooks: strictHooks, disableAllHooks: { global: dGlobal, byProject }, managedFiles: mfiles.map((f) => f.file) } }
}
