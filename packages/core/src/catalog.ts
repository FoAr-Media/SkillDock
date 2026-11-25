import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { fetchBlob, parseGithubUrl, resolveRef } from './github'
import { planSkillInstall, type InstallEnv, type Plan, type Target } from './install'

// ---------- organization catalogs ----------
const Resource = z.object({
  id: z.string().min(1), name: z.string().min(1), description: z.string().optional(), type: z.literal('skill').default('skill'),
  repo: z.string().min(1), path: z.string().default(''), ref: z.string().min(1), sha: z.string().regex(/^[0-9a-f]{40}$/i).optional(),
  checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(), environments: z.array(z.string()).optional(), dependencies: z.array(z.string()).optional(),
  recommendedScope: z.enum(['user', 'project']).optional()
})
export const OrgManifestSchema = z.object({
  organization: z.object({ id: z.string().min(1), name: z.string().min(1) }), catalogVersion: z.string().min(1),
  resources: z.array(Resource), presets: z.array(z.object({ id: z.string(), name: z.string(), resourceIds: z.array(z.string()) })).default([]),
  signature: z.string().optional()
})
export type OrgManifest = z.infer<typeof OrgManifestSchema>

export type CatalogLocation = { kind: 'file'; path: string } | { kind: 'url'; url: string } | { kind: 'github'; spec: string }

/** Load + validate a catalog the user explicitly connected. `github` form: owner/repo/path/to/catalog.json[@ref] (private repos use the stored token). */
export async function loadCatalog(env: InstallEnv, loc: CatalogLocation): Promise<OrgManifest> {
  let text: string
  if (loc.kind === 'file') text = await fs.readFile(loc.path, 'utf8')
  else if (loc.kind === 'url') {
    if (!/^https:\/\//.test(loc.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(loc.url)) throw new Error('Catalog URLs must use https')
    const r = await (env.gh.fetch ?? fetch)(loc.url, { signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`Catalog fetch failed (${r.status})`)
    if (r.url && !/^https:\/\//.test(r.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(r.url)) throw new Error('Catalog redirected to a non-HTTPS location')
    text = await r.text()
  } else {
    const [spec, ref] = loc.spec.split('@'), parts = spec!.split('/'); if (parts.length < 3) throw new Error('Use owner/repo/path/to/catalog.json[@ref]')
    const [owner, repo, ...rest] = parts, sha = await resolveRef(env.gh, owner!, repo!, ref ?? 'HEAD')
    text = (await fetchBlob(env.gh, owner!, repo!, sha, rest.join('/'))).toString('utf8')
  }
  if (text.length > 2_000_000) throw new Error('Catalog too large')
  const m = OrgManifestSchema.parse(JSON.parse(text))
  const ids = new Set<string>()
  for (const r of m.resources) { if (ids.has(r.id)) throw new Error(`Duplicate resource id ${r.id}`); ids.add(r.id) }
  env.store.run('INSERT INTO organizations(id,location,json,fetched_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET location=excluded.location,json=excluded.json,fetched_at=excluded.fetched_at', m.organization.id, JSON.stringify(loc), JSON.stringify(m), new Date().toISOString())
  env.store.audit('org.connect', `${m.organization.id} v${m.catalogVersion}`)
  return m
}
export const listCatalogs = (env: InstallEnv) => env.store.all<{ id: string; location: string; json: string; fetched_at: string }>('SELECT * FROM organizations').map((r) => ({ id: r.id, location: JSON.parse(r.location), manifest: JSON.parse(r.json) as OrgManifest, fetchedAt: r.fetched_at }))
export const disconnectCatalog = (env: InstallEnv, id: string) => { env.store.run('DELETE FROM organizations WHERE id=?', id); env.store.audit('org.disconnect', id) }

/** Plan an org resource at its pinned version; the declared checksum (if any) must match what was downloaded. */
export async function planOrgResource(env: InstallEnv, orgId: string, resourceId: string, target: Target): Promise<Plan> {
  const row = env.store.get<{ json: string }>('SELECT json FROM organizations WHERE id=?', orgId)
  if (!row) throw new Error('Catalog not connected')
  const r = (JSON.parse(row.json) as OrgManifest).resources.find((x) => x.id === resourceId)
  if (!r) throw new Error('Resource not in catalog')
  const gh = parseGithubUrl(r.repo) ?? (() => { throw new Error(`Bad repo: ${r.repo}`) })()
  const plan = await planSkillInstall(env, { type: 'github', owner: gh.owner, repo: gh.repo, ref: r.sha ?? r.ref, path: r.path }, target, { org: orgId })
  if (r.checksum && r.checksum !== `sha256:${plan.treeHash}`) { env.plans.delete(plan.id); await fs.rm(plan.stagingDir, { recursive: true, force: true }); throw new Error(`Checksum mismatch for ${r.id}: expected ${r.checksum}, got sha256:${plan.treeHash}`) }
  return plan
}
export function orgInstalled(env: InstallEnv, orgId: string) {
  return env.store.all<{ name: string; version: string; scope: string; target: string }>('SELECT name,version,scope,target FROM installations WHERE org=?', orgId)
}

// ---------- presets ----------
export interface PresetItem { source: { owner: string; repo: string; ref?: string; path: string }; label: string }
export interface Preset { id: string; name: string; description: string; items: PresetItem[]; builtin: boolean }
const A = (p: string): PresetItem => ({ label: p.split('/').pop()!, source: { owner: 'anthropics', repo: 'skills', path: `skills/${p}` } })
// Only items verified to exist in anthropics/skills. Presets for other domains (video, DevOps…) can be created by the user from any source.
export const BUILTIN_PRESETS: Preset[] = [
  { id: 'frontend-testing', name: 'Frontend & testing', description: 'UI design guidance, web app testing, and building MCP servers.', builtin: true, items: [A('frontend-design'), A('webapp-testing'), A('mcp-builder')] },
  { id: 'office-documents', name: 'Office documents', description: 'Create and edit Word, PDF, PowerPoint and Excel files.', builtin: true, items: [A('docx'), A('pdf'), A('pptx'), A('xlsx')] },
  { id: 'content-creation', name: 'Content creation', description: 'Co-authoring, brand guidelines, internal comms, GIFs and canvas art.', builtin: true, items: [A('doc-coauthoring'), A('brand-guidelines'), A('internal-comms'), A('slack-gif-creator'), A('canvas-design')] },
  { id: 'skill-development', name: 'Skill development', description: 'Tools for authoring your own skills.', builtin: true, items: [A('skill-creator')] }
]
export function listPresets(env: InstallEnv): Preset[] {
  const custom = env.store.all<{ id: string; name: string; json: string }>('SELECT * FROM presets').map((r) => ({ id: r.id, name: r.name, builtin: false, ...JSON.parse(r.json) }) as Preset)
  return [...BUILTIN_PRESETS, ...custom]
}
export function savePreset(env: InstallEnv, p: Omit<Preset, 'builtin'>) {
  if (!p.name.trim() || !p.items.length) throw new Error('A preset needs a name and at least one item')
  env.store.run('INSERT INTO presets(id,name,json) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,json=excluded.json', p.id, p.name, JSON.stringify({ description: p.description, items: p.items }))
}
export const deletePreset = (env: InstallEnv, id: string) => env.store.run('DELETE FROM presets WHERE id=?', id)
/** Reviewed plans for every item; nothing is installed until each plan is applied. Items that fail to plan are reported, not hidden. */
export async function planPreset(env: InstallEnv, presetId: string, target: Target): Promise<{ plans: Plan[]; errors: { item: string; error: string }[] }> {
  const p = listPresets(env).find((x) => x.id === presetId); if (!p) throw new Error('Unknown preset')
  const plans: Plan[] = [], errors: { item: string; error: string }[] = []
  for (const it of p.items) { try { plans.push(await planSkillInstall(env, { type: 'github', ...it.source }, target)) } catch (e) { errors.push({ item: it.label, error: (e as Error).message }) } }
  return { plans, errors }
}
