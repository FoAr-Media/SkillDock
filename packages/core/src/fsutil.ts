import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')
/** Real path of an existing file (follows symlinks, e.g. dotfile-managed settings); unchanged if missing. */
export const resolveWritable = (p: string) => fs.realpath(p).catch(() => p)

const locks = new Map<string, Promise<unknown>>()
/** Serialize async work per key so concurrent read-modify-write cycles on one file cannot lose updates. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn)
  const tail = run.catch(() => {}); locks.set(key, tail); void tail.then(() => { if (locks.get(key) === tail) locks.delete(key) })
  return run
}

export const exists = (p: string) => fs.lstat(p).then(() => true, () => false)

/** Join `rel` under `root`; throws if the result escapes root (traversal, absolute paths, NUL). */
export function safeJoin(root: string, rel: string): string {
  if (rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new Error(`unsafe path: ${rel}`)
  const full = path.resolve(root, rel)
  if (full !== path.resolve(root) && !full.startsWith(path.resolve(root) + path.sep)) throw new Error(`path escapes root: ${rel}`)
  return full
}

/** Throws if `file` exists and its owner-write bit is cleared (rename() would otherwise bypass it). */
export async function assertWritable(file: string): Promise<void> {
  const st = await fs.stat(file).catch(() => null)
  if (st && (st.mode & 0o200) === 0) throw new Error(`${file} is read-only; refusing to replace it (change its permissions first)`)
}
/** Write via temp file + rename so readers never see a partial file. Preserves mode of an existing file. */
export async function atomicWrite(file: string, data: string | Buffer, mode?: number): Promise<void> {
  file = await resolveWritable(file) // never replace a symlink with a regular file
  await assertWritable(file)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.skilldock-${randomBytes(4).toString('hex')}.tmp`
  const prev = await fs.stat(file).catch(() => null)
  await fs.writeFile(tmp, data, { mode: mode ?? prev?.mode ?? 0o644 })
  try { await fs.rename(tmp, file) } catch (e) { await fs.rm(tmp, { force: true }); throw e }
}

/** Recursive copy that refuses to follow symlinks out of the tree: symlinks are skipped, never dereferenced. */
export async function copyTree(src: string, dst: string, opts: { followRootLink?: boolean } = {}): Promise<void> {
  const root = opts.followRootLink ? await fs.realpath(src) : src
  await fs.mkdir(dst, { recursive: true })
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    const s = path.join(root, e.name), d = path.join(dst, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) await copyTree(s, d)
    else if (e.isFile()) { await fs.copyFile(s, d); await fs.chmod(d, (await fs.stat(s)).mode) }
  }
}

/** Stable content hash of a directory (relative paths + file bytes). Symlinks ignored. */
export async function hashTree(dir: string): Promise<string> {
  const lines: string[] = []
  const walk = async (d: string, rel: string) => {
    for (const e of (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(p, r)
      else if (e.isFile()) lines.push(`${r}\0${sha256(await fs.readFile(p))}`)
    }
  }
  await walk(dir, '')
  return sha256(lines.join('\n'))
}
