// LIVE (SKILLDOCK_LIVE=1): real GitHub + MCP registry. Reads public data only; installs ONLY into a temp HOME. Never touches ~/.claude.
// Nothing here hardcodes stars or counts: numbers are read from the API at run time and written to docs/live-marketplace-report.json.
import { mkdtemp, mkdir, readdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { Store, claudePaths, defaultGh, discoverRepo, searchEntries, facets, repoInfo, rateLimit, entryDetail, searchGithubRepos, searchRegistry, planSkillInstall, applySkillInstall, uninstallSkill, discoverSkills, FEATURED_SOURCES, type InstallEnv, type Entry } from '../src'

const AREAS: Record<string, { repos: string[]; expect: string[] }> = {
  'video production': { repos: ['remotion-dev/skills', 'digitalsamba/claude-code-video-toolkit'], expect: ['Video creation', 'Video editing'] },
  development: { repos: ['addyosmani/agent-skills', 'obra/superpowers'], expect: ['Software development', 'Testing', 'Backend development', 'Frontend development'] },
  productivity: { repos: ['obsidianmd/obsidian-skills', 'OthmanAdi/planning-with-files'], expect: ['Productivity'] },
  design: { repos: ['pbakaus/impeccable', 'anthropics/skills'], expect: ['UI/UX design', 'Frontend development', 'Graphic design'] }
}
const gh = defaultGh(process.env.SKILLDOCK_GH_TOKEN ?? process.env.GITHUB_TOKEN)

test.skipIf(!process.env.SKILLDOCK_LIVE)('real discovery across video, development, productivity and design; dedupe; classification; stats are GitHub\'s; install+uninstall in a fixture', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skilldock-live-mp-')), home = path.join(root, 'home'); await mkdir(path.join(home, '.claude'), { recursive: true })
  const store = new Store(':memory:'), env: InstallEnv = { ctx: { backupRoot: path.join(root, 'd', 'bk') }, store, paths: claudePaths(home), gh, stagingRoot: path.join(root, 'd', 's'), plans: new Map() }
  const before = await rateLimit(gh); console.log('API budget before:', before)
  const need = Object.values(AREAS).flatMap((a) => a.repos).length * 3 + 6; expect(before.remaining, `need ~${need} API calls; resets ${new Date(before.reset * 1000).toISOString()}`).toBeGreaterThan(need)
  const report: any = { at: new Date().toISOString(), authenticated: !!gh.token, budgetBefore: before, areas: {}, notes: [] }
  for (const [area, a] of Object.entries(AREAS)) {
    report.areas[area] = []
    for (const slug of a.repos) {
      const [o, r] = slug.split('/') as [string, string]; const t0 = Date.now(); const res = await discoverRepo({ gh, store }, o, r)
      const skills = res.entries.filter((e) => e.type === 'skill'); const mirrored = skills.filter((e) => e.mirrors?.length)
      const live = slug === 'remotion-dev/skills' ? await repoInfo(gh, o, r) : res.info // one independent re-read (API budget is 60/h unauthenticated)
      expect(skills[0]!.repo!.stars).toBe(res.info.stars) // entries carry exactly the API value they were built from (repo-level, never per skill)
      expect(Math.abs(live.stars - res.info.stars), `${slug}: independent second read of the star count`).toBeLessThanOrEqual(Math.max(5, Math.round(res.info.stars * 0.01))); expect(live.license).toBe(res.info.license)
      expect(skills.length, `${slug} should contain skills`).toBeGreaterThan(0)
      const cats: Record<string, number> = {}; for (const s of skills) for (const c of s.categories) cats[c] = (cats[c] ?? 0) + 1
      report.areas[area].push({ repo: slug, stars: res.info.stars, license: res.info.license ?? null, archived: res.info.archived, pushedAt: res.info.pushedAt, commit: res.commit.slice(0, 10), mode: res.mode, skills: skills.length, mirroredCollapsed: mirrored.length, mirrorCopies: mirrored.reduce((n, e) => n + e.mirrors!.length, 0), plugins: res.entries.filter((e) => e.type === 'plugin').length, notInstallable: skills.filter((e) => !e.install.ok).length, categories: cats, ms: Date.now() - t0 })
    }
    // classification expectation per area: at least one real entry in a relevant category
    const f = searchEntries(store, {}).items; const hit = a.expect.some((c) => f.some((e) => e.categories.includes(c) && a.repos.includes(e.source)))
    expect(hit, `area "${area}" should surface at least one of ${a.expect.join(' / ')}`).toBe(true)
  }
  // dedupe really happened on a repo known (from research) to mirror skills across agent folders
  const imp = store.all<any>('SELECT json FROM marketplace_entries WHERE source_id=?', 'pbakaus/impeccable').map((r) => JSON.parse(r.json) as Entry).filter((e) => e.type === 'skill')
  report.notes.push(`impeccable: ${imp.length} listed after collapsing mirrors`); expect(imp.some((e) => e.mirrors?.length)).toBe(true)
  // real search + facets
  const fac = facets(store); report.facets = { types: fac.types, topCategories: Object.entries(fac.categories).sort((a, b) => b[1] - a[1]).slice(0, 12), licenses: fac.licenses }
  for (const term of ['video', 'remotion', 'frontend', 'obsidian', 'planning']) { const r = searchEntries(store, { q: term }); report.areas.search = { ...(report.areas.search ?? {}), [term]: r.total }; expect(r.total, `search "${term}"`).toBeGreaterThan(0) }
  // resource detail on a real entry (lazy doc fetch, usage extraction)
  const remotion = searchEntries(store, { q: 'remotion best practices', source: 'remotion-dev/skills' }).items[0]!; const d = await entryDetail({ gh, store }, remotion.id)
  expect(d.doc.text.length).toBeGreaterThan(200); expect(d.usage!.headings.length).toBeGreaterThan(0); report.detail = { entry: remotion.id, headings: d.usage!.headings.length, examples: d.usage!.examples.length }
  // transactional install of ONE real video skill into the fixture HOME, verify, uninstall
  const pick = searchEntries(store, { source: 'remotion-dev/skills', installableOnly: true, sort: 'relevance', q: 'remotion' }).items[0]!
  const plan = await planSkillInstall(env, { type: 'github', owner: pick.repo!.owner, repo: pick.repo!.repo, ref: pick.commit, path: pick.path! }, { scope: 'user' })
  expect(plan.version).toBe(pick.commit); expect(plan.files.some((f) => f.path === 'SKILL.md')).toBe(true); expect(await readdir(path.join(home, '.claude'))).toEqual([]) // plan wrote nothing
  report.install = { entry: pick.id, files: plan.files.length, security: plan.security, findings: plan.findings.length, nameConflicts: plan.nameConflicts.length }
  await applySkillInstall(env, plan.id, { approveHighRisk: plan.security === 'high-risk' })
  expect((await discoverSkills({ claudeDir: env.paths.claudeDir })).map((s) => s.name)).toContain(plan.name); expect(await readdir(path.join(home, '.claude', 'skills'))).toEqual([plan.name])
  await uninstallSkill(env, path.join(home, '.claude', 'skills', plan.name)); expect(await readdir(path.join(home, '.claude', 'skills'))).toEqual([])
  // a REAL huge repository (≈10,000 SKILL.md found in research): must be index-only, partial, and open lazily; only if API budget allows
  const rl = await rateLimit(gh)
  if (rl.remaining > 8) {
    const big = await discoverRepo({ gh, store }, 'sickn33', 'agentic-awesome-skills'); const bs = big.entries.filter((e) => e.type === 'skill')
    expect(big.mode).toBe('index-only'); expect(bs.length).toBeGreaterThan(1000); expect(bs.every((e) => e.partial)).toBe(true)
    const one = bs.find((e) => e.install.ok)!; const bd = await entryDetail({ gh, store }, one.id); expect(bd.entry.partial).toBe(false); expect(bd.entry.description.length).toBeGreaterThan(0)
    report.huge = { repo: 'sickn33/agentic-awesome-skills', mode: big.mode, listed: bs.length, opened: one.id, loadedDescriptionChars: bd.entry.description.length, note: big.note ?? null }
  } else report.notes.push(`huge-repository check skipped: only ${rl.remaining} API calls left`)
  // GitHub topic search + MCP registry
  const cand = await searchGithubRepos(gh, { topic: 'claude-skills', minStars: 100, limit: 10 }); expect(cand.length).toBeGreaterThan(0); expect(cand.every((c) => c.inspected === false && c.stars >= 100)).toBe(true); report.search = { topic: 'claude-skills', candidates: cand.length, first: cand[0]!.fullName }
  const mcp = await searchRegistry({ gh, store }, 'video', 10); report.mcp = { query: 'video', results: mcp.length, installable: mcp.filter((m) => m.install.ok).length }
  expect(FEATURED_SOURCES.map((s) => s.id).every((id) => /^[\w.-]+\/[\w.-]+$/.test(id))).toBe(true)
  report.budgetAfter = await rateLimit(gh); report.apiCallsUsed = before.remaining - report.budgetAfter.remaining
  await writeFile(path.resolve(__dirname, '../../../docs/live-marketplace-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ calls: report.apiCallsUsed, areas: Object.fromEntries(Object.entries(report.areas).filter(([k]) => k !== 'search').map(([k, v]: any) => [k, v.map((x: any) => `${x.repo}:${x.skills}`)])) }))
}, 300_000)
