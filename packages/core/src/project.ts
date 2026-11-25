import { listMcp } from './mcp'
import { listHooks } from './hooks'
import { configFiles, inheritance, listAgents } from './workspace'
import { exists } from './fsutil'
import path from 'node:path'
import type { ClaudePaths } from './paths'
import { discoverSkills } from './skills'

export async function projectOverview(paths: ClaudePaths, project: string) {
  const [skills, mcp, agents, hooks, inh, files, git] = await Promise.all([
    discoverSkills({ claudeDir: paths.claudeDir, projects: [project] }).then((l) => l.filter((s) => s.scope === 'project' && s.source === project)),
    listMcp(paths, [project]).then((l) => l.filter((s) => s.project === project)),
    listAgents(paths, [project]).then((l) => l.filter((a) => a.project === project)),
    listHooks(paths, [project]).then((r) => r.hooks.filter((h) => h.project === project)),
    inheritance(paths, project), configFiles(paths, [project]).then((l) => l.filter((f) => f.project === project)), exists(path.join(project, '.git'))
  ])
  return { path: project, isGit: git, skills, mcp, agents, hooks, inheritance: inh, files }
}

