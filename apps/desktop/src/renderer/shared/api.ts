import { useCallback, useEffect, useState } from 'react'

declare global { interface Window { skilldock: { invoke(channel: string, payload?: unknown): Promise<unknown> } } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type A = any

export class ApiError extends Error {}
export async function call<T = A>(channel: string, payload?: unknown): Promise<T> {
  try { return (await window.skilldock.invoke(channel, payload)) as T } catch (e) {
    let m = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    if (m.startsWith('[') && m.includes('"message"')) { try { m = JSON.parse(m).map((i: A) => `${i.path?.join('.') ?? ''} ${i.message}`.trim()).join('; ') } catch { /* keep */ } }
    throw new ApiError(m)
  }
}
export function useCall<T = A>(channel: string, payload?: unknown, deps: unknown[] = []) {
  const [data, setData] = useState<T>(); const [error, setError] = useState<string>(); const [loading, setLoading] = useState(true)
  const load = useCallback(() => { setLoading(true); call<T>(channel, payload).then((d) => { setData(d); setError(undefined) }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false)) }, [channel, JSON.stringify(payload), ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])
  return { data, error, loading, reload: load }
}
