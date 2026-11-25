// Reproductions for defects found in the independent review (written BEFORE the fixes).
import { mkdtemp, mkdir, writeFile, readFile, symlink, lstat, readlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { Store, claudePaths, updateJson, saveText, pluginCli, runWithClaude, parseGithubUrl, generateSkill, loadSkillFiles, saveSkillFiles, type InstallEnv } from '../src'
const posixTest = process.platform === 'win32' ? test.skip : test // relies on POSIX permission bits / symlinks

const tmp = () => mkdtemp(path.join(tmpdir(), 'skilldock-rev-'))

test('P0 data loss: editing a skill with binary/large files must not corrupt or delete them', async () => {
  const root = await tmp(), home = path.join(root, 'home'), dir = path.join(home, '.claude', 'skills', 'withbin')
  await mkdir(path.join(dir, 'assets'), { recursive: true })
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 254, 0, 1, 2]); const big = Buffer.alloc(600 * 1024, 7)
  await writeFile(path.join(dir, 'SKILL.md'), '---\nname: withbin\ndescription: Use when testing\n---\nbody\n'); await writeFile(path.join(dir, 'assets/logo.png'), png); await writeFile(path.join(dir, 'assets/big.bin'), big)
  const env: InstallEnv = { ctx: { backupRoot: path.join(root, 'd', 'bk') }, store: new Store(':memory:'), paths: claudePaths(home), gh: { apiBase: '', rawBase: '' }, stagingRoot: path.join(root, 'd', 's'), plans: new Map() }
  const files = await loadSkillFiles(env, dir)
  await saveSkillFiles(env, { scope: 'user' }, 'withbin', { ...files, 'SKILL.md': files['SKILL.md']! + 'edit\n' }, { overwrite: true })
  expect(await readFile(path.join(dir, 'assets/logo.png'))).toEqual(png)
  expect((await readFile(path.join(dir, 'assets/big.bin'))).length).toBe(big.length)
  expect(await readFile(path.join(dir, 'SKILL.md'), 'utf8')).toContain('edit')
})

posixTest('P0 config writes must go THROUGH a symlinked settings file (dotfiles) and roll back its content', async () => {
  const root = await tmp(), real = path.join(root, 'dotfiles', 'settings.json'), link = path.join(root, 'home', 'settings.json'), ctx = { backupRoot: path.join(root, 'd', 'bk') }
  await mkdir(path.dirname(real), { recursive: true }); await mkdir(path.dirname(link), { recursive: true }); await writeFile(real, '{"a":1}'); await symlink(real, link)
  await updateJson(ctx, link, 'edit', (d) => { d.b = 2 })
  expect((await lstat(link)).isSymbolicLink()).toBe(true); expect(await readlink(link)).toBe(real); expect(JSON.parse(await readFile(real, 'utf8'))).toEqual({ a: 1, b: 2 })
  await expect(updateJson(ctx, link, 'fail', (d) => { d.c = 3; throw new Error('x') })).rejects.toThrow('x')
  expect(JSON.parse(await readFile(real, 'utf8'))).toEqual({ a: 1, b: 2 })
})

test('P1 concurrent writes to one file must not lose updates', async () => {
  const root = await tmp(), f = path.join(root, 's.json'), ctx = { backupRoot: path.join(root, 'bk') }; await writeFile(f, '{}')
  await Promise.all(Array.from({ length: 12 }, (_, i) => updateJson(ctx, f, 'c', (d) => { d[`k${i}`] = i })))
  expect(Object.keys(JSON.parse(await readFile(f, 'utf8'))).length).toBe(12)
})

test('P0 CLI wrappers must not allow option injection', async () => {
  const paths = claudePaths('/nonexistent')
  for (const id of ['--help', '-h', '--scope=user']) await expect(pluginCli(paths, 'enable', id)).rejects.toThrow(/Invalid plugin id/)
  await expect(runWithClaude('/nonexistent', '--dangerously-skip-permissions', { approved: true })).rejects.toThrow(/must not start with/)
})

test('P1 GitHub owner/repo of only dots must be rejected (path traversal into other API endpoints)', () => {
  expect(parseGithubUrl('../..')).toBeNull(); expect(parseGithubUrl('./.')).toBeNull(); expect(parseGithubUrl('a/b')).not.toBeNull()
})
posixTest('saveText through symlink keeps link', async () => {
  const root = await tmp(), real = path.join(root, 'r.md'), link = path.join(root, 'l.md'); await writeFile(real, 'x'); await symlink(real, link)
  await saveText({ backupRoot: path.join(root, 'bk') }, link, 'y', 'save'); expect((await lstat(link)).isSymbolicLink()).toBe(true); expect(await readFile(real, 'utf8')).toBe('y'); expect(generateSkill).toBeTruthy()
})

posixTest('readSkillFile refuses symlinks and escapes', async () => {
  const { readSkillFile } = await import('../src'); const root = await tmp(), skill = path.join(root, 's'), secret = path.join(root, 'secret.txt')
  await mkdir(skill); await writeFile(path.join(skill, 'ok.md'), 'fine'); await writeFile(secret, 'TOP SECRET'); await symlink(secret, path.join(skill, 'leak.md'))
  expect(await readSkillFile(skill, 'ok.md')).toBe('fine')
  await expect(readSkillFile(skill, 'leak.md')).rejects.toThrow(/regular file/); await expect(readSkillFile(skill, '../secret.txt')).rejects.toThrow(/escapes/)
})
