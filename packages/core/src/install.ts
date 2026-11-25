import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { runTransaction, type Ctx } from './backup'
import { copyTree, exists, hashTree, safeJoin } from './fsutil'
import { stageGithubDir, resolveRef, repoInfo, type GhConfig, type GhSpec } from './github'
import { scanDir, type Finding, type SecurityStatus } from './security'
import { parseSkillMd } from './skill-parse'
import { discoverSkills } from './skills'
import { analyzeSkillNames, type NameConflict, type NameInfo } from './names'
import type { ClaudePaths } from './paths'
import type { Store } from './store'

export type SkillSource = ({ type: 'github' } & GhSpec) | { type: 'local'; dir: string }
export interface Target { scope: 'user' | 'project'; project?: string }
export interface InstallEnv {
  ctx: Ctx; store: Store; paths: ClaudePaths; gh: GhConfig; stagingRoot: string
  plans: Map<string, Plan>
  hooks?: { afterCopy?: () => Promise<void> | void } // test seam for rollback
}
export type Conflict = 'none' | 'exists-managed' | 'exists-modified' | 'exists-foreign'
export interface Plan {
  id: string; name: string; source: SkillSource; target: Target; targetDir: string; stagingDir: string
  files: { path: string; size: number }[]; findings: Finding[]; security: SecurityStatus; scripts: string[]
  conflict: Conflict; /** hash of the existing target when the plan was made (null = absent): approval is refused if it changed since */ targetSnapshot: string | null; version?: string; treeHash: string; description: string; skipped: string[]; org?: string
  /** How this skill's command names would resolve against what is already installed (documented precedence). */
  names: string[]; nameStatus: NameInfo['status']; nameConflicts: NameConflict[]
}

const DIRNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const installId = (targetDir: string) => createHash('sha1').update(targetDir).digest('hex').slice(0, 16)

export function skillsBase(env: InstallEnv, t: Target): string {
  if (t.scope === 'user') return path.join(env.paths.claudeDir, 'skills')
  if (!t.project || !env.store.projects().includes(t.project)) throw new Error('Target project is not registered')
  return path.join(t.project, '.claude', 'skills')
}

/** Steps 2–10 of the lifecycle: stage, validate, inspect, detect conflicts. Writes only inside stagingRoot. */
export async function planSkillInstall(env: InstallEnv, source: SkillSource, target: Target, opts: { dirName?: string; org?: string } = {}): Promise<Plan> {
  const id = randomBytes(6).toString('hex'), stagingDir = path.join(env.stagingRoot, id)
  let version: string | undefined, skipped: string[] = []
  try {
    if (source.type === 'github') { const r = await stageGithubDir(env.gh, source, stagingDir); version = r.commit; skipped = r.skipped }
    else { await copyTree(source.dir, stagingDir, { followRootLink: true }) }
    if (!(await exists(path.join(stagingDir, 'SKILL.md')))) throw new Error('Not a skill: no SKILL.md at the selected path')
    const parsed = parseSkillMd(await fs.readFile(path.join(stagingDir, 'SKILL.md'), 'utf8'))
    if (parsed.errors.length) throw new Error(`SKILL.md is invalid: ${parsed.errors.join('; ')}`)
    const fmName = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name : ''
    const fallback = source.type === 'github' ? path.basename(source.path || source.repo) : path.basename(source.dir)
    const dirName = opts.dirName ?? (DIRNAME.test(fmName) ? fmName : fallback)
    if (!DIRNAME.test(dirName)) throw new Error(`Unsafe skill directory name: ${dirName}`)
    const targetDir = safeJoin(skillsBase(env, target), dirName)
    const scan = await scanDir(stagingDir)
    const treeHash = await hashTree(stagingDir)
    const files = await listStaged(stagingDir)
    let conflict: Conflict = 'none'
    if (await exists(targetDir)) {
      const rec = env.store.get<{ tree_hash: string }>('SELECT tree_hash FROM installations WHERE id=?', installId(targetDir))
      conflict = !rec ? 'exists-foreign' : (await hashTree(targetDir).catch(() => '')) === rec.tree_hash ? 'exists-managed' : 'exists-modified'
    }
    const virtual = { id: '__plan__', name: dirName, scope: target.scope, source: target.project, dir: targetDir, skillFile: path.join(targetDir, 'SKILL.md'), frontmatter: parsed.frontmatter, files: [], lastModified: '', errors: [], description: '' } as import('./types').Skill
    const existing = (await discoverSkills({ claudeDir: env.paths.claudeDir, projects: target.project ? [target.project] : [] })).filter((s) => s.dir !== targetDir)
    const ni = analyzeSkillNames([...existing, virtual]).get('__plan__')!
    const targetSnapshot = (await exists(targetDir)) ? await hashTree(targetDir).catch(() => 'unreadable') : null
    const plan: Plan = { id, name: dirName, targetSnapshot, names: ni.names, nameStatus: ni.status, nameConflicts: ni.conflicts, source, target, targetDir, stagingDir, files, findings: scan.findings, security: scan.status, scripts: scan.scripts, conflict, version, treeHash, skipped, org: opts.org,
      description: typeof parsed.frontmatter.description === 'string' ? parsed.frontmatter.description : '' }
    env.plans.set(id, plan)
    return plan
  } catch (e) { await fs.rm(stagingDir, { recursive: true, force: true }); throw e }
}

async function listStaged(dir: string, rel = ''): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = []
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await listStaged(dir, r)))
    else if (e.isFile()) out.push({ path: r, size: (await fs.stat(path.join(dir, r))).size })
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : 1))
}

export async function cancelPlan(env: InstallEnv, id: string) {
  const p = env.plans.get(id); env.plans.delete(id)
  if (p) await fs.rm(p.stagingDir, { recursive: true, force: true })
}

/** Steps 12–16: backup, copy, validate, verify discovery, record. Rolls back on any failure. */
export async function applySkillInstall(env: InstallEnv, planId: string, opts: { overwrite?: boolean; approveHighRisk?: boolean } = {}): Promise<{ targetDir: string; backupId: string }> {
  const plan = env.plans.get(planId)
  if (!plan) throw new Error('Unknown or expired plan')
  if (plan.conflict !== 'none' && !opts.overwrite) throw new Error(`Target exists (${plan.conflict}); explicit overwrite required`)
  if (plan.security === 'high-risk' && !opts.approveHighRisk) throw new Error('High-risk behavior detected; explicit approval required')
  const now = (await exists(plan.targetDir)) ? await hashTree(plan.targetDir).catch(() => 'unreadable') : null
  if (now !== plan.targetSnapshot) { await cancelPlan(env, planId); throw new Error('The target changed after this plan was reviewed (something was created, edited or removed there). Nothing was changed; review the installation again.') }
  try {
    const backupId = await runTransaction(env.ctx, `install ${plan.name}`, [plan.targetDir], async (b) => {
      await fs.rm(plan.targetDir, { recursive: true, force: true })
      await copyTree(plan.stagingDir, plan.targetDir)
      await env.hooks?.afterCopy?.()
      const hash = await hashTree(plan.targetDir)
      if (hash !== plan.treeHash) throw new Error('Verification failed: installed files differ from the reviewed plan')
      const found = (await discoverSkills({ claudeDir: env.paths.claudeDir, projects: plan.target.project ? [plan.target.project] : [] })).find((s) => s.dir === plan.targetDir)
      if (!found || found.errors.length) throw new Error('Verification failed: Claude would not discover this skill')
      env.store.run(`INSERT INTO installations(id,kind,name,scope,project,target,source,version,tree_hash,installed_at,pinned,org) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)
        ON CONFLICT(id) DO UPDATE SET source=excluded.source,version=excluded.version,tree_hash=excluded.tree_hash,installed_at=excluded.installed_at,org=excluded.org`,
        installId(plan.targetDir), 'skill', plan.name, plan.target.scope, plan.target.project ?? null, plan.targetDir, JSON.stringify(plan.source), plan.version ?? null, hash, new Date().toISOString(), plan.org ?? null)
      return b.id
    })
    env.store.audit('skill.install', `${plan.name} → ${plan.targetDir}`, true, backupId)
    return { targetDir: plan.targetDir, backupId }
  } catch (e) {
    env.store.audit('skill.install', `${plan.name}: ${(e as Error).message} (rolled back)`, false)
    throw e
  } finally { await cancelPlan(env, planId) }
}

/** Uninstall only direct children of a user/project skills dir. A symlinked skill removes just the link. */
export async function uninstallSkill(env: InstallEnv, dir: string): Promise<{ backupId: string }> {
  const parent = path.dirname(dir)
  const allowed = [path.join(env.paths.claudeDir, 'skills'), ...env.store.projects().map((p) => path.join(p, '.claude', 'skills'))]
  if (!allowed.includes(parent)) throw new Error('Refusing: only user and registered-project skills can be removed (plugin/managed skills are not ours to delete)')
  if (!(await exists(dir))) throw new Error('Skill not found')
  const backupId = await runTransaction(env.ctx, `uninstall ${path.basename(dir)}`, [dir], async (b) => {
    await fs.rm(dir, { recursive: true, force: true }) // rm on a symlink removes the link, not its target
    env.store.run('DELETE FROM installations WHERE id=?', installId(dir))
    return b.id
  })
  env.store.audit('skill.uninstall', dir, true, backupId)
  return { backupId }
}

export interface UpdateInfo { id: string; name: string; installed?: string; latest?: string; available: boolean; pinned: boolean; localModified: boolean; error?: string }
/** Drop records of skills that no longer exist on disk (deleted externally, or removed by a backup restore). The filesystem is authoritative. */
export async function reconcileInstallations(env: InstallEnv): Promise<number> {
  let n = 0
  for (const r of env.store.all<{ id: string; target: string }>('SELECT id, target FROM installations')) if (!(await exists(r.target))) { env.store.run('DELETE FROM installations WHERE id=?', r.id); env.store.run('DELETE FROM update_checks WHERE installation_id=?', r.id); n++ }
  return n
}
export async function checkUpdates(env: InstallEnv): Promise<UpdateInfo[]> {
  await reconcileInstallations(env)
  const rows = env.store.all<any>(`SELECT * FROM installations WHERE kind='skill'`)
  return Promise.all(rows.map(async (r): Promise<UpdateInfo> => {
    const src = JSON.parse(r.source) as SkillSource
    const localModified = (await hashTree(r.target).catch(() => '')) !== r.tree_hash
    const base = { id: r.id, name: r.name, installed: r.version ?? undefined, pinned: !!r.pinned, localModified }
    if (src.type !== 'github') return { ...base, available: false }
    try {
      if (src.ref && /^[0-9a-f]{40}$/i.test(src.ref)) return { ...base, available: false, pinned: true } // pinned to an exact commit
      const ref = src.ref ?? (await repoInfo(env.gh, src.owner, src.repo)).defaultBranch
      const latest = await resolveRef(env.gh, src.owner, src.repo, ref)
      env.store.run('INSERT INTO update_checks(installation_id,latest,checked_at) VALUES (?,?,?) ON CONFLICT(installation_id) DO UPDATE SET latest=excluded.latest,checked_at=excluded.checked_at', r.id, latest, new Date().toISOString())
      return { ...base, latest, available: !r.pinned && latest !== r.version }
    } catch (e) { return { ...base, available: false, error: (e as Error).message } }
  }))
}

export async function planUpdate(env: InstallEnv, installationId: string): Promise<Plan> {
  const r = env.store.get<any>('SELECT * FROM installations WHERE id=?', installationId)
  if (!r) throw new Error('Not an app-managed installation')
  const src = JSON.parse(r.source) as SkillSource
  if (src.type !== 'github') throw new Error('Only GitHub-sourced installs can be updated')
  const latest = env.store.get<{ latest: string }>('SELECT latest FROM update_checks WHERE installation_id=?', installationId)?.latest
  return planSkillInstall(env, { ...src, ref: latest ?? undefined }, { scope: r.scope, project: r.project ?? undefined }, { dirName: path.basename(r.target), org: r.org ?? undefined })
}

export function setPinned(env: InstallEnv, installationId: string, pinned: boolean) {
  env.store.run('UPDATE installations SET pinned=? WHERE id=?', pinned ? 1 : 0, installationId)
}
