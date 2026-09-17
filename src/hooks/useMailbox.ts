import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NetId } from '../lib/config'
import { fetchMessages, type ChainMessage } from '../lib/chain'

const POLL_MS = 6000

/**
 * The on-chain mailbox for one address: full fetch on connect, then
 * incremental polls from the last confirmed round. Optimistic "pending"
 * entries bridge the gap between algod confirmation and indexer visibility.
 */
export function useMailbox(net: NetId, me: string | null, onNew?: (incoming: ChainMessage[]) => void) {
  const [messages, setMessages] = useState<ChainMessage[]>([])
  const [pending, setPending] = useState<ChainMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const maxRound = useRef<bigint | null>(null)
  const onNewRef = useRef(onNew)
  onNewRef.current = onNew

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
          return add.length ? [...prev, ...add] : prev
        })
        setPending((p) => p.filter((x) => !fresh.some((m) => m.id === x.id)))
      } else if (maxRound.current === null) {
        maxRound.current = 0n
      }
      setError(null)
    } catch (e) {
      setError(`Indexer unreachable: ${(e as Error).message}`)
    }
  }, [net, me])

  useEffect(() => {
    setMessages([])
    setPending([])
    maxRound.current = null
    if (!me) return
    setLoading(true)
    refresh().finally(() => setLoading(false))
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [me, refresh])

  const addPending = useCallback((m: ChainMessage) => setPending((p) => [...p, m]), [])

  // A poll can land between confirmation and the optimistic insert; never show both copies.
  const visiblePending = useMemo(() => {
    const known = new Set(messages.map((m) => m.id))
    return pending.filter((p) => !known.has(p.id))
  }, [messages, pending])

  return { messages, pending: visiblePending, loading, error, refresh, addPending }
}
