import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicWrite, copyTree, exists } from './fsutil'

export interface BackupEntry { orig: string; rel: string; existed: boolean; kind: 'file' | 'dir' | 'link' | 'none'; linkTarget?: string; /** permission bits of the original file, restored with it */ mode?: number }
export interface BackupManifest { id: string; label: string; createdAt: string; entries: BackupEntry[] }
export interface Ctx { backupRoot: string }

const newId = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`

async function private700(dir: string) { await fs.mkdir(dir, { recursive: true, mode: 0o700 }); await fs.chmod(dir, 0o700) }

/** Copy each path (file, dir or symlink) into a new backup. Missing paths are recorded so restore can delete them. */
export async function createBackup(ctx: Ctx, label: string, paths: string[]): Promise<BackupManifest> {
  const id = newId(), dir = path.join(ctx.backupRoot, id)
  await private700(dir)
  const entries: BackupEntry[] = []
  for (const [i, orig] of paths.entries()) {
    const rel = `${i}`
    const st = await fs.lstat(orig).catch(() => null)
    if (!st) { entries.push({ orig, rel, existed: false, kind: 'none' }); continue }
    if (st.isSymbolicLink()) { entries.push({ orig, rel, existed: true, kind: 'link', linkTarget: await fs.readlink(orig) }); continue }
    if (st.isDirectory()) { await copyTree(orig, path.join(dir, rel)); entries.push({ orig, rel, existed: true, kind: 'dir' }) }
    else { await fs.copyFile(orig, path.join(dir, rel)); await fs.chmod(path.join(dir, rel), 0o600); entries.push({ orig, rel, existed: true, kind: 'file', mode: st.mode & 0o7777 }) }
  }
  const manifest = { id, label, createdAt: new Date().toISOString(), entries }
  await atomicWrite(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 0o600)
  return manifest
}

export async function listBackups(ctx: Ctx): Promise<BackupManifest[]> {
  const out: BackupManifest[] = []
  for (const e of await fs.readdir(ctx.backupRoot, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue
    try { out.push(JSON.parse(await fs.readFile(path.join(ctx.backupRoot, e.name, 'manifest.json'), 'utf8'))) } catch { /* incomplete backup dir */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Put every recorded path back to its backed-up state (including deleting things that did not exist). */
export async function restoreBackup(ctx: Ctx, id: string): Promise<void> {
  if (!/^[\w-]+$/.test(id)) throw new Error('bad backup id')
  const dir = path.join(ctx.backupRoot, id)
  const m: BackupManifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'))
  for (const e of m.entries) {
    await fs.rm(e.orig, { recursive: true, force: true })
    if (!e.existed) continue
    await fs.mkdir(path.dirname(e.orig), { recursive: true })
    if (e.kind === 'link') await fs.symlink(e.linkTarget!, e.orig)
    else if (e.kind === 'dir') await copyTree(path.join(dir, e.rel), e.orig)
    else { await fs.copyFile(path.join(dir, e.rel), e.orig); if (e.mode !== undefined) await fs.chmod(e.orig, e.mode) }
  }
}

export interface Journal { id: string; label: string; backupId: string; startedAt: string; status: 'pending' | 'committed' | 'rolled-back' }
const jfile = (ctx: Ctx, id: string) => path.join(ctx.backupRoot, '..', 'journal', `${id}.json`)

/**
 * Multi-file transaction: back up `targets`, run `fn`, roll everything back on error.
 * A pending journal entry survives a crash so the app can offer recovery on next start.
 */
export async function runTransaction<T>(ctx: Ctx, label: string, targets: string[], fn: (backup: BackupManifest) => Promise<T>): Promise<T> {
  const backup = await createBackup(ctx, label, targets)
  const j: Journal = { id: backup.id, label, backupId: backup.id, startedAt: backup.createdAt, status: 'pending' }
  await atomicWrite(jfile(ctx, j.id), JSON.stringify(j), 0o600)
  try {
    const r = await fn(backup)
    await atomicWrite(jfile(ctx, j.id), JSON.stringify({ ...j, status: 'committed' }), 0o600)
    return r
  } catch (e) {
    await restoreBackup(ctx, backup.id)
    await atomicWrite(jfile(ctx, j.id), JSON.stringify({ ...j, status: 'rolled-back' }), 0o600)
    throw e
  }
}

/** Journals still `pending` mean the app died mid-operation. */
export async function incompleteTransactions(ctx: Ctx): Promise<Journal[]> {
  const dir = path.join(ctx.backupRoot, '..', 'journal')
  const out: Journal[] = []
  for (const f of await fs.readdir(dir).catch(() => [])) {
    try { const j: Journal = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')); if (j.status === 'pending') out.push(j) } catch { /* ignore */ }
  }
  return out
}

export async function resolveIncomplete(ctx: Ctx, id: string, action: 'rollback' | 'keep'): Promise<void> {
  const f = jfile(ctx, id)
  const j: Journal = JSON.parse(await fs.readFile(f, 'utf8'))
  if (action === 'rollback') await restoreBackup(ctx, j.backupId)
  await atomicWrite(f, JSON.stringify({ ...j, status: action === 'rollback' ? 'rolled-back' : 'committed' }), 0o600)
}
export { exists }
