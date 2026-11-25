import { mkdtemp, mkdir, writeFile, readFile, symlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { ConflictError, Store, createBackup, incompleteTransactions, restoreBackup, runTransaction, safeJoin, updateJson, readJsonFile, listBackups } from '../src'
const posixTest = process.platform === 'win32' ? test.skip : test // relies on POSIX permission bits / symlinks

const tmp = () => mkdtemp(path.join(tmpdir(), 'skilldock-'))

test('safeJoin blocks traversal', () => {
  expect(safeJoin('/a/b', 'c/d')).toBe('/a/b/c/d')
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\0b']) expect(() => safeJoin('/a/b', bad)).toThrow()
})

posixTest('backup + restore handles files, dirs, symlinks and files that did not exist', async () => {
  const r = await tmp(), ctx = { backupRoot: path.join(r, 'bk') }
  await mkdir(path.join(r, 'd')); await writeFile(path.join(r, 'd', 'a.txt'), 'A'); await writeFile(path.join(r, 'f'), 'F')
  await symlink('/nonexistent-target', path.join(r, 'l'))
  const b = await createBackup(ctx, 't', [path.join(r, 'd'), path.join(r, 'f'), path.join(r, 'l'), path.join(r, 'new')])
  await writeFile(path.join(r, 'd', 'a.txt'), 'CHANGED'); await writeFile(path.join(r, 'f'), 'X'); await writeFile(path.join(r, 'new'), 'created')
  await restoreBackup(ctx, b.id)
  expect(await readFile(path.join(r, 'd', 'a.txt'), 'utf8')).toBe('A')
  expect(await readFile(path.join(r, 'f'), 'utf8')).toBe('F')
  expect((await lstat(path.join(r, 'l'))).isSymbolicLink()).toBe(true)
  await expect(lstat(path.join(r, 'new'))).rejects.toThrow()
  expect((await listBackups(ctx))).toHaveLength(1)
})

test('transaction rolls back every file on failure and journals the result', async () => {
  const r = await tmp(), ctx = { backupRoot: path.join(r, 'data', 'backups') }
  const a = path.join(r, 'a'), b = path.join(r, 'b')
  await writeFile(a, '1')
  await expect(runTransaction(ctx, 'x', [a, b], async () => { await writeFile(a, '2'); await writeFile(b, 'new'); throw new Error('boom') })).rejects.toThrow('boom')
  expect(await readFile(a, 'utf8')).toBe('1')
  await expect(lstat(b)).rejects.toThrow()
  expect(await incompleteTransactions(ctx)).toHaveLength(0)
})

test('pending journal is reported when a transaction never finishes', async () => {
  const r = await tmp(), ctx = { backupRoot: path.join(r, 'data', 'backups') }
  const f = path.join(r, 'f'); await writeFile(f, 'orig')
  void runTransaction(ctx, 'hang', [f], () => new Promise(() => {}))
  await new Promise((res) => setTimeout(res, 100))
  expect(await incompleteTransactions(ctx)).toHaveLength(1)
})

test('updateJson preserves unknown keys, detects concurrent edits, refuses invalid JSON', async () => {
  const r = await tmp(), ctx = { backupRoot: path.join(r, 'data', 'backups') }, f = path.join(r, 's.json')
  await writeFile(f, JSON.stringify({ weird: { nested: [1, 2] }, permissions: { allow: ['x'] } }))
  const read = await readJsonFile(f)
  await updateJson(ctx, f, 'edit', (d) => { d.permissions.allow.push('y') }, read.hash)
  const after = JSON.parse(await readFile(f, 'utf8'))
  expect(after.weird).toEqual({ nested: [1, 2] }); expect(after.permissions.allow).toEqual(['x', 'y'])
  await writeFile(f, '{"changed":true}') // external edit
  await expect(updateJson(ctx, f, 'edit', () => {}, read.hash)).rejects.toBeInstanceOf(ConflictError)
  expect(await readFile(f, 'utf8')).toBe('{"changed":true}')
  await writeFile(f, '{broken')
  await expect(updateJson(ctx, f, 'edit', () => {})).rejects.toThrow(/not valid JSON/)
  expect(await readFile(f, 'utf8')).toBe('{broken')
})

test('store migrates and audits', () => {
  const s = new Store(':memory:'); s.audit('x', 'y'); s.setPref('k', 'v')
  expect(s.all('SELECT * FROM audit_events')).toHaveLength(1); expect(s.pref('k')).toBe('v')
})
