import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NetId } from '../lib/config'
import { fetchMessages, type ChainMessage } from '../lib/chain'
import { loadMailbox, saveMailbox } from '../lib/cache'

const POLL_MS = 6000

/**
 * The on-chain mailbox for one address. Opens from the local cache, syncs
 * from the last cached round, then polls incrementally. Optimistic "pending"
 * entries show a message from the moment Send is pressed until the indexer
 * has it.
 */
export function useMailbox(net: NetId, me: string | null, onNew?: (incoming: ChainMessage[]) => void) {
  const [messages, setMessages] = useState<ChainMessage[]>([])
  const [pending, setPending] = useState<ChainMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const maxRound = useRef<bigint | null>(null)
  const failures = useRef(0)
  const onNewRef = useRef(onNew)
  useEffect(() => {
    onNewRef.current = onNew
  }, [onNew])

  const refresh = useCallback(async () => {
    if (!me) return
    try {
      const from = maxRound.current === null ? undefined : maxRound.current + 1n
      const fresh = await fetchMessages(net, me, from)
      if (fresh.length) {
        maxRound.current = fresh.reduce((m, x) => (x.round > m ? x.round : m), maxRound.current ?? 0n)
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id))
          const add = fresh.filter((m) => !known.has(m.id))
          if (from !== undefined) onNewRef.current?.(add.filter((m) => m.from !== me))
          const next = add.length ? [...prev, ...add] : prev
          if (add.length) saveMailbox(net, me, maxRound.current!, next)
          return next
        })
        setPending((p) => p.filter((x) => !fresh.some((m) => m.id === x.id)))
      } else if (maxRound.current === null) {
        maxRound.current = 0n
      }
      failures.current = 0
      setError(null)
    } catch (e) {
      failures.current += 1
      setError(`Indexer unreachable: ${(e as Error).message}`)
    }
  }, [net, me])

  useEffect(() => {
    setPending([])
    failures.current = 0
    if (!me) {
      setMessages([])
      maxRound.current = null
      return
    }
    const cached = loadMailbox(net, me)
    setMessages(cached?.messages ?? [])
    maxRound.current = cached?.maxRound ?? null
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    // Fixed cadence while healthy; back off (to 60 s) while the indexer is failing.
    const tick = async () => {
      setLoading(maxRound.current === null)
      await refresh()
      setLoading(false)
      if (stopped) return
      timer = setTimeout(tick, Math.min(POLL_MS * 2 ** failures.current, 60_000))
    }
    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [me, net, refresh])

  /** Optimistic entries keyed by a local id; `update` swaps in the real txid once known. */
  const addPending = useCallback((m: ChainMessage) => setPending((p) => [...p, m]), [])
  const updatePending = useCallback(
    (localId: string, patch: Partial<ChainMessage>) => setPending((p) => p.map((x) => (x.id === localId ? { ...x, ...patch } : x))),
    [],
  )
  const removePending = useCallback((localId: string) => setPending((p) => p.filter((x) => x.id !== localId)), [])

  // A poll can land between confirmation and the optimistic update; never show both copies.
  const visiblePending = useMemo(() => {
    const known = new Set(messages.map((m) => m.id))
    return pending.filter((p) => !known.has(p.id))
  }, [messages, pending])

  return { messages, pending: visiblePending, loading, error, refresh, addPending, updatePending, removePending }
}
