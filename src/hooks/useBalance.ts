import { useCallback, useEffect, useState } from 'react'
import { algodFor, type NetId } from '../lib/config'

/** Spendable microalgos for the connected account; refetch after anything that costs a fee. */
export function useBalance(net: NetId, me: string | null) {
  const [micro, setMicro] = useState<bigint | null>(null)
  const refresh = useCallback(async () => {
    if (!me) return setMicro(null)
    try {
      const info = await algodFor(net).accountInformation(me).do()
      setMicro(info.amount)
    } catch {
      setMicro(null)
    }
  }, [net, me])
  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh])
  return { micro, refresh }
}
