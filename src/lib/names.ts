import algosdk from 'algosdk'
import { NetworkId } from '@txnlab/use-wallet'
import type { NetId } from './config'

/**
 * Two name layers: local nicknames (yours alone, in this browser) and NFD
 * `.algo` names resolved through the NFDomains API. Reverse lookups only hit
 * addresses their owner has verified, so most addresses stay bare.
 */
const NFD_API: Partial<Record<NetId, string>> = {
  [NetworkId.MAINNET]: 'https://api.nf.domains',
  [NetworkId.TESTNET]: 'https://api.testnet.nf.domains',
}

const nickKey = (net: string, me: string) => `algochat:nicks:${net}:${me}`

export function loadNicknames(net: string, me: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(nickKey(net, me)) ?? '{}')
  } catch {
    return {}
  }
}

export function saveNickname(net: string, me: string, addr: string, name: string) {
  const all = loadNicknames(net, me)
  if (name.trim()) all[addr] = name.trim()
  else delete all[addr]
  localStorage.setItem(nickKey(net, me), JSON.stringify(all))
  return all
}

export const isNfdName = (s: string) => /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.algo$/i.test(s.trim())

/** `.algo` name → deposit address, or null if unknown / no API for this network. */
export async function resolveNfd(net: NetId, name: string): Promise<string | null> {
  const api = NFD_API[net]
  if (!api) return null
  const r = await fetch(`${api}/nfd/${encodeURIComponent(name.trim().toLowerCase())}?view=tiny`)
  if (!r.ok) return null
  const j = (await r.json()) as { depositAccount?: string; owner?: string }
  const addr = j.depositAccount ?? j.owner
  return addr && algosdk.isValidAddress(addr) ? addr : null
}

const reverseCache = new Map<string, string | null>()

/** Addresses → verified `.algo` names. Unknown ones are omitted. */
export async function reverseNfd(net: NetId, addrs: string[]): Promise<Record<string, string>> {
  const api = NFD_API[net]
  const out: Record<string, string> = {}
  if (!api) return out
  const todo = addrs.filter((a) => !reverseCache.has(`${net}:${a}`))
  // The API takes up to 20 addresses per call.
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20)
    try {
      const qs = batch.map((a) => `address=${a}`).join('&')
      const r = await fetch(`${api}/nfd/lookup?${qs}&view=tiny`)
      const j = r.ok ? ((await r.json()) as Record<string, { name?: string }>) : {}
      for (const a of batch) reverseCache.set(`${net}:${a}`, j[a]?.name ?? null)
    } catch {
      for (const a of batch) reverseCache.set(`${net}:${a}`, null)
    }
  }
  for (const a of addrs) {
    const n = reverseCache.get(`${net}:${a}`)
    if (n) out[a] = n
  }
  return out
}
