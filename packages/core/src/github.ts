import { promises as fs } from 'node:fs'
import path from 'node:path'
import { safeJoin } from './fsutil'

export interface GhConfig { apiBase: string; rawBase: string; token?: string; fetch?: typeof fetch }
export const defaultGh = (token?: string): GhConfig => ({ apiBase: 'https://api.github.com', rawBase: 'https://raw.githubusercontent.com', token })

export const LIMITS = { files: 300, fileBytes: 2 * 1024 * 1024, totalBytes: 25 * 1024 * 1024, timeoutMs: 20_000 }

export class RateLimitError extends Error {}

async function req(cfg: GhConfig, url: string, accept = 'application/vnd.github+json'): Promise<Response> {
  const res = await (cfg.fetch ?? fetch)(url, {
    headers: { Accept: accept, 'User-Agent': 'skilldock', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
    signal: AbortSignal.timeout(LIMITS.timeoutMs)
  })
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = res.headers.get('x-ratelimit-reset')
    throw new RateLimitError(`GitHub rate limit reached${reset ? `; resets ${new Date(+reset * 1000).toLocaleTimeString()}` : ''}. Add a GitHub token in Settings for a higher limit.`)
  }
  if (res.status === 404) throw new Error(`Not found (or private without a token): ${url.replace(cfg.apiBase, '')}`)
  if (!res.ok) throw new Error(`GitHub request failed (${res.status}): ${url.replace(cfg.apiBase, '')}`)
  return res
}
const api = async <T>(cfg: GhConfig, p: string): Promise<T> => (await req(cfg, cfg.apiBase + p)).json() as Promise<T>
export const ghApi = api

export interface RepoInfo { owner: string; repo: string; description: string; stars: number; license?: string; pushedAt: string; createdAt: string; defaultBranch: string; private: boolean; htmlUrl: string; topics: string[]; archived: boolean }

export async function repoInfo(cfg: GhConfig, owner: string, repo: string): Promise<RepoInfo> {
  const d = await api<any>(cfg, `/repos/${owner}/${repo}`)
  return { owner, repo, description: d.description ?? '', stars: d.stargazers_count ?? 0, license: d.license?.spdx_id ?? d.license?.name, pushedAt: d.pushed_at, createdAt: d.created_at, defaultBranch: d.default_branch, private: !!d.private, htmlUrl: d.html_url, topics: d.topics ?? [], archived: !!d.archived }
}

export async function resolveRef(cfg: GhConfig, owner: string, repo: string, ref: string): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase()
  return (await api<{ sha: string }>(cfg, `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`)).sha
}

export interface TreeEntry { path: string; type: 'blob' | 'tree' | 'commit'; mode: string; sha: string; size?: number }
export async function repoTree(cfg: GhConfig, owner: string, repo: string, sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const d = await api<{ tree: TreeEntry[]; truncated: boolean }>(cfg, `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`)
  return { entries: d.tree, truncated: d.truncated }
}

export async function fetchBlob(cfg: GhConfig, owner: string, repo: string, sha: string, filePath: string): Promise<Buffer> {
  const enc = filePath.split('/').map(encodeURIComponent).join('/')
  const res = cfg.token
    ? await req(cfg, `${cfg.apiBase}/repos/${owner}/${repo}/contents/${enc}?ref=${sha}`, 'application/vnd.github.raw+json')
    : await req(cfg, `${cfg.rawBase}/${owner}/${repo}/${sha}/${enc}`, '*/*')
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > LIMITS.fileBytes) throw new Error(`${filePath} exceeds ${LIMITS.fileBytes} bytes`)
  // Stream with a hard cap: a server that omits/lies about content-length cannot make us buffer unbounded data.
  const chunks: Uint8Array[] = []; let n = 0
  const reader = res.body?.getReader()
  if (!reader) return Buffer.from(await res.arrayBuffer())
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    n += value.length; if (n > LIMITS.fileBytes) { await reader.cancel(); throw new Error(`${filePath} exceeds ${LIMITS.fileBytes} bytes`) }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export interface GhSpec { owner: string; repo: string; ref?: string; path: string }

/** Download only the files under spec.path (pinned to a commit SHA) into `dest`. Symlinks/submodules are skipped. */
export async function stageGithubDir(cfg: GhConfig, spec: GhSpec, dest: string): Promise<{ commit: string; files: { path: string; size: number }[]; skipped: string[] }> {
  const info = spec.ref ? null : await repoInfo(cfg, spec.owner, spec.repo)
  const commit = await resolveRef(cfg, spec.owner, spec.repo, spec.ref ?? info!.defaultBranch)
  const { entries, truncated } = await repoTree(cfg, spec.owner, spec.repo, commit)
  if (truncated) throw new Error('Repository tree is too large to inspect safely')
  const prefix = spec.path ? spec.path.replace(/^\/|\/$/g, '') + '/' : ''
  const picked = entries.filter((e) => e.path.startsWith(prefix))
  const skipped = picked.filter((e) => e.type === 'commit' || e.mode === '120000').map((e) => e.path)
  const blobs = picked.filter((e) => e.type === 'blob' && e.mode !== '120000')
  if (!blobs.length) throw new Error(`No files found at ${spec.path || '/'} @ ${commit.slice(0, 7)}`)
  if (blobs.length > LIMITS.files) throw new Error(`Too many files (${blobs.length} > ${LIMITS.files})`)
  if (blobs.reduce((n, b) => n + (b.size ?? 0), 0) > LIMITS.totalBytes) throw new Error('Resource exceeds the total size limit')
  await fs.rm(dest, { recursive: true, force: true })
  const files: { path: string; size: number }[] = []
  let cursor = 0
  let failure: Error | undefined
  const worker = async () => {
    while (cursor < blobs.length && !failure) {
      const b = blobs[cursor++]!
      try {
        const rel = b.path.slice(prefix.length)
        const out = safeJoin(dest, rel)
        const buf = await fetchBlob(cfg, spec.owner, spec.repo, commit, b.path)
        if (failure) return // another worker already failed: write nothing more
        await fs.mkdir(path.dirname(out), { recursive: true })
        await fs.writeFile(out, buf, { mode: b.mode === '100755' ? 0o755 : 0o644 })
        files.push({ path: rel, size: buf.length })
      } catch (e) { failure ??= e as Error }
    }
  }
  // Wait for EVERY worker before reporting: otherwise in-flight workers keep writing into `dest` after the caller has cleaned it up.
  await Promise.all(Array.from({ length: 6 }, worker))
  if (failure) { await fs.rm(dest, { recursive: true, force: true }); throw failure }
  return { commit, files: files.sort((a, b) => (a.path < b.path ? -1 : 1)), skipped }
}

export function parseGithubUrl(s: string): { owner: string; repo: string; ref?: string; path: string } | null {
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)\/?(.*))?\/?$/.exec(s.trim())
  if (!m || /^\.+$/.test(m[1]!) || /^\.+$/.test(m[2]!)) return null // '..' would escape /repos/<owner>/<repo>
  return { owner: m[1]!, repo: m[2]!, ref: m[3], path: (m[4] ?? '').replace(/\/$/, '') }
}

/** Remaining unauthenticated/authenticated API budget (this endpoint does not consume it). */
export async function rateLimit(cfg: GhConfig): Promise<{ limit: number; remaining: number; reset: number }> {
  const d = await api<{ resources: { core: { limit: number; remaining: number; reset: number } } }>(cfg, '/rate_limit'); return d.resources.core
}
