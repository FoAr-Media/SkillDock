// Marketplace vertical slice: dedupe of mirrored skills, index-only mode for huge repos, commit-based cache reuse, source verification,
// install feasibility, classification evidence, search/facets/pagination, local + GitHub-search providers. Shapes mirror REAL repos found in research.
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { Store, discoverRepo, refreshAll, entryDetail, searchEntries, facets, sourceRows, classify, discoverLocalDir, searchGithubRepos, rateLimit, planSkillInstall, claudePaths, type InstallEnv, type MarketEnv } from '../src'
const posixTest = process.platform === 'win32' ? test.skip : test // relies on POSIX permission bits / symlinks

interface R { files: Record<string, string>; commit?: string; archived?: boolean; topics?: string[]; license?: string; stars?: number; down?: boolean; limited?: boolean }
const repos: Record<string, R> = {}; const hits = { raw: 0, tree: 0, commit: 0, repo: 0 }
const skillMd = (n: string, d: string, extra = '') => `---\nname: ${n}\ndescription: ${d}\n${extra}---\n# ${n}\n`
let server: Server, base = ''
beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x'), p = u.pathname, json = (o: unknown, c = 200, h: Record<string, string> = {}) => { res.writeHead(c, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(o)) }
    if (p === '/rate_limit') return json({ resources: { core: { limit: 60, remaining: 41, reset: 2000000000 }, search: { limit: 10, remaining: 9, reset: 2000000000 } } })
    if (p === '/search/repositories') { const q = u.searchParams.get('q') ?? ''; const t = /topic:(\S+)/.exec(q)?.[1]; return json({ total_count: 1, items: Object.entries(repos).filter(([, r]) => !t || r.topics?.includes(t)).map(([n, r]) => ({ full_name: n, stargazers_count: r.stars ?? 7, description: 'd', license: r.license ? { spdx_id: r.license } : null, pushed_at: '2026-11-01T00:00:00Z', archived: !!r.archived, topics: r.topics ?? [] })) }) }
    const m = /^\/repos\/([\w.-]+\/[\w.-]+)(\/.*)?$/.exec(p); const rawm = /^\/raw\/([\w.-]+\/[\w.-]+)\/\w+\/(.+)$/.exec(p)
    const name = m?.[1] ?? rawm?.[1]; const r = name ? repos[name] : undefined
    if (!r) return json({}, 404)
    if (r.limited) return json({ message: 'rate limit' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' })
    if (r.down) return json({}, 500)
    if (rawm) { hits.raw++; const c = r.files[decodeURIComponent(rawm[2]!)]; if (c === undefined) return json({}, 404); res.writeHead(200); return res.end(c) }
    const rest = m![2] ?? ''
    if (rest === '') { hits.repo++; return json({ stargazers_count: r.stars ?? 5, default_branch: 'main', pushed_at: '2026-11-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z', license: r.license ? { spdx_id: r.license } : null, html_url: `https://github.com/${name}`, topics: r.topics ?? [], archived: !!r.archived, description: 'repo' }) }
    if (rest.startsWith('/commits/')) { hits.commit++; return json({ sha: r.commit ?? 'a'.repeat(40) }) }
    if (rest.startsWith('/git/trees/')) { hits.tree++; return json({ truncated: false, tree: Object.entries(r.files).map(([path, c]) => ({ path, type: 'blob', mode: '100644', sha: createHash('sha1').update(c).digest('hex'), size: c.length })) }) }
    json({}, 404)
  })
  await new Promise<void>((r) => server.listen(0, r)); base = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(() => { server.close() })
beforeEach(() => { for (const k of Object.keys(repos)) delete repos[k]; hits.raw = hits.tree = hits.commit = hits.repo = 0 })
const menv = (): MarketEnv => ({ gh: { apiBase: base, rawBase: `${base}/raw` }, store: new Store(':memory:') })

test('tool-folder copies (.claude/.agents/.codex) fold into one canonical entry even when bytes differ; same-named folders elsewhere stay separate; plugin container recorded', async () => {
  const same = skillMd('impeccable', 'Design vocabulary for frontend interfaces')
  repos['o/mirror'] = { files: { 'skills/impeccable/SKILL.md': same, '.claude/skills/impeccable/SKILL.md': same, '.agents/skills/impeccable/SKILL.md': same, '.codex/skills/impeccable/SKILL.md': skillMd('impeccable', 'Codex flavoured variant'),
    'plugins/p1/skills/x/SKILL.md': skillMd('x', 'Plugin nested skill'), 'examples/impeccable/SKILL.md': skillMd('impeccable', 'An unrelated same-named folder') } }
  const e = menv(); const r = await discoverRepo(e, 'o', 'mirror')
  const skills = r.entries.filter((x) => x.type === 'skill'); expect(skills).toHaveLength(3) // canonical impeccable, plugin skill x, and the unrelated examples/impeccable
  const canon = skills.find((x) => x.path === 'skills/impeccable')!; expect(canon.mirrors!.sort()).toEqual(['.agents/skills/impeccable', '.claude/skills/impeccable', '.codex/skills/impeccable']); expect(canon.mirrorsDiffer).toBe(true) // the codex copy differs
  expect(skills.find((x) => x.path === 'examples/impeccable')!.description).toContain('unrelated'); expect(skills.find((x) => x.name === 'x')!.container).toBe('p1')
  expect(hits.raw).toBe(3) // canonical + plugin skill + examples copy fetched; tool-folder variants not re-fetched
  repos['o/onlyagent'] = { files: { '.agents/skills/plan/SKILL.md': skillMd('plan', 'A'), '.codex/skills/plan/SKILL.md': skillMd('plan', 'B'), '.codebuddy/skills/plan/SKILL.md': skillMd('plan', 'C') } }
  const only = (await discoverRepo(e, 'o', 'onlyagent')).entries.filter((x) => x.type === 'skill'); expect(only).toHaveLength(1); expect(only[0]!.mirrors).toHaveLength(2); expect(only[0]!.mirrorsDiffer).toBe(true)
})

test('huge repositories use index-only mode: every skill listed from the tree, none fetched eagerly, flagged partial; detail loads lazily and persists', async () => {
  const files: Record<string, string> = {}; for (let i = 0; i < 450; i++) files[`plugins/p${i % 9}/skills/s${i}/SKILL.md`] = skillMd(`s${i}`, `ffmpeg video subtitles skill number ${i}`)
  repos['o/huge'] = { files }; const e = menv(); const r = await discoverRepo(e, 'o', 'huge', { indexOnlyAbove: 400 })
  expect(r.mode).toBe('index-only'); expect(r.entries).toHaveLength(450); expect(hits.raw).toBe(0); expect(r.entries.every((x) => x.partial)).toBe(true); expect(r.entries[0]!.description).toBe('')
  const id = r.entries.find((x) => x.path === 'plugins/p3/skills/s3')!.id
  const d = await entryDetail(e, id); expect(d.entry.partial).toBe(false); expect(d.entry.description).toContain('ffmpeg'); expect(d.entry.categories).toContain('Video editing')
  expect(searchEntries(e.store, { q: 'ffmpeg' }).total).toBe(1) // persisted: only the opened entry has a fetched description yet
})

test('refresh reuses the cache when the commit is unchanged (no tree/SKILL.md refetch) but refreshes stats; a new commit refetches', async () => {
  repos['o/r'] = { files: { 'skills/a/SKILL.md': skillMd('a', 'alpha'), 'skills/b/SKILL.md': skillMd('b', 'beta') }, stars: 10, commit: 'c'.repeat(40) }
  const e = menv(); await discoverRepo(e, 'o', 'r'); const raw1 = hits.raw, tree1 = hits.tree
  repos['o/r']!.stars = 99; const again = await discoverRepo(e, 'o', 'r')
  expect(again.reused).toBe(true); expect(hits.raw).toBe(raw1); expect(hits.tree).toBe(tree1); expect(again.entries[0]!.repo!.stars).toBe(99)
  repos['o/r']!.commit = 'd'.repeat(40); repos['o/r']!.files['skills/c/SKILL.md'] = skillMd('c', 'gamma'); const third = await discoverRepo(e, 'o', 'r')
  expect(third.reused).toBe(false); expect(third.entries.filter((x) => x.type === 'skill')).toHaveLength(3)
})

test('source verification: verified / archived / error (keeps old entries) / rate-limited stops the batch', async () => {
  repos['o/ok'] = { files: { 'skills/a/SKILL.md': skillMd('a', 'alpha') }, archived: true, license: 'MIT', stars: 3 }; repos['o/down'] = { files: {} }; repos['o/lim'] = { files: {}, limited: true }; repos['o/after'] = { files: { 'skills/z/SKILL.md': skillMd('z', 'zed') } }
  const e = menv(); const res = await refreshAll(e, ['o/ok', 'o/missing', 'o/lim', 'o/after'])
  const row = (id: string) => sourceRows(e.store).find((s) => s.id === id)!
  expect(row('o/ok')).toMatchObject({ status: 'verified', archived: true, stars: 3, entryCount: 1 }); expect(row('o/ok').commit).toBeTruthy(); expect(row('o/ok').verifiedAt).toBeTruthy()
  expect(row('o/missing').status).toBe('error'); expect(row('o/missing').error).toMatch(/Not found/); expect(row('o/lim').status).toBe('rate-limited')
  expect(res.find((r) => r.id === 'o/after')!.skipped).toBe(true); expect(row('o/after').status).not.toBe('verified') // not attempted after the limit
  expect(searchEntries(e.store, { excludeArchived: true }).total).toBe(0); expect(searchEntries(e.store, {}).items[0]!.repo!.archived).toBe(true)
  repos['o/ok']!.down = true; await refreshAll(e, ['o/ok']); expect(row('o/ok').status).toBe('error'); expect(searchEntries(e.store, {}).total).toBe(1) // stale entries kept
  expect(await rateLimit(e.gh)).toEqual({ limit: 60, remaining: 41, reset: 2000000000 })
})

test('root-level skills and oversized folders are flagged non-installable with the reason', async () => {
  const files: Record<string, string> = { 'SKILL.md': skillMd('rootskill', 'Whole repo is the skill') }; for (let i = 0; i < 310; i++) files[`assets/f${i}.txt`] = 'x'
  repos['o/root'] = { files }; repos['o/small'] = { files: { 'skills/a/SKILL.md': skillMd('a', 'alpha') } }; const e = menv()
  const big = (await discoverRepo(e, 'o', 'root')).entries[0]!; expect(big.install.ok).toBe(false); expect(big.install.reason).toMatch(/311 files.*300/)
  expect((await discoverRepo(e, 'o', 'small')).entries[0]!.install).toEqual({ ok: true })
})

test('classification uses name/path/topics/description with evidence; declared category wins; one weak mention is not enough', () => {
  const c = (name: string, description: string, o: object = {}) => classify({ name, description, ...o })
  expect(c('remotion-best-practices', 'Best practices for Remotion - Video creation in React').categories).toContain('Video creation')
  expect(c('ffmpeg', 'Convert, resize and compress video; extract audio').categories).toContain('Video editing')
  const fd = c('frontend-design', 'Create distinctive, production-grade frontend interfaces with high design quality'); expect(fd.categories).toEqual(expect.arrayContaining(['Frontend development', 'UI/UX design']))
  expect(c('planning-with-files', 'Persistent file-based planning and task tracking for long-running work').categories).toContain('Productivity')
  expect(c('obsidian-markdown', 'Create and edit Obsidian notes', { topics: ['obsidian', 'notes'] }).categories).toContain('Productivity')
  expect(c('zzz', 'This skill mentions a test once').categories).toEqual([]); expect(c('x', 'y', { declared: 'SEO' }).categories[0]).toBe('SEO')
  // regression from the real-data run: repo-level topics and "Claude Code" must not label every skill in a repo
  const topics = ['claude-code', 'video', 'audio', 'tts', 'claude-skills']
  expect(c('elevenlabs', 'Generate speech and music with the ElevenLabs API', { topics }).categories).not.toContain('Video creation'); expect(c('obsidian-bases', 'Create and edit Obsidian Bases views for Claude Code', { topics: ['claude-code'] }).categories).not.toContain('Software development')
  expect(c('planning-with-files', 'Use files for persistent planning in Claude Code', { topics: ['claude-code', 'planning'] }).categories).toEqual(['Productivity'])
  expect(c('remotion', 'Make videos programmatically', { topics: ['video'] }).categories).toContain('Video creation')
  expect(fd.evidence['UI/UX design']!.length).toBeGreaterThan(0); expect(c('x', 'y', { path: 'plugins/security-scanning/skills/x' }).categories).toContain('Cybersecurity')
})

test('search: relevance across name/description/path, pagination, facets, installed filter', async () => {
  repos['o/a'] = { files: { 'skills/video-maker/SKILL.md': skillMd('video-maker', 'Make video with ffmpeg'), 'skills/docs/SKILL.md': skillMd('docs', 'Write documentation'), 'skills/db/SKILL.md': skillMd('db', 'Postgres SQL migrations') }, license: 'MIT', topics: ['claude-skills'] }
  repos['o/b'] = { files: { 'skills/pdf/SKILL.md': skillMd('pdf', 'Read PDF office documents') }, license: 'Apache-2.0' }
  const e = menv(); await discoverRepo(e, 'o', 'a'); await discoverRepo(e, 'o', 'b')
  expect(searchEntries(e.store, { q: 'video' }).items.map((x) => x.name)).toEqual(['video-maker']); expect(searchEntries(e.store, {}).total).toBe(4)
  const page = searchEntries(e.store, { limit: 2, offset: 2 }); expect(page.items).toHaveLength(2); expect(page.total).toBe(4)
  const f = facets(e.store); expect(f.licenses).toEqual({ MIT: 3, 'Apache-2.0': 1 }); expect(f.sources['o/a']).toBe(3); expect(f.categories['Video creation']).toBe(1) // name 'video-maker'; a lone 'ffmpeg' in the description is below the threshold; expect(f.types.skill).toBe(4)
  expect(searchEntries(e.store, { installed: true }, new Set(['pdf'])).items.map((x) => x.name)).toEqual(['pdf']); expect(searchEntries(e.store, { source: 'o/b' }).total).toBe(1)
})

posixTest('local-directory provider finds skills (no symlinks), and its entries install through the normal plan', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skilldock-loc-')), lib = path.join(root, 'lib'); await mkdir(path.join(lib, 'a'), { recursive: true }); await mkdir(path.join(lib, 'nested', 'b'), { recursive: true })
  await writeFile(path.join(lib, 'a', 'SKILL.md'), skillMd('a', 'Local design skill')); await writeFile(path.join(lib, 'nested', 'b', 'SKILL.md'), skillMd('b', 'Local sql skill')); await symlink(path.join(lib, 'a'), path.join(lib, 'linked'))
  const e = menv(); const r = await discoverLocalDir(e, lib); expect(r.entries.map((x) => x.name).sort()).toEqual(['a', 'b']); expect(r.entries[0]!.local!.dir).toContain(lib)
  expect(sourceRows(e.store).find((s) => s.kind === 'local')!.status).toBe('verified')
  const home = path.join(root, 'home'); await mkdir(path.join(home, '.claude'), { recursive: true })
  const env: InstallEnv = { ctx: { backupRoot: path.join(root, 'd', 'bk') }, store: e.store, paths: claudePaths(home), gh: e.gh, stagingRoot: path.join(root, 'd', 's'), plans: new Map() }
  const plan = await planSkillInstall(env, { type: 'local', dir: r.entries.find((x) => x.name === 'a')!.local!.dir }, { scope: 'user' }); expect(plan.files.map((f) => f.path)).toEqual(['SKILL.md'])
})

test('GitHub search provider returns unverified candidates with real fields; never invents counts', async () => {
  repos['o/c1'] = { files: {}, topics: ['claude-skills'], stars: 1234, license: 'MIT', archived: false }; repos['o/c2'] = { files: {}, topics: ['other'] }
  const c = await searchGithubRepos({ apiBase: base, rawBase: base }, { topic: 'claude-skills' }); expect(c).toEqual([expect.objectContaining({ fullName: 'o/c1', stars: 1234, license: 'MIT', archived: false, topics: ['claude-skills'], inspected: false })])
})
