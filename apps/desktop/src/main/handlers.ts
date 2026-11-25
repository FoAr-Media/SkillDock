import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import * as core from '@skilldock/core'

// ---------- app state ----------
app.setName('SkillDock') // fixes the userData folder and keychain service name regardless of how the app is launched
export const isE2E = !app.isPackaged && process.env['SKILLDOCK_E2E'] === '1'
const home = !app.isPackaged && process.env['SKILLDOCK_HOME'] ? process.env['SKILLDOCK_HOME'] : homedir()
const dataDir = !app.isPackaged && process.env['SKILLDOCK_DATA_DIR'] ? process.env['SKILLDOCK_DATA_DIR'] : app.getPath('userData')
const paths = core.claudePaths(home)
const managedDirs = !app.isPackaged && process.env['SKILLDOCK_MANAGED_DIR'] ? [process.env['SKILLDOCK_MANAGED_DIR']] : paths.managedDirs
const P: core.ClaudePaths = { ...paths, managedDirs }
const store = new core.Store(path.join(dataDir, 'skilldock.db'))
const tokenFile = path.join(dataDir, 'github-token.bin')
const ctx: core.Ctx = { backupRoot: path.join(dataDir, 'backups') }
/** Same classifier as the marketplace (name, path and description evidence; `metadata.category` wins when it names a known category). */
const skillCategories = (s: { name: string; description: string; dir: string }, meta: Record<string, unknown>) => { const categories = core.classify({ name: s.name, description: s.description, path: s.dir.split('/').slice(-2).join('/'), declared: typeof meta.category === 'string' ? meta.category : undefined }).categories; return { categories, category: categories[0] } }
const scanCache = new Map<string, core.SecurityStatus>()

async function ghToken(): Promise<string | undefined> {
  if (!app.isPackaged && process.env['SKILLDOCK_GH_TOKEN']) return process.env['SKILLDOCK_GH_TOKEN'] // dev/test only: raises the live-API rate limit
  try { return safeStorage.decryptString(await fs.readFile(tokenFile)) } catch { return undefined }
}
async function env(): Promise<core.InstallEnv> {
  const gh = core.defaultGh(await ghToken())
  if (!app.isPackaged && process.env['SKILLDOCK_GH_API']) { gh.apiBase = process.env['SKILLDOCK_GH_API']; gh.rawBase = process.env['SKILLDOCK_GH_RAW'] ?? gh.rawBase }
  return { ctx, store, paths: P, gh, stagingRoot: path.join(dataDir, 'staging'), plans }
}
const plans = new Map<string, core.Plan>()
void fs.rm(path.join(dataDir, 'staging'), { recursive: true, force: true }) // leftovers from a previous crash/quit
const registryBase = () => (!app.isPackaged && process.env['SKILLDOCK_REGISTRY'] ? process.env['SKILLDOCK_REGISTRY'] : undefined)

/**
 * Authoritative approval for anything that starts a process or spends the user's Claude usage.
 * The renderer's own confirm dialog only explains; a compromised renderer cannot skip THIS one.
 * E2E can set SKILLDOCK_E2E_NATIVE_CONFIRM=accept|deny (honoured only in unpackaged builds).
 */
async function nativeConfirm(title: string, detail: string): Promise<void> {
  const forced = !app.isPackaged ? process.env['SKILLDOCK_E2E_NATIVE_CONFIRM'] : undefined
  if (forced) { if (forced === 'accept') return; throw new Error('Cancelled: not approved in the system dialog') }
  const r = await dialog.showMessageBox(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]!, { type: 'warning', buttons: ['Cancel', 'Allow'], defaultId: 0, cancelId: 0, title, message: title, detail })
  if (r.response !== 1) throw new Error('Cancelled: not approved in the system dialog')
}
const describeCfg = (c: Record<string, unknown>) => c['url'] ? `Connect to ${String(c['url'])}` : `Run: ${String(c['command'])} ${(Array.isArray(c['args']) ? c['args'] : []).join(' ')}`
const projectArg = z.string().max(2000)
function registered(p: string): string {
  if (!store.projects().includes(p)) throw new Error('Project is not registered')
  return p
}
const Target = z.object({ scope: z.enum(['user', 'project']), project: projectArg.optional() })
const McpScope = z.enum(['user', 'local', 'project', 'managed'])
const McpCfg = z.record(z.string(), z.unknown())

async function findSkill(id: string) {
  const s = (await core.discoverSkills({ claudeDir: P.claudeDir, projects: store.projects() })).find((x) => x.id === id)
  if (!s) throw new Error('Unknown skill')
  return s
}
async function diffDirs(staging: string, target: string) {
  const list = async (d: string, rel = ''): Promise<Map<string, string>> => {
    const m = new Map<string, string>()
    for (const e of await fs.readdir(path.join(d, rel), { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) for (const [k, v] of await list(d, r)) m.set(k, v)
      else if (e.isFile()) m.set(r, core.sha256(await fs.readFile(path.join(d, r))))
    }
    return m
  }
  const a = await list(staging), b = await list(await fs.realpath(target).catch(() => target))
  const out: { path: string; status: 'add' | 'modify' | 'remove' | 'same' }[] = []
  for (const [k, v] of a) out.push({ path: k, status: !b.has(k) ? 'add' : b.get(k) === v ? 'same' : 'modify' })
  for (const k of b.keys()) if (!a.has(k)) out.push({ path: k, status: 'remove' })
  return out.sort((x, y) => (x.path < y.path ? -1 : 1))
}
async function planView(p: core.Plan) {
  const { stagingDir, ...rest } = p
  return { ...rest, changes: await diffDirs(stagingDir, p.targetDir), files: p.files, configChanges: [] as string[] }
}
const parseRepo = (s: string) => core.parseGithubUrl(s) ?? (() => { throw new Error('Enter a GitHub URL or owner/repo[/path]') })()

async function resolveAgentFile(id: string) {
  const a = (await core.listAgents(P, store.projects())).find((x) => x.id === id)
  if (!a) throw new Error('Unknown agent'); return a
}

// ---------- handlers ----------
type H = { schema: z.ZodType; fn: (arg: any) => unknown }
const h = <T extends z.ZodType>(schema: T, fn: (arg: z.infer<T>) => unknown): H => ({ schema, fn })
const none = z.undefined().or(z.null())
const id = z.object({ id: z.string().max(4000) })

export const handlers: Record<string, H> = {
  'app:info': h(none, () => ({ home, dataDir, version: app.getVersion(), platform: process.platform, arch: process.arch, e2e: isE2E })),
  'app:openExternal': h(z.object({ url: z.string().url() }), ({ url }) => { if (!/^https:\/\//.test(url)) throw new Error('Only https links can be opened'); return shell.openExternal(url) }),
  'app:openTerminal': h(z.object({ project: projectArg.optional() }), ({ project }) => {
    if (process.platform !== 'darwin') throw new Error('Open-in-terminal is currently macOS only; copy the command instead')
    execFile('open', ['-a', 'Terminal', project ? registered(project) : home]); return true
  }),
  'env:detect': h(none, () => core.detectEnvironment({ claudeDir: P.claudeDir, desktopAppPaths: ['/Applications/Claude.app', path.join(home, 'Applications/Claude.app')] })),

  'overview:get': h(none, async () => {
    await core.reconcileInstallations(await env())
    const projects = store.projects()
    const [skills, plugins, mcp, agents, hooks, incomplete, backups] = await Promise.all([
      core.discoverSkills({ claudeDir: P.claudeDir, projects }), core.listPlugins(P), core.listMcp(P, projects), core.listAgents(P, projects), core.listHooks(P, projects).then((r) => r.hooks),
      core.incompleteTransactions(ctx), core.listBackups(ctx)])
    const res = core.analyzeSkillNames(skills), nameConflicts = [...res.values()].filter((i) => i.status !== 'active' || i.conflicts.some((c) => c.kind === 'duplicate')).length + mcp.filter((m) => m.state.shadowedBy || m.state.shadowedInProjects?.length).length
    const mcpPending = mcp.filter((m) => m.state.status === 'pending').length
    let conflicts = 0
    for (const p of [undefined, ...projects]) conflicts += (await core.inheritance(P, p)).keys.filter((k) => k.conflict).length
    const updates = store.all<{ c: number }>(`SELECT COUNT(*) c FROM update_checks u JOIN installations i ON i.id=u.installation_id WHERE u.latest IS NOT NULL AND u.latest != i.version AND i.pinned=0`)[0]!.c
    const sec = store.pref('security.summary')
    return {
      counts: { skills: skills.filter((s) => s.scope !== 'legacy-command').length, userSkills: skills.filter((s) => s.scope === 'user').length, plugins: plugins.length, mcp: mcp.length, agents: agents.length, commands: skills.filter((s) => s.scope === 'legacy-command').length, hooks: hooks.length, projects: projects.length, updates, conflicts, nameConflicts, mcpPending },
      security: sec ? JSON.parse(sec) : null, incomplete, backupCount: backups.length,
      activity: store.all('SELECT * FROM audit_events ORDER BY id DESC LIMIT 30'), lastScan: new Date().toISOString()
    }
  }),
  'activity:list': h(none, () => store.all('SELECT * FROM audit_events ORDER BY id DESC LIMIT 500')),

  // ----- skills -----
  'skills:list': h(none, async () => {
    await core.reconcileInstallations(await env())
    const [skills, overrides] = await Promise.all([core.discoverSkills({ claudeDir: P.claudeDir, projects: store.projects() }), core.skillOverrides(P)])
    const inst = new Map(store.all<any>('SELECT i.*, u.latest FROM installations i LEFT JOIN update_checks u ON u.installation_id=i.id').map((r) => [r.target, r]))
    const resolution = core.analyzeSkillNames(skills)
    return skills.map((s) => {
      const r = inst.get(s.dir), meta = (s.frontmatter.metadata ?? {}) as Record<string, unknown>
      return { ...s, enabled: overrides[s.name] !== 'off', managed: !!r, version: r?.version ?? (meta.version as string | undefined), pinned: !!r?.pinned, updateAvailable: !!(r && r.latest && r.latest !== r.version && !r.pinned), installationId: r?.id, org: r?.org ?? undefined,
        source: s.source, installSource: r ? JSON.parse(r.source) : undefined, security: scanCache.get(s.dir) ?? 'not-inspected', ...skillCategories(s, meta), commands: resolution.get(s.id)!.names, nameStatus: resolution.get(s.id)!.status, nameConflicts: resolution.get(s.id)!.conflicts }
    })
  }),
  'skills:read': h(id, async ({ id }) => {
    const s = await findSkill(id), root = s.realPath ?? s.dir
    const raw = (await fs.readFile(s.skillFile, 'utf8')).slice(0, 200_000)
    const parsed = core.parseSkillMd(raw)
    const scan = s.scope === 'legacy-command' ? null : await core.scanDir(root)
    if (scan) scanCache.set(s.dir, scan.status)
    return { skill: s, raw, body: parsed.body, scan, fm: parsed.frontmatter }
  }),
  'skills:file': h(z.object({ id: z.string().max(4000), rel: z.string().max(500) }), async ({ id, rel }) => {
    return core.readSkillFile((await findSkill(id)).realPath ?? (await findSkill(id)).dir, rel)
  }),
  'skills:reveal': h(id, async ({ id }) => { shell.showItemInFolder((await findSkill(id)).skillFile) }),
  'skills:uninstall': h(id, async ({ id }) => { const s = await findSkill(id); return core.uninstallSkill(await env(), s.dir) }),
  'skills:setEnabled': h(z.object({ name: z.string().max(200), enabled: z.boolean() }), async (a) => { await core.setSkillEnabled(ctx, P, a.name, a.enabled); store.audit('skill.toggle', `${a.name} ${a.enabled ? 'enabled' : 'disabled'}`) }),
  'skills:export': h(id, async ({ id }) => {
    const s = await findSkill(id); const r = await dialog.showOpenDialog({ title: 'Export skill to folder', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    if (s.scope !== 'user' && s.scope !== 'project') throw new Error('Only user/project skills can be exported')
    const dest = await core.exportSkillDir(s.realPath ?? s.dir, r.filePaths[0], path.basename(s.dir))
    store.audit('skill.export', dest); return dest
  }),
  'skills:setPinned': h(z.object({ installationId: z.string(), pinned: z.boolean() }), async (a) => core.setPinned(await env(), a.installationId, a.pinned)),

  // ----- install plans -----
  'install:planGithub': h(z.object({ repo: z.string().max(500), ref: z.string().max(200).optional(), path: z.string().max(500).optional(), target: Target }), async (a) => {
    const g = parseRepo(a.repo)
    return planView(await core.planSkillInstall(await env(), { type: 'github', owner: g.owner, repo: g.repo, ref: a.ref || g.ref, path: a.path ?? g.path }, a.target))
  }),
  'install:planEntry': h(z.object({ entryId: z.string().max(1000), target: Target }), async (a) => {
    const row = store.get<{ json: string }>('SELECT json FROM marketplace_entries WHERE id=?', a.entryId)
    const e = row && (JSON.parse(row.json) as core.Entry); if (!e || e.type !== 'skill') throw new Error('Not an installable skill entry')
    if (!e.install.ok) throw new Error(e.install.reason ?? 'This entry cannot be installed automatically')
    if (e.local) return planView(await core.planSkillInstall(await env(), { type: 'local', dir: e.local.dir }, a.target))
    if (!e.repo) throw new Error('Not an installable skill entry')
    const plan = await core.planSkillInstall(await env(), { type: 'github', owner: e.repo.owner, repo: e.repo.repo, ref: e.commit, path: e.path ?? '' }, a.target)
    plan.source = { ...plan.source, ref: undefined } as core.SkillSource // install the reviewed commit, but keep tracking the default branch so updates are detectable
    return planView(plan)
  }),
  'install:planLocal': h(z.object({ target: Target }), async (a) => {
    const r = await dialog.showOpenDialog({ title: 'Choose a skill folder (contains SKILL.md)', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return planView(await core.planSkillInstall(await env(), { type: 'local', dir: r.filePaths[0] }, a.target))
  }),
  'install:planCopy': h(z.object({ skillId: z.string().max(4000), target: Target }), async (a) => {
    const s = await findSkill(a.skillId); if (s.scope === 'legacy-command') throw new Error('Commands cannot be copied as skills')
    return planView(await core.planSkillInstall(await env(), { type: 'local', dir: s.realPath ?? s.dir }, a.target, { dirName: path.basename(s.dir) }))
  }),
  'install:apply': h(z.object({ planId: z.string().max(64), overwrite: z.boolean().optional(), approveHighRisk: z.boolean().optional() }), async (a) => core.applySkillInstall(await env(), a.planId, a)),
  'install:cancel': h(z.object({ planId: z.string().max(64) }), async (a) => core.cancelPlan(await env(), a.planId)),

  // ----- marketplace -----
  'market:sources': h(none, () => {
    const rows = new Map(core.sourceRows(store).map((r) => [r.id, r])), builtin = new Set(core.BUILTIN_SOURCES.map((b) => b.id))
    const ids = [...new Set([...core.BUILTIN_SOURCES.map((b) => b.id), ...rows.keys()])]
    return ids.map((id) => { const r = rows.get(id); return { id, kind: r?.kind ?? 'github', official: r?.official ?? core.BUILTIN_SOURCES.find((b) => b.id === id)?.official ?? false, builtin: builtin.has(id), status: r?.status ?? 'never', error: r?.error, stars: r?.stars, archived: r?.archived ?? false, entryCount: r?.entryCount ?? 0, mode: r?.mode, verifiedAt: r?.verifiedAt, lastAttempt: r?.lastAttempt, stale: r?.stale ?? false, commit: r?.commit } })
  }),
  'market:featured': h(none, () => { const have = new Set(core.sourceRows(store).map((r) => r.id)); return core.FEATURED_SOURCES.map((f) => ({ ...f, added: have.has(f.id) })) }),
  'market:rateLimit': h(none, async () => { try { return await core.rateLimit((await env()).gh) } catch { return null } }),
  'market:refresh': h(z.object({ sourceId: z.string().max(300).optional(), force: z.boolean().optional() }), async ({ sourceId, force }) => {
    const e = await env(), ids = sourceId ? [sourceId] : core.BUILTIN_SOURCES.map((b) => b.id).concat(core.sourceRows(store).map((r) => r.id).filter((id) => !core.BUILTIN_SOURCES.some((b) => b.id === id)))
    const results = await core.refreshAll({ gh: e.gh, store }, ids, { force })
    store.audit('market.refresh', results.map((r) => `${r.id}:${r.ok ? `${r.count}${r.reused ? ' (cache)' : ''}` : r.skipped ? 'skipped' : 'error'}`).join(', '), results.every((r) => r.ok)); return results
  }),
  'market:addSource': h(z.object({ repo: z.string().max(300) }), async ({ repo }) => {
    const g = parseRepo(repo), id = `${g.owner}/${g.repo}`, e = await env(); const [r] = await core.refreshAll({ gh: e.gh, store }, [id], { ref: g.ref })
    if (!r!.ok) { if (!core.BUILTIN_SOURCES.some((b) => b.id === id)) core.removeSource(store, id); throw new Error(r!.error) }
    store.audit('market.addSource', `${id} (${r!.count} entries, ${r!.mode})`); return { id, count: r!.count, mode: r!.mode }
  }),
  'market:addLocalSource': h(none, async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose a folder that contains skills', properties: ['openDirectory'] }); if (r.canceled || !r.filePaths[0]) return null
    const d = await core.discoverLocalDir({ gh: (await env()).gh, store }, r.filePaths[0]); store.audit('market.addLocalSource', `${r.filePaths[0]} (${d.entries.length} skills)`); return { count: d.entries.length }
  }),
  'market:removeSource': h(z.object({ id: z.string().max(400) }), ({ id }) => { if (core.BUILTIN_SOURCES.some((s) => s.id === id)) throw new Error('Built-in sources cannot be removed'); core.removeSource(store, id) }),
  'market:findSources': h(z.object({ topic: z.string().max(60).optional(), q: z.string().max(100).optional(), minStars: z.number().int().min(0).max(10_000_000).optional() }), async (a) => {
    const have = new Set(core.sourceRows(store).map((r) => r.id)); return (await core.searchGithubRepos((await env()).gh, a)).map((c) => ({ ...c, added: have.has(c.fullName) }))
  }),
  'market:categories': h(none, () => Object.keys(core.CATEGORIES)),
  'market:facets': h(none, () => core.facets(store)),
  'market:query': h(z.object({ q: z.string().max(200).optional(), type: z.enum(['skill', 'plugin', 'mcp']).optional(), category: z.string().optional(), license: z.string().optional(), os: z.string().optional(), official: z.boolean().optional(), complexity: z.enum(['simple', 'moderate', 'complex']).optional(), installed: z.boolean().optional(), minStars: z.number().optional(), sort: z.enum(['stars', 'updated', 'relevance', 'added', 'activity', 'compatibility']).optional(), source: z.string().max(400).optional(), excludeArchived: z.boolean().optional(), hasScripts: z.boolean().optional(), installableOnly: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() }), async (q) => {
    const skills = await core.discoverSkills({ claudeDir: P.claudeDir, projects: store.projects() }), plugins = await core.listPlugins(P), mcp = await core.listMcp(P, store.projects())
    const names = new Set([...skills.map((s) => s.name), ...plugins.map((p) => p.name), ...mcp.map((m) => m.name)])
    const r = core.searchEntries(store, { limit: 60, ...q }, names); return { total: r.total, items: r.items.map((e) => ({ ...e, installed: names.has(e.name) })) }
  }),
  'market:registry': h(z.object({ q: z.string().max(200) }), async ({ q }) => core.searchRegistry({ gh: (await env()).gh, store, registryBase: registryBase() }, q)),
  'market:entry': h(z.object({ entryId: z.string().max(1000) }), async ({ entryId }) => {
    const d = await core.entryDetail({ gh: (await env()).gh, store }, entryId), e = d.entry
    const skills = e.type === 'skill' ? await core.discoverSkills({ claudeDir: P.claudeDir, projects: store.projects() }) : []
    const recs = store.all<any>('SELECT * FROM installations WHERE kind=?', 'skill').filter((r) => { try { const s = JSON.parse(r.source); return s.type === 'github' && e.repo && s.owner === e.repo.owner && s.repo === e.repo.repo && (s.path ?? '') === (e.path ?? '') } catch { return false } })
    const sameName = skills.filter((s) => s.name === e.name).map((s) => ({ scope: s.scope, dir: s.dir, source: s.source }))
    return { ...d, installed: { byApp: recs.map((r) => ({ id: r.id, version: r.version, scope: r.scope, project: r.project, target: r.target, pinned: !!r.pinned, current: r.version === e.commit })), sameName } }
  }),
  // ----- MCP -----
  'mcp:list': h(none, () => core.listMcp(P, store.projects())),
  'mcp:save': h(z.object({ scope: McpScope, project: projectArg.optional(), name: z.string(), originalName: z.string().optional(), config: McpCfg, expectedHash: z.string().optional() }), async (a) => {
    const r = await core.saveMcp(ctx, P, store.projects(), { ...a, config: a.config as core.McpConfig }); store.audit('mcp.save', `${a.scope}/${a.name}`); return { diff: core.unifiedDiff('config', r.before, r.after) }
  }),
  'mcp:delete': h(z.object({ scope: McpScope, project: projectArg.optional(), name: z.string(), expectedHash: z.string().optional() }), async (a) => { await core.deleteMcp(ctx, P, store.projects(), a); store.audit('mcp.delete', `${a.scope}/${a.name}`) }),
  'mcp:test': h(z.object({ scope: McpScope, project: projectArg.optional(), name: z.string(), approved: z.literal(true) }), async (a) => {
    const s = (await core.listMcp(P, store.projects())).find((x) => x.name === a.name && x.scope === a.scope && x.project === a.project); if (!s) throw new Error('Server not found')
    const raw = await core.readRawServer(P, s)
    await nativeConfirm(`Start MCP server “${a.name}”?`, `${describeCfg(raw as Record<string, unknown>)}\n\nOnly its tools/resources/prompts will be listed. No tool will be called.`)
    const d = await core.testMcp(raw, { approved: true }); store.audit('mcp.test', `${a.scope}/${a.name}: ${d.handshake ? 'handshake ok' : 'failed'}`, !!d.handshake); return d
  }),
  'mcp:testDraft': h(z.object({ config: McpCfg, approved: z.literal(true) }), async (a) => {
    await nativeConfirm('Start this MCP server?', `${describeCfg(a.config)}\n\nOnly its tools/resources/prompts will be listed. No tool will be called.`)
    return core.testMcp(a.config as core.McpConfig, { approved: true })
  }),
  'mcp:export': h(z.object({ scope: McpScope, project: projectArg.optional(), name: z.string() }), async (a) => {
    const s = (await core.listMcp(P, store.projects())).find((x) => x.name === a.name && x.scope === a.scope && x.project === a.project); if (!s) throw new Error('Server not found')
    return { mcpServers: { [a.name]: core.exportWithoutSecrets(await core.readRawServer(P, s)) } }
  }),
  'mcp:copy': h(z.object({ from: z.object({ scope: McpScope, project: projectArg.optional(), name: z.string() }), to: z.object({ scope: McpScope, project: projectArg.optional() }) }), async ({ from, to }) => {
    const s = (await core.listMcp(P, store.projects())).find((x) => x.name === from.name && x.scope === from.scope && x.project === from.project); if (!s) throw new Error('Server not found')
    await core.saveMcp(ctx, P, store.projects(), { scope: to.scope, project: to.project, name: from.name, config: await core.readRawServer(P, s) }); store.audit('mcp.copy', `${from.name}: ${from.scope} → ${to.scope}`)
  }),
  'mcp:import': h(z.object({ json: z.string().max(200_000), scope: McpScope, project: projectArg.optional() }), async (a) => {
    const j = JSON.parse(a.json), servers = (j.mcpServers ?? j) as Record<string, unknown>; const names: string[] = []
    for (const [name, cfg] of Object.entries(servers)) { await core.saveMcp(ctx, P, store.projects(), { scope: a.scope, project: a.project, name, config: cfg as core.McpConfig }); names.push(name) }
    store.audit('mcp.import', `${names.join(', ')} → ${a.scope}`); return names
  }),

  // ----- projects -----
  'projects:list': h(none, async () => Promise.all(store.projects().map(async (p) => ({ path: p, exists: await core.exists(p), isGit: await core.exists(path.join(p, '.git')) })))),
  'projects:add': h(none, async () => {
    const r = await dialog.showOpenDialog({ title: 'Register a project folder', properties: ['openDirectory'] }); if (r.canceled || !r.filePaths[0]) return null
    return addProject(r.filePaths[0])
  }),
  'projects:addPath': h(z.object({ path: z.string().max(2000) }), async ({ path: p }) => { if (!isE2E) throw new Error('Not available'); return addProject(p) }),
  'projects:remove': h(z.object({ path: projectArg }), ({ path: p }) => { store.run('DELETE FROM projects WHERE path=?', p); store.audit('project.remove', p) }),
  'projects:overview': h(z.object({ path: projectArg }), ({ path: p }) => core.projectOverview(P, registered(p))),
  'inheritance:get': h(z.object({ project: projectArg.optional() }), ({ project }) => core.inheritance(P, project ? registered(project) : undefined)),

  // ----- config -----
  'config:files': h(none, () => core.configFiles(P, store.projects())),
  'config:read': h(id, async ({ id }) => { const f = await core.resolveConfigFile(P, store.projects(), id); const j = await core.readJsonFile(f.path); return { file: f, text: j.text, hash: j.hash, error: f.kind === 'json' ? j.error : undefined } }),
  'config:preview': h(z.object({ id: z.string(), text: z.string().max(2_000_000) }), async ({ id, text }) => {
    const f = await core.resolveConfigFile(P, store.projects(), id); let error: string | undefined
    if (f.kind === 'json') { try { JSON.parse(text) } catch (e) { error = (e as Error).message } }
    return { diff: core.unifiedDiff(path.basename(f.path), await fs.readFile(f.path, 'utf8').catch(() => ''), text), error }
  }),
  'config:save': h(z.object({ id: z.string(), text: z.string().max(2_000_000), hash: z.string() }), async ({ id, text, hash }) => {
    const f = await core.resolveConfigFile(P, store.projects(), id); if (f.readOnly) throw new Error('This file is managed by your organization/system and is read-only')
    await core.saveText(ctx, f.path, text, `config ${path.basename(f.path)}`, hash, { json: f.kind === 'json' }); store.audit('config.save', f.path)
  }),

  // ----- backups -----
  'backups:list': h(none, () => core.listBackups(ctx)),
  'backups:restore': h(z.object({ id: z.string().max(100) }), async ({ id }) => { await core.restoreBackup(ctx, id); store.audit('backup.restore', id) }),
  'backups:incomplete': h(none, () => core.incompleteTransactions(ctx)),
  'backups:resolve': h(z.object({ id: z.string().max(100), action: z.enum(['rollback', 'keep']) }), async (a) => { await core.resolveIncomplete(ctx, a.id, a.action); store.audit('transaction.recover', `${a.id} ${a.action}`) }),

  // ----- plugins / agents / hooks / commands -----
  'plugins:list': h(none, () => core.listPlugins(P)),
  'plugins:action': h(z.object({ action: z.enum(['install', 'enable', 'disable', 'uninstall']), id: z.string().max(200) }), async (a) => { await nativeConfirm(`Run: claude plugin ${a.action} ${a.id}`, 'Plugins can contain hooks and MCP servers that execute programs on your computer.'); const out = await core.pluginCli(P, a.action, a.id); store.audit(`plugin.${a.action}`, a.id); return out }),
  'plugins:addMarketplace': h(z.object({ source: z.string().regex(/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/) }), async ({ source }) => { await nativeConfirm(`Run: claude plugin marketplace add ${source}`, 'Adds a plugin marketplace to your Claude Code configuration.'); return new Promise<string>((res, rej) => execFile('claude', ['plugin', 'marketplace', 'add', source], { env: { ...process.env, HOME: home }, timeout: 120_000 }, (e, so, se) => (e ? rej(core.cliError(Object.assign(e, { stderr: se }))) : res(so)))) }),
  'agents:list': h(none, () => core.listAgents(P, store.projects())),
  'agents:read': h(id, async ({ id }) => { const a = await resolveAgentFile(id); const text = await fs.readFile(a.file, 'utf8'); return { agent: a, text, hash: core.sha256(text) } }),
  'agents:save': h(z.object({ id: z.string(), text: z.string().max(500_000), hash: z.string() }), async (a) => { const ag = await resolveAgentFile(a.id); if (ag.scope === 'plugin') throw new Error('Plugin agents are read-only'); await core.saveText(ctx, ag.file, a.text, `agent ${ag.name}`, a.hash); store.audit('agent.save', ag.file) }),
  'agents:create': h(z.object({ scope: z.enum(['user', 'project']), project: projectArg.optional(), name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), description: z.string().min(1).max(1000), prompt: z.string().min(1).max(50_000), tools: z.string().regex(/^[^\r\n]{0,500}$/).optional(), model: z.string().regex(/^[^\r\n]{0,100}$/).optional() }), async (a) => {
    const dir = a.scope === 'user' ? path.join(P.claudeDir, 'agents') : path.join(registered(a.project ?? ''), '.claude', 'agents'), file = core.safeJoin(dir, `${a.name}.md`)
    if (await core.exists(file)) throw new Error('An agent with this name already exists')
    const fm = [`name: ${a.name}`, `description: ${JSON.stringify(a.description)}`, a.tools && `tools: ${a.tools}`, a.model && `model: ${a.model}`].filter(Boolean).join('\n')
    await core.saveText(ctx, file, `---\n${fm}\n---\n\n${a.prompt}\n`, `agent create ${a.name}`); store.audit('agent.create', file); return file
  }),
  'config:health': h(none, () => core.configHealth(P, store.projects())),
  'hooks:list': h(none, () => core.listHooks(P, store.projects())),
  'commands:list': h(none, () => core.listCommands(P, store.projects())),

  // ----- studio -----
  'studio:templates': h(none, () => core.TEMPLATES),
  'studio:generate': h(z.object({ name: z.string().max(64), description: z.string().max(1024), purpose: z.string().optional(), triggers: z.string().optional(), instructions: z.string().max(100_000), workflows: z.array(z.string()).optional(), dependencies: z.array(z.string()).optional(), references: z.array(z.object({ name: z.string().regex(/^[\w.-]+$/), content: z.string() })).optional(), scripts: z.array(z.object({ name: z.string().regex(/^[\w.-]+$/), content: z.string() })).optional(), exampleInputs: z.array(z.string()).optional(), expectedOutputs: z.array(z.string()).optional() }), (w) => core.generateSkill(w)),
  'studio:diff': h(z.object({ name: z.string().max(200), before: z.string().max(1_000_000), after: z.string().max(1_000_000) }), (a) => core.unifiedDiff(a.name, a.before, a.after)),
  'studio:validate': h(z.object({ files: z.record(z.string(), z.string()) }), ({ files }) => core.validateSkill(files)),
  'studio:load': h(id, async ({ id }) => { const s = await findSkill(id); return { dir: s.dir, name: path.basename(s.dir), scope: s.scope, project: s.source, files: await core.loadSkillFiles(await env(), s.dir) } }),
  'studio:save': h(z.object({ target: Target, dirName: z.string().max(64), files: z.record(z.string().max(300), z.string().max(1_000_000)), overwrite: z.boolean().optional(), deleted: z.array(z.string().max(300)).max(500).optional() }), async (a) => core.saveSkillFiles(await env(), a.target, a.dirName, a.files, a)),
  'studio:cases': h(z.object({ skillId: z.string() }), async (a) => core.getCases(await env(), a.skillId)),
  'studio:setCases': h(z.object({ skillId: z.string(), cases: z.array(z.object({ id: z.string(), prompt: z.string(), expectedBehavior: z.string(), expectedFormat: z.string().optional(), requiredTools: z.array(z.string()).optional(), criteria: z.array(z.string()).optional() })) }), async (a) => core.setCases(await env(), a.skillId, a.cases)),
  'studio:evaluate': h(z.object({ files: z.record(z.string(), z.string()), cases: z.array(z.object({ id: z.string(), prompt: z.string(), expectedBehavior: z.string(), expectedFormat: z.string().optional(), requiredTools: z.array(z.string()).optional(), criteria: z.array(z.string()).optional() })) }), (a) => core.evaluateCases(a.files, a.cases)),
  'studio:runClaude': h(z.object({ prompt: z.string().min(1).max(10_000), approved: z.literal(true) }), async (a) => { await nativeConfirm('Run this prompt with Claude?', `This uses your Claude plan/API usage.\n\nPrompt: ${a.prompt.slice(0, 500)}`); const r = await core.runWithClaude(home, a.prompt, a); store.audit('studio.runClaude', `cost ${r.costUsd ?? '?'}`); return { result: r.result, costUsd: r.costUsd } }),
  'studio:export': h(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), files: z.record(z.string(), z.string()) }), async (a) => {
    const r = await dialog.showOpenDialog({ title: 'Export skill to folder', properties: ['openDirectory', 'createDirectory'] }); if (r.canceled || !r.filePaths[0]) return null
    return core.exportSkill(a.files, r.filePaths[0], a.name)
  }),

  // ----- orgs / presets / updates -----
  'orgs:list': h(none, async () => { const e = await env(); return core.listCatalogs(e).map((c) => ({ ...c, installed: core.orgInstalled(e, c.id) })) }),
  'orgs:connect': h(z.object({ kind: z.enum(['url', 'github', 'file']), value: z.string().max(1000) }), async (a) => core.loadCatalog(await env(), a.kind === 'url' ? { kind: 'url', url: a.value } : a.kind === 'github' ? { kind: 'github', spec: a.value } : { kind: 'file', path: a.value })),
  'orgs:connectFile': h(none, async () => { const r = await dialog.showOpenDialog({ title: 'Choose a catalog JSON', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] }); if (r.canceled || !r.filePaths[0]) return null; return core.loadCatalog(await env(), { kind: 'file', path: r.filePaths[0] }) }),
  'orgs:disconnect': h(z.object({ id: z.string() }), async ({ id }) => core.disconnectCatalog(await env(), id)),
  'orgs:plan': h(z.object({ orgId: z.string(), resourceId: z.string(), target: Target }), async (a) => planView(await core.planOrgResource(await env(), a.orgId, a.resourceId, a.target))),
  'presets:list': h(none, async () => core.listPresets(await env())),
  'presets:save': h(z.object({ id: z.string().regex(/^[\w-]{1,64}$/), name: z.string().max(100), description: z.string().max(500), items: z.array(z.object({ label: z.string(), source: z.object({ owner: z.string(), repo: z.string(), ref: z.string().optional(), path: z.string() }) })) }), async (a) => core.savePreset(await env(), a)),
  'presets:delete': h(z.object({ id: z.string() }), async ({ id }) => core.deletePreset(await env(), id)),
  'presets:plan': h(z.object({ id: z.string(), target: Target }), async (a) => { const r = await core.planPreset(await env(), a.id, a.target); return { plans: await Promise.all(r.plans.map(planView)), errors: r.errors } }),
  'updates:check': h(none, async () => { const r = await core.checkUpdates(await env()); store.audit('updates.check', `${r.filter((x) => x.available).length} available`); return r }),
  'updates:plan': h(z.object({ installationId: z.string() }), async (a) => planView(await core.planUpdate(await env(), a.installationId))),

  // ----- security -----
  'security:scanAll': h(none, async () => {
    const skills = (await core.discoverSkills({ claudeDir: P.claudeDir, projects: store.projects() })).filter((s) => s.scope !== 'legacy-command')
    const rows = await Promise.all(skills.map(async (s) => { const r = await core.scanDir(s.realPath ?? s.dir).catch(() => null); if (r) scanCache.set(s.dir, r.status); return { id: s.id, name: s.name, scope: s.scope, dir: s.dir, status: r?.status ?? 'not-inspected', high: r?.findings.filter((f) => f.severity === 'high').length ?? 0, review: r?.findings.filter((f) => f.severity === 'review').length ?? 0, scripts: r?.scripts.length ?? 0 } }))
    const hooks = (await core.listHooks(P, store.projects())).hooks
    const summary = { at: new Date().toISOString(), skills: rows.length, high: rows.filter((r) => r.status === 'high-risk').length, review: rows.filter((r) => r.status === 'review-recommended').length, hooks: hooks.length, hookWarnings: hooks.filter((x) => x.warnings.length).length }
    store.setPref('security.summary', JSON.stringify(summary)); return { summary, rows, hooks }
  }),

  // ----- settings -----
  'settings:get': h(none, async () => ({ theme: store.pref('theme') ?? 'dark', density: store.pref('density') ?? 'comfortable', sidebarCollapsed: store.pref('sidebarCollapsed') === '1', autoUpdateCheck: store.pref('autoUpdateCheck') === '1', hasToken: !!(await ghToken()), onboarded: store.pref('onboarded') === '1', tokenStorage: safeStorage.isEncryptionAvailable() ? 'os-keychain' : 'unavailable', telemetry: 'never' })),
  'settings:set': h(z.object({ theme: z.enum(['system', 'dark', 'light']).optional(), density: z.enum(['comfortable', 'compact']).optional(), sidebarCollapsed: z.boolean().optional(), autoUpdateCheck: z.boolean().optional(), onboarded: z.boolean().optional() }), (a) => { if (a.theme) store.setPref('theme', a.theme); if (a.density) store.setPref('density', a.density); if (a.sidebarCollapsed !== undefined) store.setPref('sidebarCollapsed', a.sidebarCollapsed ? '1' : '0'); if (a.onboarded !== undefined) store.setPref('onboarded', a.onboarded ? '1' : '0'); if (a.autoUpdateCheck !== undefined) store.setPref('autoUpdateCheck', a.autoUpdateCheck ? '1' : '0') }),
  'settings:setToken': h(z.object({ token: z.string().min(10).max(500) }), async ({ token }) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable; refusing to store the token in plain text')
    await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(tokenFile, safeStorage.encryptString(token), { mode: 0o600 }); store.audit('settings.token', 'GitHub token saved')
  }),
  'settings:clearToken': h(none, async () => { await fs.rm(tokenFile, { force: true }); store.audit('settings.token', 'GitHub token removed') })
}

async function addProject(dir: string) {
  await core.validateProjectDir(dir); const real = await fs.realpath(dir)
  store.run('INSERT OR IGNORE INTO projects(path,added_at) VALUES (?,?)', real, new Date().toISOString()); store.audit('project.add', real); return real
}
