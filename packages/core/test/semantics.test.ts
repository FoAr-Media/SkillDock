// F15 (.mcp.json approval state) and F16 (skill name resolution). Rules come from code.claude.com docs (mcp + skills pages).
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { claudePaths, listMcp, analyzeSkillNames, BUILTIN_COMMAND_NAMES, type Skill } from '../src'
const posixTest = process.platform === 'win32' ? test.skip : test // relies on POSIX permission bits / symlinks

async function mcpFx(opts: { trusted: boolean; user?: object; shared?: object; local?: object; projEntry?: object }) {
  const root = await mkdtemp(path.join(tmpdir(), 'skilldock-sem-')), home = path.join(root, 'home'), proj = path.join(root, 'proj')
  await mkdir(path.join(home, '.claude'), { recursive: true }); await mkdir(path.join(proj, '.claude'), { recursive: true })
  const paths = { ...claudePaths(home), managedDirs: [] as string[] }
  await writeFile(path.join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { pend: { command: 'x' }, appr: { command: 'x' }, rej: { command: 'x' }, shared: { command: 'x' }, dis: { command: 'x' }, both: { command: 'x' } } }))
  await writeFile(paths.userJson, JSON.stringify({ mcpServers: { both: { command: 'u' }, usr: { command: 'u' } }, projects: { [proj]: { hasTrustDialogAccepted: opts.trusted, ...(opts.projEntry ?? {}) } } }))
  await writeFile(paths.userSettings, JSON.stringify(opts.user ?? {})); await writeFile(path.join(proj, '.claude/settings.json'), JSON.stringify(opts.shared ?? {})); await writeFile(path.join(proj, '.claude/settings.local.json'), JSON.stringify(opts.local ?? {}))
  const l = await listMcp(paths, [proj]); const by = (n: string, scope: string) => l.find((s) => s.name === n && s.scope === scope)!
  return { l, by, proj }
}

test('F15: project .mcp.json servers are Pending until approved; rejection beats approval; user/local need none', async () => {
  const { by } = await mcpFx({ trusted: true, user: { enabledMcpjsonServers: ['appr', 'rej'] }, local: { disabledMcpjsonServers: ['rej'] } })
  expect(by('pend', 'project').state.status).toBe('pending'); expect(by('pend', 'project').state.reason).toMatch(/run `claude`/)
  expect(by('appr', 'project').state.status).toBe('approved'); expect(by('rej', 'project').state.status).toBe('rejected')
  expect(by('usr', 'user').state.status).toBe('not-required')
})
test('F15: approvals committed to shared project settings are ignored in an untrusted workspace; user settings still count', async () => {
  const u = await mcpFx({ trusted: false, shared: { enabledMcpjsonServers: ['shared'] }, user: { enabledMcpjsonServers: ['appr'] } })
  expect(u.by('shared', 'project').state.status).toBe('pending'); expect(u.by('shared', 'project').state.reason).toMatch(/trust/i); expect(u.by('appr', 'project').state.status).toBe('approved')
  const t = await mcpFx({ trusted: true, shared: { enabledMcpjsonServers: ['shared'] } }); expect(t.by('shared', 'project').state.status).toBe('approved')
  const un = await mcpFx({ trusted: false, local: { enabledMcpjsonServers: ['appr'] } }); expect(un.by('appr', 'project').state.status).toBe('pending') // local file waits for trust
})
test('F15: enableAllProjectMcpServers approves all except rejected; rejection applies even when untrusted', async () => {
  const { by } = await mcpFx({ trusted: false, user: { enableAllProjectMcpServers: true }, shared: { disabledMcpjsonServers: ['rej'] } })
  expect(by('pend', 'project').state.status).toBe('approved'); expect(by('rej', 'project').state.status).toBe('rejected')
})
test('F15: per-project disabledMcpServers marks servers disabled; observed legacy arrays are labelled, not trusted as documented', async () => {
  const d = await mcpFx({ trusted: true, user: { enableAllProjectMcpServers: true }, projEntry: { disabledMcpServers: ['dis', 'usr'] } })
  expect(d.by('dis', 'project').state.status).toBe('disabled'); expect(d.by('usr', 'user').state.disabledInProjects).toEqual([d.proj])
  const o = await mcpFx({ trusted: true, projEntry: { enabledMcpjsonServers: ['appr'], disabledMcpjsonServers: ['rej'] } })
  expect(o.by('appr', 'project').state).toMatchObject({ status: 'approved', observedOnly: true }); expect(o.by('rej', 'project').state).toMatchObject({ status: 'rejected', observedOnly: true })
})
test('F15: same name in several scopes: local > project > user, entry used whole', async () => {
  const { by, proj } = await mcpFx({ trusted: true, user: { enableAllProjectMcpServers: true } })
  expect(by('both', 'project').state.shadowedBy).toBeUndefined(); expect(by('both', 'user').state.shadowedInProjects).toEqual([proj])
})

const sk = (name: string, scope: Skill['scope'], over: Partial<Skill> = {}): Skill => ({ id: `${scope}:${over.source ?? ''}:${name}`, name, description: '', scope, dir: `/x/${scope}/${over.source ?? ''}/${name}`, skillFile: '', frontmatter: { name }, files: [], lastModified: '', errors: [], ...over })
test('F16: personal beats project; plugin skills are namespaced and never conflict; skill beats command; both names invoke', () => {
  const a = analyzeSkillNames([sk('deploy', 'user'), sk('deploy', 'project', { source: '/p' }), sk('deploy', 'plugin', { source: 'pl@m' }), sk('deploy', 'legacy-command', { frontmatter: {} })], BUILTIN_COMMAND_NAMES)
  const proj = a.get('project:/p:deploy')!, user = a.get('user::deploy')!
  expect(proj.status).toBe('shadowed'); expect(proj.conflicts[0]).toMatchObject({ kind: 'shadowed-by', name: '/deploy' }); expect(user.status).toBe('active'); expect(user.conflicts.map((c) => c.kind)).toEqual(expect.arrayContaining(['shadows']))
  expect(a.get('plugin:pl@m:deploy')!.conflicts).toEqual([]); expect(a.get('plugin:pl@m:deploy')!.names).toEqual(['/pl:deploy'])
  expect(a.get('legacy-command::deploy')!.conflicts[0]).toMatchObject({ kind: 'command-overridden' })
  const two = analyzeSkillNames([sk('x', 'user', { dir: '/s/dirname', frontmatter: { name: 'fancy' } })], new Set()); expect(two.get('user::x')!.names).toEqual(['/fancy', '/dirname'])
})
test('F16: partial shadowing, reserved names, built-in replacement, two same-rank skills = duplicate; projects do not interact', () => {
  const a = analyzeSkillNames([sk('a', 'user', { dir: '/u/deploy', frontmatter: { name: 'x1' } }), sk('b', 'project', { source: '/p', dir: '/p/.claude/skills/deploy', frontmatter: { name: 'y1' } }),
    sk('ship', 'user'), sk('compact', 'user'), sk('d1', 'user', { dir: '/u/d1', frontmatter: { name: 'same' } }), sk('d2', 'user', { dir: '/u/d2', frontmatter: { name: 'same' } }), sk('z', 'project', { source: '/other', dir: '/other/z', frontmatter: { name: 'deploy' } })], BUILTIN_COMMAND_NAMES)
  expect(a.get('project:/p:b')!.status).toBe('partial') // /y1 free, /deploy taken by personal skill dir
  expect(a.get('user::ship')!.status).toBe('reserved'); expect(a.get('user::ship')!.conflicts[0]!.kind).toBe('reserved')
  expect(a.get('user::compact')!.conflicts.map((c) => c.kind)).toContain('replaces-builtin')
  expect(a.get('user::d1')!.conflicts[0]!.kind).toBe('duplicate'); expect(a.get('user::d2')!.conflicts[0]!.kind).toBe('duplicate')
  expect(a.get('project:/other:z')!.conflicts.some((c) => c.other?.id === 'project:/p:b')).toBe(false)
})

posixTest('project keys in ~/.claude.json are matched by realpath (macOS /var vs /private/var, symlinked folders); writes reuse the existing key', async () => {
  const { symlink, readFile } = await import('node:fs/promises'); const { saveMcp } = await import('../src')
  const root = await mkdtemp(path.join(tmpdir(), 'skilldock-key-')), home = path.join(root, 'home'), real = path.join(root, 'real-proj'), alias = path.join(root, 'alias-proj')
  await mkdir(path.join(home, '.claude'), { recursive: true }); await mkdir(path.join(real, '.claude'), { recursive: true }); await symlink(real, alias)
  const paths = { ...claudePaths(home), managedDirs: [] as string[] }
  await writeFile(path.join(real, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
  await writeFile(paths.userJson, JSON.stringify({ projects: { [alias]: { hasTrustDialogAccepted: true, disabledMcpServers: ['a'], enabledMcpjsonServers: [], mcpServers: { loc: { command: 'y' } } } } }))
  await writeFile(paths.userSettings, JSON.stringify({ enableAllProjectMcpServers: true }))
  const l = await listMcp(paths, [real])
  expect(l.find((s) => s.name === 'a')!.state.status).toBe('disabled'); expect(l.find((s) => s.name === 'loc')!.scope).toBe('local')
  await saveMcp({ backupRoot: path.join(root, 'bk') }, paths, [real], { scope: 'local', project: real, name: 'loc2', config: { command: 'z' } })
  const j = JSON.parse(await readFile(paths.userJson, 'utf8')); expect(Object.keys(j.projects)).toEqual([alias]); expect(j.projects[alias].mcpServers.loc2).toBeTruthy()
})

posixTest('a skill is a "link" only when its own directory is a symlink, not when an ancestor path is aliased', async () => {
  const { symlink } = await import('node:fs/promises'); const { discoverSkills } = await import('../src')
  const root = await mkdtemp(path.join(tmpdir(), 'skilldock-lnk-')), realDot = path.join(root, 'dotfiles-claude'), aliasHome = path.join(root, 'home')
  await mkdir(path.join(realDot, 'skills', 'plain'), { recursive: true }); await writeFile(path.join(realDot, 'skills', 'plain', 'SKILL.md'), '---\nname: plain\n---\n')
  await mkdir(path.join(realDot, 'shared', 'real'), { recursive: true }); await writeFile(path.join(realDot, 'shared', 'real', 'SKILL.md'), '---\nname: linked\n---\n'); await symlink(path.join(realDot, 'shared', 'real'), path.join(realDot, 'skills', 'linked'))
  await mkdir(aliasHome); await symlink(realDot, path.join(aliasHome, '.claude')) // ~/.claude is itself a symlink (dotfiles)
  const s = await discoverSkills({ claudeDir: path.join(aliasHome, '.claude') })
  expect(s.find((x) => x.name === 'plain')!.realPath).toBeUndefined(); expect(s.find((x) => x.name === 'linked')!.realPath).toBeTruthy()
})
