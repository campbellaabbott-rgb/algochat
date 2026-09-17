import { useCallback, useEffect, useState } from 'react'
import { MIN_BALANCE, algodFor, type NetId } from '../lib/config'

/**
 * Spendable microalgos for the connected account. Polls fast while the
 * account is unfunded (someone is probably waiting on a dispenser), slowly
 * once it has a balance; refetch after anything that costs a fee.
 */
export function useBalance(net: NetId, me: string | null) {
  const [micro, setMicro] = useState<bigint | null>(null)
  const refresh = useCallback(async () => {
    if (!me) return
    try {
      const info = await algodFor(net).accountInformation(me).do()
      setMicro(info.amount)
    } catch {
      setMicro(null)
    }
  }, [net, me])
  useEffect(() => {
    setMicro(null)
    if (!me) return
    void refresh()
  }, [me, refresh])
  useEffect(() => {
    if (!me) return
    const fast = micro === null || micro < BigInt(MIN_BALANCE)
    const t = setInterval(refresh, fast ? 5_000 : 30_000)
    return () => clearInterval(t)
  }, [me, micro, refresh])
  return { micro, refresh }
}
