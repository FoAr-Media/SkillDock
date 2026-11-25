import { type A, useCall } from '../../shared/api'

/** Warns when a Claude config file exists but cannot be parsed (it would otherwise look like "nothing configured"). */
export function ConfigHealth() {
  const r = useCall<A[]>('config:health'); if (!r.data?.length) return null
  return <div className="errorbox" role="alert"><b>Unreadable Claude configuration.</b> These files are not valid JSON, so what they define is not listed here and this app will not modify them until they are fixed:
    <ul>{r.data.map((f) => <li key={f.file}><code>{f.label}</code> — {f.error}</li>)}</ul></div>
}
