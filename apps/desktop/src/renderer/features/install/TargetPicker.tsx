import { type A, useCall } from '../../shared/api'

export type Target = { scope: 'user' | 'project'; project?: string }
export function TargetPicker({ value, onChange }: { value: Target; onChange: (t: Target) => void }) {
  const projects = useCall<A[]>('projects:list')
  return (
    <label className="field">Install scope
      <select aria-label="Install scope" value={value.scope === 'user' ? 'user' : value.project} onChange={(e) => onChange(e.target.value === 'user' ? { scope: 'user' } : { scope: 'project', project: e.target.value })}>
        <option value="user">Global (user) — ~/.claude/skills</option>
        {(projects.data ?? []).map((p) => <option key={p.path} value={p.path}>Project — {p.path}</option>)}
      </select>
    </label>
  )
}
