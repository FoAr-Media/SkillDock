import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { discoverSkills, parseSkillMd } from '../src'
const posixTest = process.platform === 'win32' ? test.skip : test // relies on POSIX permission bits / symlinks

test('parseSkillMd tolerates bad input', () => {
  expect(parseSkillMd('---\nname: a\ndescription: b\n---\nbody').frontmatter).toEqual({ name: 'a', description: 'b' })
  expect(parseSkillMd('no fm').errors).toHaveLength(1)
  expect(parseSkillMd('---\n: : [\n---\nx').errors[0]).toMatch(/invalid YAML/)
})

posixTest('discovers user (incl. symlinked), project, plugin skills and legacy commands without modifying anything', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skilldock-'))
  const claude = path.join(root, '.claude'), proj = path.join(root, 'proj'), shared = path.join(root, 'shared')
  await mkdir(path.join(claude, 'skills'), { recursive: true })
  await mkdir(path.join(shared, 'linked'), { recursive: true })
  await writeFile(path.join(shared, 'linked', 'SKILL.md'), '---\nname: linked\ndescription: via symlink\n---\n')
  await symlink(path.join(shared, 'linked'), path.join(claude, 'skills', 'linked'))
  await mkdir(path.join(claude, 'skills', 'plain'))
  await writeFile(path.join(claude, 'skills', 'plain', 'SKILL.md'), '---\ndescription: plain one\n---\n')
  await mkdir(path.join(claude, 'skills', 'notaskill'))
  await mkdir(path.join(claude, 'commands'))
  await writeFile(path.join(claude, 'commands', 'deploy.md'), '---\ndescription: ship it\n---\nrun')
  await mkdir(path.join(proj, '.claude', 'skills', 'p1'), { recursive: true })
  await writeFile(path.join(proj, '.claude', 'skills', 'p1', 'SKILL.md'), '---\nname: p1\n---\n')
  const plug = path.join(root, 'plug')
  await mkdir(path.join(plug, 'skills', 'ps'), { recursive: true })
  await writeFile(path.join(plug, 'skills', 'ps', 'SKILL.md'), '---\nname: ps\n---\n')
  await mkdir(path.join(claude, 'plugins'))
  await writeFile(path.join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'x@m': [{ installPath: plug }] } }))

  const skills = await discoverSkills({ claudeDir: claude, projects: [proj] })
  const by = Object.fromEntries(skills.map((s) => [`${s.scope}/${s.name}`, s]))
  expect(Object.keys(by).sort()).toEqual(['legacy-command/deploy', 'plugin/ps', 'project/p1', 'user/linked', 'user/plain'])
  expect(by['user/linked']!.realPath).toBeTruthy()
  expect(by['user/linked']!.description).toBe('via symlink')
  expect(by['user/plain']!.name).toBe('plain') // falls back to dir name
})
