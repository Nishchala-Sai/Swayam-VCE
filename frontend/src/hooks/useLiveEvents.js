// Live (bookable) events from the backend, with seat counts. Fetched once and shared by every page; call reload()
// after something that changes seats, such as a registration.
// A failed load is not kept: the next page that needs events tries again (the API may just have been waking up).
// Coming back to the browser tab refreshes events older than a minute, so seat counts don't go stale.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { fromLive } from '../lib/events'

const STALE_MS = 60e3
let cache = null // { events, error, at }
let inflight = null
const listeners = new Set()

async function load() {
  inflight ??= Promise.all([api('/events'), api('/events/availability').catch(() => [])])
    .then(([events, seats]) => {
      const availability = Object.fromEntries((seats ?? []).map((s) => [s.eventId, s]))
      cache = { events: (events ?? []).map((e) => fromLive(e, availability)), error: null, at: Date.now() }
    })
    .catch((err) => {
      // Keep events from an earlier good load, if any, so a blip doesn't empty the page
      cache = { events: cache?.events ?? [], error: cache?.events?.length ? null : err.message, at: 0 }
    })
    .finally(() => {
      inflight = null
      listeners.forEach((fn) => fn(cache))
    })
  return inflight
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && listeners.size && (!cache || Date.now() - cache.at > STALE_MS)) load()
  })
}

export function useLiveEvents() {
  const [state, setState] = useState(cache)

  useEffect(() => {
    listeners.add(setState)
    if (!cache || cache.error || Date.now() - cache.at > STALE_MS) load()
    else setState(cache)
    return () => listeners.delete(setState)
  }, [])

  const reload = useCallback(() => load(), [])
  return { live: state?.events ?? [], loading: !state, error: state?.error ?? null, reload }
}
