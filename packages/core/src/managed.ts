import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readJsonFile } from './config'
import type { ClaudePaths } from './paths'

export interface ManagedFile { file: string; data: Record<string, any>; error?: string }

/**
 * Managed settings in merge order (docs: managed-settings.json first, then every non-hidden *.json in managed-settings.d/ alphabetically;
 * later files replace single values, lists combine). Read-only: never written by this app.
 */
export async function managedSettingsFiles(paths: ClaudePaths): Promise<ManagedFile[]> {
  const out: ManagedFile[] = []
  for (const d of paths.managedDirs) {
    const main = path.join(d, 'managed-settings.json'), j = await readJsonFile(main)
    if (j.exists) out.push({ file: main, data: j.data, error: j.error })
    const names = (await fs.readdir(path.join(d, 'managed-settings.d')).catch(() => [] as string[])).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort()
    for (const n of names) { const f = path.join(d, 'managed-settings.d', n), x = await readJsonFile(f); out.push({ file: f, data: x.data, error: x.error }) }
  }
  return out
}

/** Documented combination: single values → later wins; lists → combined without duplicates; objects → merged recursively. */
export function mergeManaged(files: ManagedFile[]): Record<string, any> {
  const merge = (a: any, b: any): any => {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b.filter((x) => !a.some((y) => JSON.stringify(y) === JSON.stringify(x)))]
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) { const o = { ...a }; for (const k of Object.keys(b)) o[k] = k in a ? merge(a[k], b[k]) : b[k]; return o }
    return b
  }
  return files.reduce<Record<string, any>>((acc, f) => merge(acc, f.data), {})
}
