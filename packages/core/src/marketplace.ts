import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fetchBlob, ghApi, LIMITS, parseGithubUrl, rateLimit, RateLimitError, repoInfo, repoTree, resolveRef, type GhConfig, type RepoInfo, type TreeEntry } from './github'
import { parseSkillMd } from './skill-parse'
import type { McpConfig } from './mcp'
import type { Store } from './store'

// ---------- classification (heuristic, always labelled "inferred") ----------
/** Strong terms: name ×3, path ×2, description ×1 per distinct term. Repo topics describe the WHOLE repository, so they are weak evidence (×1, once). */
export const CATEGORIES: Record<string, RegExp> = {
  'Software development': /\b(coding|software|developers?|refactor\w*|debug\w*|programming|git|engineering|code review|source code)\b/i,
  'Frontend development': /\b(frontend|front-end|react|vue|svelte|css|html|tailwind|ui components?|web apps?|web ui|interfaces?)\b/i,
  'Backend development': /\b(backend|back-end|api|apis|server|node\.?js|django|fastapi|microservices?)\b/i,
  'Full-stack development': /\b(full-?stack|next\.?js|mern|nuxt|remix)\b/i,
  'UI/UX design': /\b(ui\/ux|ux|ui|design systems?|visual design|graphic design|figma|wireframes?|mockups?|typography|aesthetics?|branding|brand guidelines|color palettes?|layout|art direction|taste|interfaces?)\b/i,
  'Video creation': /\b(videos?|remotion|text-to-video|motion graphics|animations?|animated|storyboards?|cinematic|film|hyperframes|shotcraft)\b/i,
  'Video editing': /\b(video edit\w*|ffmpeg|subtitles?|captions?|trim\w*|transcod\w*|clips?|timeline|footage|cuts?)\b/i,
  'Image generation': /\b(image generation|generate images?|text-to-image|diffusion|midjourney|dall-?e|image models?)\b/i,
  'Graphic design': /\b(graphic|poster|canvas|illustrations?|logos?|visual art|generative art|svg)\b/i,
  'Audio production': /\b(audio|music|voice|speech|podcast|tts|transcri\w*|sound)\b/i,
  'Content creation': /\b(content|blog|copywriting|articles?|newsletter|writing|writer)\b/i,
  'Social media': /\b(social media|twitter|linkedin|instagram|tiktok|youtube)\b/i,
  Marketing: /\b(marketing|campaigns?|ads?|growth|brand voice|cro|conversion)\b/i,
  SEO: /\bseo\b|search engine optimi\w*/i,
  'Business operations': /\b(business|operations|invoices?|crm|sales|hr|finance|internal comms|recruit\w*|career)\b/i,
  Productivity: /\b(productivity|workflows?|notes?|todo|calendar|summari[sz]\w*|planning|plans?|tasks?|obsidian|knowledge|journal|organi[sz]\w*)\b/i,
  'Data analysis': /\b(data analysis|analytics|pandas|datasets?|statistics|visuali[sz]ation|charts?)\b/i,
  'Database management': /\b(databases?|sql|postgres\w*|mysql|mongodb|schemas?|migrations?)\b/i,
  Testing: /\b(tests?|testing|qa|playwright|jest|vitest|e2e|tdd)\b/i,
  DevOps: /\b(devops|ci\/cd|deploy\w*|docker|kubernetes|terraform|pipelines?)\b/i,
  'Cloud infrastructure': /\b(cloud|aws|gcp|azure|cloudflare|serverless|infrastructure)\b/i,
  Cybersecurity: /\b(security|vulnerab\w*|pentest|owasp|threats?|malware)\b/i,
  Research: /\b(research|literature|citations?|papers?|survey|scientific)\b/i,
  Documentation: /\b(documentation|docs|readme|changelog|technical writing)\b/i,
  'Office documents': /\b(docx|word documents?|pdf|pptx|powerpoint|presentations?|slides)\b/i,
  'Spreadsheet automation': /\b(xlsx|excel|spreadsheets?|csv|google sheets)\b/i,
  'Workflow automation': /\b(automation|automate|zapier|n8n)\b/i,
  'Browser automation': /\b(browser|puppeteer|playwright|selenium|scrap\w+|web automation)\b/i
}
/** Weak terms add 1 per distinct term wherever they occur (too generic to count more). */
const WEAK: Record<string, RegExp> = { 'UI/UX design': /\bdesign\b/i, 'Software development': /\b(agents?|skills?)\b(?!.*\bnever\b)/i }
delete (WEAK as Record<string, RegExp>)['Software development'] // ('agent'/'skill' appear everywhere: not evidence)
const norm = (s: string) => s.replace(/[-_./]+/g, ' ')

export interface Classification { categories: string[]; evidence: Record<string, string[]>; declared?: string }
/** Heuristic keyword classification with evidence. A category needs a score of 2: a name/path/topic hit, or two distinct description terms. */
export function classify(i: { name: string; description: string; topics?: string[]; path?: string; declared?: string }): Classification {
  const score: Record<string, number> = {}, ev: Record<string, Set<string>> = {}
  const add = (cat: string, term: string, w: number) => { const k = `${cat}|${term}`; if (!(ev[cat] ??= new Set()).has(term)) { ev[cat]!.add(term); score[cat] = (score[cat] ?? 0) + w } void k }
  const strip = (t: string) => t.replace(/claude[\s_-]*code/gi, ' ') // the product name is in nearly every skill and says nothing about its domain
  const fields: [string, number][] = [[strip(norm(i.name)), 3], [strip(norm(i.path ?? '')), 2], [strip(norm(i.description)), 1]]
  const topicText = strip((i.topics ?? []).map(norm).join(' '))
  for (const [cat, re] of Object.entries(CATEGORIES)) {
    const g = new RegExp(re.source, 'gi')
    for (const [text, w] of fields) for (const m of text.matchAll(g)) add(cat, m[0].toLowerCase(), w)
    for (const m of topicText.matchAll(g)) add(cat, `topic:${m[0].toLowerCase()}`, 1) // weak, repo-level
    const wk = WEAK[cat]; if (wk) for (const [text] of fields) for (const m of text.matchAll(new RegExp(wk.source, 'gi'))) add(cat, m[0].toLowerCase(), 1)
  }
  const picked = Object.entries(score).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c)
  const evidence: Record<string, string[]> = Object.fromEntries(picked.map((c) => [c, [...ev[c]!]]))
  let declared: string | undefined
  if (i.declared) { const d = Object.keys(CATEGORIES).find((c) => c.toLowerCase() === i.declared!.trim().toLowerCase()); if (d) { declared = d; if (!picked.includes(d)) picked.unshift(d); else picked.splice(picked.indexOf(d), 1), picked.unshift(d); evidence[d] = ['declared in SKILL.md frontmatter', ...(evidence[d] ?? [])] } }
  return { categories: picked.slice(0, 4), evidence, declared }
}
/** Loose any-match inference for short registry descriptions. */
export function inferCategories(text: string): string[] {
  const c = Object.entries(CATEGORIES).filter(([, re]) => re.test(text)).map(([k]) => k)
  return c.slice(0, 4)
}

export interface Entry {
  id: string; type: 'skill' | 'plugin' | 'mcp'; name: string; description: string
  source: string; official: boolean; author?: string; categories: string[]; classification?: Classification; tags: string[]
  repo?: { owner: string; repo: string; stars: number; license?: string; pushedAt: string; createdAt: string; htmlUrl: string; private: boolean; archived?: boolean }
  path?: string; commit?: string; fileCount?: number; sizeBytes?: number; files?: string[]; scripts?: string[]; dependencies?: string[]
  /** other repository paths holding a byte-identical SKILL.md (e.g. .claude/skills, .agents/skills, .codex/skills) */
  mirrors?: string[]; mirrorsDiffer?: boolean; container?: string
  /** true when only tree data is known (huge repos): description/categories load when the entry is opened */
  partial?: boolean; install: { ok: boolean; reason?: string }; local?: { dir: string }
  os: string[]; complexity: 'simple' | 'moderate' | 'complex'; compatibility: string[]
  mcp?: { version?: string; websiteUrl?: string; remotes: { type: string; url: string }[]; packages: any[]; install?: McpConfig; installNote?: string }
  plugin?: { marketplace: string; installId: string; marketplaceSource: string; sourceDescriptor?: unknown }
  addedAt?: string; verifiedAt: string
}

export interface MarketEnv { gh: GhConfig; store: Store; registryBase?: string }
/** Always present. Everything else is opt-in. */
export const BUILTIN_SOURCES = [
  { id: 'anthropics/skills', kind: 'github', official: true }, { id: 'anthropics/claude-plugins-official', kind: 'github', official: true }
]
/**
 * Community repositories that were inspected on `verifiedOn` and verified to contain SKILL.md files (found via GitHub topic search and web research).
 * Deliberately carries NO star counts or entry numbers: those are read live after you add a source.
 */
export const FEATURED_SOURCES: { id: string; area: string; note: string; verifiedOn: string }[] = [
  { id: 'remotion-dev/skills', area: 'Video production', note: 'Remotion (React video) skills from the Remotion team', verifiedOn: '2026-11-24' },
  { id: 'digitalsamba/claude-code-video-toolkit', area: 'Video production', note: 'ffmpeg, Remotion, ElevenLabs, Blender and more', verifiedOn: '2026-11-24' },
  { id: 'heygen-com/hyperframes', area: 'Video production', note: 'AI video editing skills (mirrored under several agent folders)', verifiedOn: '2026-11-24' },
  { id: 'addyosmani/agent-skills', area: 'Development', note: 'Engineering skills: API design, testing, accessibility…', verifiedOn: '2026-11-24' },
  { id: 'obra/superpowers', area: 'Development', note: 'Debugging, planning and review workflow skills', verifiedOn: '2026-11-24' },
  { id: 'wshobson/agents', area: 'Development', note: 'Large plugin collection (skills nested under plugins/)', verifiedOn: '2026-11-24' },
  { id: 'obsidianmd/obsidian-skills', area: 'Productivity', note: 'Obsidian notes, canvas and Markdown skills', verifiedOn: '2026-11-24' },
  { id: 'OthmanAdi/planning-with-files', area: 'Productivity', note: 'File-based planning (mirrored for many agents)', verifiedOn: '2026-11-24' },
  { id: 'pbakaus/impeccable', area: 'Design', note: 'Design vocabulary skills for frontend work (mirrored)', verifiedOn: '2026-11-24' },
  { id: 'Leonxlnx/taste-skill', area: 'Design', note: 'Art direction and reference-driven design', verifiedOn: '2026-11-24' },
  { id: 'coreyhaines31/marketingskills', area: 'Marketing', note: 'CRO, copywriting, SEO and ads skills', verifiedOn: '2026-11-24' }
]
const OFFICIAL_OWNERS = new Set(['anthropics'])
const SCRIPT_RE = /\.(sh|bash|py|js|mjs|ts|rb|ps1|bat)$/i
const DEP_RE = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Gemfile)$/

// ---------- source rows (verification state) ----------
export interface SourceRow { id: string; kind: 'github' | 'local'; spec: string; official: boolean; status: 'never' | 'verified' | 'partial' | 'error' | 'rate-limited'; error?: string; commit?: string; stars?: number; archived: boolean; entryCount: number; mode?: string; verifiedAt?: string; lastAttempt?: string; stale: boolean }
export function sourceRows(store: Store): SourceRow[] {
  return store.all<any>('SELECT * FROM marketplace_sources ORDER BY id').map((r) => ({ id: r.id, kind: r.kind, spec: r.spec, official: !!r.official, status: r.status, error: r.error ?? undefined, commit: r.commit_sha ?? undefined, stars: r.stars ?? undefined, archived: !!r.archived,
    entryCount: r.entry_count, mode: r.mode ?? undefined, verifiedAt: r.verified_at ?? undefined, lastAttempt: r.last_attempt ?? undefined, stale: !!r.verified_at && Date.now() - +new Date(r.verified_at) > 24 * 3600_000 }))
}
function markSource(store: Store, id: string, kind: 'github' | 'local', official: boolean, patch: Record<string, unknown>) {
  store.run('INSERT OR IGNORE INTO marketplace_sources(id,kind,spec,official) VALUES (?,?,?,?)', id, kind, id, official ? 1 : 0)
  const cols = Object.keys(patch); if (cols.length) store.run(`UPDATE marketplace_sources SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...Object.values(patch) as any[], id)
}
export const removeSource = (store: Store, id: string) => { store.run('DELETE FROM marketplace_entries WHERE source_id=?', id); store.run('DELETE FROM marketplace_sources WHERE id=?', id) }
function persistEntries(store: Store, sourceId: string, entries: Entry[]) {
  store.run('DELETE FROM marketplace_entries WHERE source_id=?', sourceId)
  for (const e of entries) store.run('INSERT OR REPLACE INTO marketplace_entries(id,source_id,json,verified_at) VALUES (?,?,?,?)', e.id, sourceId, JSON.stringify(e), e.verifiedAt)
}
const loadEntries = (store: Store, sourceId: string) => store.all<{ json: string }>('SELECT json FROM marketplace_entries WHERE source_id=?', sourceId).map((r) => JSON.parse(r.json) as Entry)

// ---------- GitHub repository provider ----------
export interface DiscoverOpts { ref?: string; force?: boolean; indexOnlyAbove?: number; eagerConcurrency?: number }
export interface DiscoverResult { info: RepoInfo; commit: string; entries: Entry[]; mode: 'full' | 'index-only'; reused: boolean; note?: string }
const PRIORITY = [/^skills\//, /^\.claude\/skills\//, /^plugins\/[^/]+\/skills\//, /^\.agents?\/skills\//, /^\.codex\/skills\//]
const rankPath = (p: string) => { const i = PRIORITY.findIndex((r) => r.test(p)); return i < 0 ? 99 : i }
const mkRepo = (info: RepoInfo) => ({ owner: info.owner, repo: info.repo, stars: info.stars, license: info.license, pushedAt: info.pushedAt, createdAt: info.createdAt, htmlUrl: info.htmlUrl, private: info.private, archived: info.archived })

/**
 * Inspect one repository: skills (SKILL.md anywhere), plugin manifest entries. Mirrored copies of one skill (same name + identical SKILL.md blob in
 * .claude/.agents/.codex folders) collapse into one canonical entry. Huge repositories are listed from the tree only (index-only) instead of
 * silently truncating. If the commit is unchanged since the last refresh only the live stats are refreshed (no tree / SKILL.md refetch).
 */
export async function discoverRepo(env: MarketEnv, owner: string, repo: string, opts: DiscoverOpts = {}): Promise<DiscoverResult> {
  const sid = `${owner}/${repo}`, now = new Date().toISOString(), official = OFFICIAL_OWNERS.has(owner.toLowerCase())
  markSource(env.store, sid, 'github', official, { last_attempt: now })
  const info = await repoInfo(env.gh, owner, repo)
  const commit = await resolveRef(env.gh, owner, repo, opts.ref ?? info.defaultBranch)
  const row = env.store.get<any>('SELECT commit_sha, mode, status, error FROM marketplace_sources WHERE id=?', sid)
  const rrepo = mkRepo(info)
  if (!opts.force && !opts.ref && row?.commit_sha === commit && row.status !== 'never') {
    const cached = loadEntries(env.store, sid)
    if (cached.length || row.status === 'verified') {
      const entries = cached.map((e) => ({ ...e, repo: rrepo, verifiedAt: now })); persistEntries(env.store, sid, entries)
      markSource(env.store, sid, 'github', official, { status: row.error ? 'partial' : 'verified', verified_at: now, stars: info.stars, archived: info.archived ? 1 : 0, last_attempt: now })
      return { info, commit, entries, mode: row.mode ?? 'full', reused: true, note: row.error ?? undefined }
    }
  }
  const { entries: tree, truncated } = await repoTree(env.gh, owner, repo, commit)
  const blobs = tree.filter((t) => t.type === 'blob')
  const dirOf = (p: string) => (path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p))
  const best = (g: TreeEntry[]) => [...g].sort((a, b) => rankPath(a.path) - rankPath(b.path) || a.path.length - b.path.length || (a.path < b.path ? -1 : 1))
  // Dedupe: (1) identical SKILL.md blobs with the same folder name are one skill; (2) copies under a tool folder (.codex/skills/x, .agents/skills/x, .codebuddy/skills/x …)
  // are per-agent variants of the same skill even when their bytes differ slightly, so they fold into it. Same-named folders elsewhere with different content stay separate.
  const AGENT_DIR = /^\.[\w-]+\/skills\/[^/]+$/
  const skillBlobs = blobs.filter((t) => /(^|\/)SKILL\.md$/.test(t.path)), baseOf = (t: TreeEntry) => path.posix.basename(dirOf(t.path) || repo)
  const byBase = new Map<string, TreeEntry[]>(); for (const t of skillBlobs) byBase.set(baseOf(t), [...(byBase.get(baseOf(t)) ?? []), t])
  const canon: { main: TreeEntry; mirrors: string[]; mirrorsDiffer: boolean }[] = []
  for (const members of byBase.values()) {
    const plain = members.filter((t) => !AGENT_DIR.test(dirOf(t.path))), agent = members.filter((t) => AGENT_DIR.test(dirOf(t.path)))
    const bySha = new Map<string, TreeEntry[]>(); for (const t of plain) bySha.set(t.sha, [...(bySha.get(t.sha) ?? []), t])
    const groups = [...bySha.values()].map((g) => ({ all: best(g), differ: false }))
    if (agent.length) { if (groups.length) { const g0 = groups.sort((a, b) => rankPath(a.all[0]!.path) - rankPath(b.all[0]!.path))[0]!; g0.all = best([...g0.all, ...agent]); g0.differ = agent.some((a) => a.sha !== g0.all[0]!.sha) } else groups.push({ all: best(agent), differ: agent.some((a) => a.sha !== agent[0]!.sha) }) }
    for (const g of groups) canon.push({ main: g.all[0]!, mirrors: g.all.slice(1).map((m) => dirOf(m.path)), mirrorsDiffer: g.differ || g.all.some((t) => t.sha !== g.all[0]!.sha) })
  }
  const dirs = new Set(canon.map((c) => dirOf(c.main.path)))
  const under = new Map<string, { count: number; size: number; big: boolean; files: string[] }>()
  const indexOnly = canon.length > (opts.indexOnlyAbove ?? 400), fileCap = indexOnly ? 12 : 120
  for (const b of blobs) {
    const segs = b.path.split('/')
    for (let i = segs.length - 1; i >= 0; i--) { const anc = segs.slice(0, i).join('/'); if (!dirs.has(anc)) continue
      const u = under.get(anc) ?? { count: 0, size: 0, big: false, files: [] }; u.count++; u.size += b.size ?? 0; if ((b.size ?? 0) > LIMITS.fileBytes) u.big = true; if (u.files.length < fileCap) u.files.push(b.path.slice(anc ? anc.length + 1 : 0)); under.set(anc, u) }
  }
  const verifiedAt = now, out: Entry[] = []
  const mk = (c: (typeof canon)[number], fm: Record<string, unknown> | null): Entry => {
    const dir = dirOf(c.main.path), u = under.get(dir) ?? { count: 0, size: 0, big: false, files: [] }
    const name = String(fm?.name ?? path.posix.basename(dir || repo)), description = fm ? String(fm.description ?? '') : ''
    const meta = (fm?.metadata ?? {}) as Record<string, unknown>
    const cls = classify({ name, description, topics: info.topics, path: dir, declared: typeof meta.category === 'string' ? meta.category : typeof fm?.category === 'string' ? (fm.category as string) : undefined })
    const scripts = u.files.filter((f) => SCRIPT_RE.test(f)), deps = u.files.filter((f) => DEP_RE.test(f))
    const reason = u.count > LIMITS.files ? `This skill's folder holds ${u.count} files (install limit ${LIMITS.files})${dir === '' ? ': the repository root is the skill; clone it manually or ask the author for a subfolder' : ''}.` : u.size > LIMITS.totalBytes ? `Folder is ${(u.size / 1048576).toFixed(1)} MB (install limit ${LIMITS.totalBytes / 1048576} MB).` : u.big ? `A file exceeds the ${LIMITS.fileBytes / 1048576} MB per-file limit.` : undefined
    const container = /^plugins\/([^/]+)\/skills\//.exec(dir)?.[1]
    const os = scripts.some((s) => /\.(ps1|bat)$/i.test(s)) ? ['windows'] : scripts.some((s) => /\.(sh|bash)$/i.test(s)) ? ['macos', 'linux'] : ['macos', 'linux', 'windows']
    return { id: `skill:${sid}:${dir}`, type: 'skill', name, description, source: sid, official, author: owner, categories: cls.categories, classification: cls, tags: info.topics, repo: rrepo, path: dir, commit, fileCount: u.count, sizeBytes: u.size, files: u.files,
      scripts, dependencies: deps, mirrors: c.mirrors.length ? c.mirrors : undefined, mirrorsDiffer: c.mirrors.length && c.mirrorsDiffer ? true : undefined, container, partial: fm === null ? true : undefined, install: reason ? { ok: false, reason } : { ok: true }, os,
      complexity: deps.length ? 'complex' : scripts.length ? 'moderate' : 'simple', compatibility: ['claude-code (SKILL.md format)'], verifiedAt }
  }
  if (indexOnly) for (const c of canon) out.push(mk(c, null))
  else {
    let i = 0; const conc = opts.eagerConcurrency ?? 6
    const results: Entry[] = []
    await Promise.all(Array.from({ length: conc }, async () => { while (i < canon.length) { const c = canon[i++]!
      try { results.push(mk(c, parseSkillMd((await fetchBlob(env.gh, owner, repo, commit, c.main.path)).toString('utf8')).frontmatter)) } catch (e) { if (e instanceof RateLimitError) throw e /* unreadable SKILL.md: not listed */ } } }))
    out.push(...results.sort((a, b) => (a.path! < b.path! ? -1 : 1)))
  }
  const mp = tree.find((t) => t.path === '.claude-plugin/marketplace.json')
  if (mp) {
    try {
      const m = JSON.parse((await fetchBlob(env.gh, owner, repo, commit, mp.path)).toString('utf8'))
      for (const p of (m.plugins ?? []).slice(0, 400)) {
        if (!p?.name) continue; const desc = String(p.description ?? '')
        const cls = classify({ name: p.name, description: `${desc} ${p.category ?? ''}`, topics: info.topics })
        out.push({ id: `plugin:${sid}:${p.name}`, type: 'plugin', name: p.name, description: desc, source: sid, official, author: p.author?.name ?? owner, categories: cls.categories, classification: cls, tags: p.tags ?? [], repo: rrepo, commit, os: ['macos', 'linux', 'windows'], complexity: 'moderate', compatibility: ['claude-code'], verifiedAt,
          install: { ok: true }, plugin: { marketplace: String(m.name), installId: `${p.name}@${m.name}`, marketplaceSource: sid, sourceDescriptor: p.source } })
      }
    } catch (e) { if (e instanceof RateLimitError) throw e /* malformed manifest: skip plugins */ }
  }
  persistEntries(env.store, sid, out)
  const note = truncated ? 'GitHub truncated the repository tree; the listing is incomplete.' : undefined
  const mode = indexOnly ? 'index-only' : 'full'
  markSource(env.store, sid, 'github', official, { status: note ? 'partial' : 'verified', error: note ?? null, commit_sha: commit, verified_at: now, stars: info.stars, archived: info.archived ? 1 : 0, entry_count: out.length, mode, last_attempt: now })
  return { info, commit, entries: out, mode, reused: false, note }
}

/** Refresh several sources politely: after a rate-limit response the rest are skipped (not hammered) and reported. */
export interface RefreshResult { id: string; ok: boolean; count?: number; mode?: string; reused?: boolean; error?: string; skipped?: boolean }
export async function refreshAll(env: MarketEnv, ids: string[], opts: DiscoverOpts = {}): Promise<RefreshResult[]> {
  const out: RefreshResult[] = []; let limited = false
  for (const id of ids) {
    if (limited) { markSource(env.store, id, id.startsWith('local:') ? 'local' : 'github', OFFICIAL_OWNERS.has(id.split('/')[0]!.toLowerCase()), {}); out.push({ id, ok: false, skipped: true, error: 'Skipped: GitHub rate limit reached earlier in this refresh.' }); continue }
    try {
      if (id.startsWith('local:')) { const r = await discoverLocalDir(env, id.slice(6)); out.push({ id, ok: true, count: r.entries.length }); continue }
      const g = parseGithubUrl(id); if (!g) throw new Error(`Not a GitHub source: ${id}`)
      const r = await discoverRepo(env, g.owner, g.repo, opts); out.push({ id, ok: true, count: r.entries.length, mode: r.mode, reused: r.reused })
    } catch (e) {
      const msg = (e as Error).message, rl = e instanceof RateLimitError; if (rl) limited = true
      markSource(env.store, id, id.startsWith('local:') ? 'local' : 'github', OFFICIAL_OWNERS.has(id.split('/')[0]!.toLowerCase()), { status: rl ? 'rate-limited' : 'error', error: msg, last_attempt: new Date().toISOString() })
      out.push({ id, ok: false, error: msg })
    }
  }
  return out
}

// ---------- local directory provider ----------
export async function discoverLocalDir(env: MarketEnv, dir: string): Promise<{ entries: Entry[] }> {
  const root = await fs.realpath(dir), sid = `local:${root}`, now = new Date().toISOString(), found: string[] = []
  let visited = 0
  const walk = async (d: string, depth: number) => {
    if (depth > 6 || visited > 4000) return
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      visited++; if (e.isSymbolicLink() || e.name === 'node_modules' || e.name === '.git') continue
      const p = path.join(d, e.name); if (e.isDirectory()) await walk(p, depth + 1); else if (e.isFile() && e.name === 'SKILL.md') found.push(d)
    }
  }
  await walk(root, 0)
  const entries: Entry[] = []
  for (const d of found) {
    const fm = parseSkillMd(await fs.readFile(path.join(d, 'SKILL.md'), 'utf8').catch(() => '')).frontmatter, rel = path.relative(root, d)
    const files: string[] = []; let size = 0
    const count = async (x: string, base: string) => { for (const e of await fs.readdir(x, { withFileTypes: true }).catch(() => [])) { if (e.isSymbolicLink()) continue; const p = path.join(x, e.name); if (e.isDirectory()) await count(p, base); else if (e.isFile()) { files.push(path.relative(base, p)); size += (await fs.stat(p)).size } } }
    await count(d, d)
    const name = String(fm.name ?? path.basename(d)), description = String(fm.description ?? ''), cls = classify({ name, description, path: rel })
    const scripts = files.filter((f) => SCRIPT_RE.test(f))
    entries.push({ id: `skill:${sid}:${rel}`, type: 'skill', name, description, source: sid, official: false, categories: cls.categories, classification: cls, tags: [], path: rel, fileCount: files.length, sizeBytes: size, files: files.slice(0, 120), scripts, dependencies: files.filter((f) => DEP_RE.test(f)),
      install: files.length > LIMITS.files ? { ok: false, reason: `Folder holds ${files.length} files (install limit ${LIMITS.files}).` } : { ok: true }, local: { dir: d }, os: ['macos', 'linux', 'windows'], complexity: scripts.length ? 'moderate' : 'simple', compatibility: ['claude-code (SKILL.md format)'], verifiedAt: now })
  }
  persistEntries(env.store, sid, entries); markSource(env.store, sid, 'local', false, { status: 'verified', error: null, verified_at: now, last_attempt: now, entry_count: entries.length, mode: 'full' })
  return { entries }
}

// ---------- GitHub repository search (finds candidate sources; nothing is inspected or installed) ----------
export interface RepoCandidate { fullName: string; stars: number; description: string; license?: string; pushedAt: string; archived: boolean; topics: string[]; inspected: false }
export async function searchGithubRepos(gh: GhConfig, q: { topic?: string; q?: string; minStars?: number; limit?: number }): Promise<RepoCandidate[]> {
  const parts = [q.q?.trim(), q.topic && `topic:${q.topic.replace(/[^\w-]/g, '')}`, q.minStars ? `stars:>=${Math.floor(q.minStars)}` : '', 'archived:false'].filter(Boolean).join(' ')
  const d = await ghApi<{ items: any[] }>(gh, `/search/repositories?q=${encodeURIComponent(parts)}&sort=stars&order=desc&per_page=${Math.min(q.limit ?? 20, 50)}`)
  return d.items.map((r) => ({ fullName: r.full_name, stars: r.stargazers_count ?? 0, description: r.description ?? '', license: r.license?.spdx_id ?? undefined, pushedAt: r.pushed_at, archived: !!r.archived, topics: r.topics ?? [], inspected: false as const }))
}
export { rateLimit }

// ---------- MCP registry ----------
export function registryToEntry(s: any, meta: any): Entry {
  const server = s.server ?? s
  const remotes = (server.remotes ?? []).filter((r: any) => r.url)
  const packages = server.packages ?? []
  let install: McpConfig | undefined, installNote: string | undefined
  const remote = remotes.find((r: any) => /streamable/i.test(r.type))
  if (remote) install = { type: 'http', url: remote.url, ...(remote.headers?.length ? { headers: Object.fromEntries(remote.headers.map((h: any) => [h.name, ''])) } : {}) }
  else {
    const pkg = packages.find((p: any) => ['npm', 'pypi'].includes(p.registryType) && (p.transport?.type ?? 'stdio') === 'stdio')
    if (pkg) {
      const env = Object.fromEntries((pkg.environmentVariables ?? []).map((v: any) => [v.name, '']))
      install = pkg.registryType === 'npm' ? { command: 'npx', args: ['-y', `${pkg.identifier}@${pkg.version}`], ...(Object.keys(env).length ? { env } : {}) } : { command: 'uvx', args: [`${pkg.identifier}==${pkg.version}`], ...(Object.keys(env).length ? { env } : {}) }
      installNote = `Needs ${pkg.registryType === 'npm' ? 'Node/npx' : 'uv/uvx'}${Object.keys(env).length ? ` and values for: ${Object.keys(env).join(', ')}` : ''}`
    } else installNote = 'No automatically installable package (only npm/pypi stdio and Streamable HTTP remotes are supported).'
  }
  const off = meta?.['io.modelcontextprotocol.registry/official'] ?? {}
  return { id: `mcp:${server.name}`, type: 'mcp', name: server.name, description: server.description ?? '', source: 'registry.modelcontextprotocol.io', official: false, install: install ? { ok: true } : { ok: false, reason: installNote }, categories: inferCategories(`${server.name} ${server.description}`), tags: [],
    os: ['macos', 'linux', 'windows'], complexity: remote ? 'simple' : 'moderate', compatibility: ['claude-code (MCP)'], addedAt: off.publishedAt, verifiedAt: new Date().toISOString(),
    repo: server.repository?.url ? undefined : undefined, mcp: { version: server.version, websiteUrl: server.websiteUrl, remotes, packages, install, installNote } }
}
export async function searchRegistry(env: MarketEnv, query: string, limit = 30): Promise<Entry[]> {
  const base = env.registryBase ?? 'https://registry.modelcontextprotocol.io'
  const res = await (env.gh.fetch ?? fetch)(`${base}/v0/servers?limit=${limit}&search=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'skilldock' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`MCP registry request failed (${res.status})`)
  const j = (await res.json()) as { servers: any[] }
  const entries = j.servers.filter((s) => (s._meta?.['io.modelcontextprotocol.registry/official']?.isLatest ?? true)).map((s) => registryToEntry(s, s._meta))
  for (const e of entries) env.store.run('INSERT OR REPLACE INTO marketplace_entries(id,source_id,json,verified_at) VALUES (?,?,?,?)', e.id, 'registry', JSON.stringify(e), e.verifiedAt)
  return entries
}

// ---------- query: search, filters, pagination, facets ----------
export interface Query { q?: string; type?: Entry['type']; category?: string; license?: string; os?: string; official?: boolean; complexity?: Entry['complexity']; installed?: boolean; minStars?: number; sort?: 'stars' | 'updated' | 'relevance' | 'added' | 'activity' | 'compatibility'; sourceId?: string; source?: string; excludeArchived?: boolean; hasScripts?: boolean; installableOnly?: boolean; limit?: number; offset?: number }
const cache = new WeakMap<Store, { sig: string; rows: Entry[] }>()
function allEntries(store: Store): Entry[] {
  const s = store.get<any>('SELECT COUNT(*) c, MAX(verified_at) m, COALESCE(SUM(LENGTH(json)),0) l FROM marketplace_entries')!, sig = `${s.c}|${s.m}|${s.l}`
  const hit = cache.get(store); if (hit?.sig === sig) return hit.rows
  const rows = store.all<{ json: string }>('SELECT json FROM marketplace_entries').map((r) => JSON.parse(r.json) as Entry); cache.set(store, { sig, rows }); return rows
}
export function searchEntries(store: Store, q: Query, installedNames: Set<string> = new Set()): { items: Entry[]; total: number } {
  const terms = (q.q ?? '').toLowerCase().split(/\s+/).filter(Boolean), src = q.source ?? q.sourceId
  const hay = (e: Entry) => ({ name: e.name.toLowerCase(), desc: e.description.toLowerCase(), meta: `${e.path ?? ''} ${e.categories.join(' ')} ${e.tags.join(' ')} ${e.container ?? ''} ${e.source}`.toLowerCase() })
  const score = (e: Entry) => { const h = hay(e); let t = 0; for (const term of terms) { const s = (h.name.includes(term) ? 5 : 0) + (h.meta.includes(term) ? 2 : 0) + (h.desc.includes(term) ? 2 : 0); if (!s) return 0; t += s } return t }
  let l = allEntries(store).filter((e) => (!q.type || e.type === q.type) && (!src || e.source === src) && (!q.category || e.categories.includes(q.category)) && (!q.license || e.repo?.license === q.license) && (!q.os || e.os.includes(q.os)) &&
    (q.official === undefined || e.official === q.official) && (!q.complexity || e.complexity === q.complexity) && (!q.minStars || (e.repo?.stars ?? 0) >= q.minStars) && (!q.excludeArchived || !e.repo?.archived) &&
    (q.hasScripts === undefined || !!e.scripts?.length === q.hasScripts) && (!q.installableOnly || e.install.ok) && (q.installed === undefined || installedNames.has(e.name) === q.installed) && (!terms.length || score(e) > 0))
  const by: Record<string, (a: Entry, b: Entry) => number> = {
    stars: (a, b) => (b.repo?.stars ?? 0) - (a.repo?.stars ?? 0) || (a.name < b.name ? -1 : 1), updated: (a, b) => (b.repo?.pushedAt ?? '').localeCompare(a.repo?.pushedAt ?? ''), relevance: (a, b) => score(b) - score(a) || (a.name < b.name ? -1 : 1),
    added: (a, b) => (b.addedAt ?? b.repo?.createdAt ?? '').localeCompare(a.addedAt ?? a.repo?.createdAt ?? ''), activity: (a, b) => (b.repo?.pushedAt ?? '').localeCompare(a.repo?.pushedAt ?? ''), compatibility: (a, b) => b.os.length - a.os.length
  }
  l = l.sort(by[q.sort ?? (terms.length ? 'relevance' : 'stars')]!)
  return { items: l.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 300)), total: l.length }
}
/** Back-compat array form. */
export const queryEntries = (store: Store, q: Query, installedNames: Set<string> = new Set()): Entry[] => searchEntries(store, q, installedNames).items

export function facets(store: Store) {
  const f = { types: {} as Record<string, number>, categories: {} as Record<string, number>, licenses: {} as Record<string, number>, sources: {} as Record<string, number>, os: {} as Record<string, number>, complexity: {} as Record<string, number> }
  const inc = (m: Record<string, number>, k?: string) => { if (k) m[k] = (m[k] ?? 0) + 1 }
  for (const e of allEntries(store)) { inc(f.types, e.type); for (const c of e.categories) inc(f.categories, c); inc(f.licenses, e.repo?.license); inc(f.sources, e.source); for (const o of e.os) inc(f.os, o); inc(f.complexity, e.complexity) }
  return f
}

// ---------- resource detail ----------
export function extractUsage(md: string) {
  const { frontmatter: fm, body } = parseSkillMd(md)
  const headings = [...body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1]!.trim()).slice(0, 24)
  const examples = [...body.matchAll(/```[\w-]*\n([\s\S]*?)```/g)].map((m) => m[1]!.trim()).filter(Boolean).slice(0, 3).map((x) => (x.length > 600 ? x.slice(0, 600) + '…' : x))
  return { headings, examples, argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : undefined, allowedTools: fm['allowed-tools'], description: typeof fm.description === 'string' ? fm.description : '' }
}
/** Full detail for one entry. Partial (index-only) skill entries are completed lazily from their SKILL.md and the result is cached. */
export async function entryDetail(env: MarketEnv, id: string) {
  const row = env.store.get<{ json: string; source_id: string }>('SELECT json, source_id FROM marketplace_entries WHERE id=?', id)
  if (!row) throw new Error('Unknown entry')
  let e = JSON.parse(row.json) as Entry, text: string | undefined
  if (e.type === 'skill' && e.repo && e.commit) {
    text = (await fetchBlob(env.gh, e.repo.owner, e.repo.repo, e.commit, `${e.path ? e.path + '/' : ''}SKILL.md`).catch(() => Buffer.from(''))).toString('utf8')
    if (e.partial && text) {
      const fm = parseSkillMd(text).frontmatter, meta = (fm.metadata ?? {}) as Record<string, unknown>
      e.name = String(fm.name ?? e.name); e.description = String(fm.description ?? ''); e.partial = false
      e.classification = classify({ name: e.name, description: e.description, topics: e.tags, path: e.path, declared: typeof meta.category === 'string' ? meta.category : undefined }); e.categories = e.classification.categories
      env.store.run('UPDATE marketplace_entries SET json=? WHERE id=?', JSON.stringify(e), id)
    }
  } else if (e.type === 'skill' && e.local) text = await fs.readFile(path.join(e.local.dir, 'SKILL.md'), 'utf8').catch(() => '')
  else if (e.repo && e.commit) text = (await fetchBlob(env.gh, e.repo.owner, e.repo.repo, e.commit, 'README.md').catch(() => Buffer.from('(no README.md at repository root)'))).toString('utf8')
  const related = allEntries(env.store).filter((x) => x.id !== e.id && x.source === e.source && x.type === e.type && ((e.container && x.container === e.container) || (!e.container && path.posix.dirname(x.path ?? '') === path.posix.dirname(e.path ?? '')))).slice(0, 12)
  return { entry: e, doc: { title: e.type === 'skill' ? 'SKILL.md' : e.type === 'plugin' ? 'README' : e.name, text: text ?? `${e.description}\n\n${e.mcp?.websiteUrl ?? ''}` }, usage: e.type === 'skill' && text ? extractUsage(text) : null, related }
}
export { parseGithubUrl }
