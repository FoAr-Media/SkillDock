import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { MASK, claudePaths, deleteMcp, exportWithoutSecrets, listMcp, readRawServer, saveMcp, testMcp, ConflictError } from '../src'

const fixture = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url))
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'skilldock-')), home = path.join(root, 'home'), proj = path.join(root, 'proj')
  await mkdir(home); await mkdir(proj)
  const paths = claudePaths(home), ctx = { backupRoot: path.join(root, 'data', 'backups') }
  await writeFile(paths.userJson, JSON.stringify({ numStartups: 7, mcpServers: { a: { command: 'x', env: { SECRET_TOKEN: 'sekret' } } }, projects: { [proj]: { allowedTools: ['z'], mcpServers: { loc: { type: 'http', url: 'https://e.example/mcp?token=abc', headers: { Authorization: 'Bearer q' } } } } } }))
  await writeFile(path.join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { p: { command: 'node', args: ['s.js', '--api-key=hunter2'] } } }))
  return { paths, ctx, proj, root }
}

test('lists all scopes with secrets masked', async () => {
  const { paths, proj } = await setup()
  const l = await listMcp({ ...paths, managedDirs: [] }, [proj])
  expect(l.map((s) => `${s.scope}/${s.name}/${s.transport}`).sort()).toEqual(['local/loc/http', 'project/p/stdio', 'user/a/stdio'])
  const dump = JSON.stringify(l)
  for (const secret of ['sekret', 'hunter2', 'Bearer q', 'token=abc']) expect(dump).not.toContain(secret)
  expect(l.find((s) => s.name === 'a')!.envKeys).toEqual(['SECRET_TOKEN'])
})

test('edit keeps masked secrets + unrelated keys; rename; delete; conflict detection', async () => {
  const { paths, ctx, proj } = await setup()
  const p = { ...paths, managedDirs: [] }
  const a = (await listMcp(p, [proj])).find((s) => s.name === 'a')!
  await saveMcp(ctx, p, [proj], { scope: 'user', name: 'a2', originalName: 'a', config: { ...a.config, command: 'y' }, expectedHash: a.fileHash })
  const j = JSON.parse(await readFile(paths.userJson, 'utf8'))
  expect(j.numStartups).toBe(7); expect(j.projects[proj].allowedTools).toEqual(['z'])
  expect(j.mcpServers.a2).toEqual({ command: 'y', env: { SECRET_TOKEN: 'sekret' } }); expect(j.mcpServers.a).toBeUndefined()
  await expect(saveMcp(ctx, p, [proj], { scope: 'user', name: 'b', config: { command: 'z' }, expectedHash: a.fileHash })).rejects.toBeInstanceOf(ConflictError) // stale hash
  await expect(saveMcp(ctx, p, [proj], { scope: 'managed', name: 'b', config: { command: 'z' } })).rejects.toThrow(/read-only/)
  await expect(saveMcp(ctx, p, [proj], { scope: 'user', name: 'bad name!', config: { command: 'z' } })).rejects.toThrow()
  await deleteMcp(ctx, p, [proj], { scope: 'project', project: proj, name: 'p' })
  expect(JSON.parse(await readFile(path.join(proj, '.mcp.json'), 'utf8')).mcpServers).toEqual({})
  expect(exportWithoutSecrets(await readRawServer(p, { file: paths.userJson, scope: 'user', name: 'a2' })).env).toEqual({ SECRET_TOKEN: '${SECRET_TOKEN}' })
})

test('testMcp needs approval; real stdio handshake lists tools but never calls them; secrets redacted', async () => {
  const cfg = { command: process.execPath, args: [fixture], env: { SECRET_TOKEN: 'topsecret' } }
  await expect(testMcp(cfg, { approved: false })).rejects.toThrow(/Approval/)
  const d = await testMcp(cfg, { approved: true })
  expect(d).toMatchObject({ configValid: true, handshake: true, claudeRuntime: 'unknown', serverInfo: { name: 'echo-fixture' } })
  expect(d.tools.map((t) => t.name).sort()).toEqual(['dangerous', 'echo'])
  expect(JSON.stringify(d)).not.toContain('DANGEROUS CALLED')
})

test('diagnoses missing dependency and unreachable http', async () => {
  const m = await testMcp({ command: 'definitely-not-a-binary-xyz' }, { approved: true })
  expect(m.dependency.ok).toBe(false)
  const h = await testMcp({ type: 'http', url: 'http://127.0.0.1:9/mcp' }, { approved: true, timeoutMs: 3000 })
  expect(h.handshake).toBe(false); expect(h.error).toBeTruthy()
  expect(MASK).toBeTruthy()
})
