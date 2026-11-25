export type Status = 'connected' | 'not-installed' | 'config-missing' | 'config-invalid' | 'permission-required'

export interface ToolStatus { id: string; label: string; status: Status; version?: string; path?: string; detail?: string }

export type SkillScope = 'user' | 'project' | 'plugin' | 'legacy-command'

export interface Skill {
  id: string
  name: string
  description: string
  scope: SkillScope
  /** project path or plugin id, when applicable */
  source?: string
  dir: string
  skillFile: string
  /** symlink target when `dir` (or file) is a link */
  realPath?: string
  frontmatter: Record<string, unknown>
  files: string[]
  lastModified: string
  errors: string[]
}
