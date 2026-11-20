import { useEffect, useState } from 'react'

// Small fetch hook: re-runs when deps change, ignores stale responses.
export function useData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    load().then(d => live && setData(d)).catch(e => live && setError(String(e.message ?? e)))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error }
}

export function Status({ error, label = 'Loading' }: { error: string | null; label?: string }) {
  return error
    ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Couldn't load this page. {error}</p>
    : <p className="py-8 text-center text-stone-500">{label}…</p>
}
