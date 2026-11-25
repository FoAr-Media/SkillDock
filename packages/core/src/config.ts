import { promises as fs } from 'node:fs'
import { createTwoFilesPatch } from 'diff'
import { assertWritable, atomicWrite, resolveWritable, sha256, withLock } from './fsutil'
import { runTransaction, type Ctx } from './backup'

export interface JsonFile { exists: boolean; text: string; hash: string; data: Record<string, unknown>; error?: string }

export async function readJsonFile(file: string): Promise<JsonFile> {
  let text = ''
  try { text = await fs.readFile(file, 'utf8') } catch { return { exists: false, text: '', hash: sha256(''), data: {} } }
  try {
    const data = text.trim() ? JSON.parse(text) : {}
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('top level is not an object')
    return { exists: true, text, hash: sha256(text), data }
  } catch (e) { return { exists: true, text, hash: sha256(text), data: {}, error: (e as Error).message } }
}

export class ConflictError extends Error { constructor(file: string) { super(`${file} changed on disk since it was read`) } }

export const unifiedDiff = (name: string, before: string, after: string) => createTwoFilesPatch(name, name, before, after, 'current', 'proposed', { context: 3 })

/**
 * Read-modify-write of a JSON object file. Unknown keys survive because we mutate the parsed object.
 * `expectedHash` (from an earlier read) detects concurrent edits; mismatch throws ConflictError and nothing is written.
 */
export async function updateJson(ctx: Ctx, link: string, label: string, mutate: (d: Record<string, any>) => void, expectedHash?: string): Promise<{ before: string; after: string }> {
  const file = await resolveWritable(link); await assertWritable(file)
  return withLock(file, () => runTransaction(ctx, label, [file], async () => {
    const cur = await readJsonFile(file)
    if (cur.error) throw new Error(`${file} is not valid JSON (${cur.error}); refusing to modify`)
    if (expectedHash !== undefined && cur.hash !== expectedHash) throw new ConflictError(file)
    const next = structuredClone(cur.data)
    mutate(next)
    const after = JSON.stringify(next, null, 2) + '\n'
    await atomicWrite(file, after)
    return { before: cur.text, after }
  }))
}

/** Raw text save (e.g. CLAUDE.md, raw JSON editor) with the same conflict check + backup. */
export async function saveText(ctx: Ctx, link: string, text: string, label: string, expectedHash?: string, opts: { json?: boolean } = {}): Promise<void> {
  if (opts.json) { try { JSON.parse(text) } catch (e) { throw new Error(`invalid JSON: ${(e as Error).message}`) } }
  const file = await resolveWritable(link); await assertWritable(file)
  await withLock(file, () => runTransaction(ctx, label, [file], async () => {
    const cur = await fs.readFile(file, 'utf8').catch(() => '')
    if (expectedHash !== undefined && sha256(cur) !== expectedHash) throw new ConflictError(file)
    await atomicWrite(file, text)
  }))
}
