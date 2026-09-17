import type { ChainMessage } from './chain'
import { b64 } from './crypto'
import type { Payload } from './protocol'

/**
 * Mailbox cache per (network, address) so the app opens instantly and only
 * syncs rounds it hasn't seen. Messages are immutable once confirmed, so the
 * cache never needs invalidation — only appending.
 */
const key = (net: string, me: string) => `algochat:mbox:${net}:${me}`
const MAX_BYTES = 3_500_000 // stay under typical localStorage quotas

type Wire = { id: string; from: string; to: string; round: string; time: number; txCount: number; p: Record<string, string> }
type Stored = { v: 1; maxRound: string; messages: Wire[] }

function toWire(m: ChainMessage): Wire {
  const p: Record<string, string> = { kind: m.payload.kind }
  if (m.payload.kind === 'plain') p.text = m.payload.text
  else if (m.payload.kind === 'enc') {
    p.senderPub = b64.enc(m.payload.senderPub)
    p.nonce = b64.enc(m.payload.nonce)
    p.box = b64.enc(m.payload.box)
  } else p.pub = b64.enc(m.payload.pub)
  return { id: m.id, from: m.from, to: m.to, round: m.round.toString(), time: m.time, txCount: m.txCount, p }
}

function fromWire(w: Wire): ChainMessage | null {
  let payload: Payload
  try {
    if (w.p.kind === 'plain') payload = { kind: 'plain', text: w.p.text }
    else if (w.p.kind === 'enc') payload = { kind: 'enc', senderPub: b64.dec(w.p.senderPub), nonce: b64.dec(w.p.nonce), box: b64.dec(w.p.box) }
    else if (w.p.kind === 'key') payload = { kind: 'key', pub: b64.dec(w.p.pub) }
    else return null
  } catch {
    return null
  }
  return { id: w.id, from: w.from, to: w.to, round: BigInt(w.round), time: w.time, txCount: w.txCount, payload }
}

export function loadMailbox(net: string, me: string): { maxRound: bigint; messages: ChainMessage[] } | null {
  try {
    const raw = localStorage.getItem(key(net, me))
    if (!raw) return null
    const s = JSON.parse(raw) as Stored
    if (s.v !== 1) return null
    return { maxRound: BigInt(s.maxRound), messages: s.messages.map(fromWire).filter((m): m is ChainMessage => m !== null) }
  } catch {
    return null
  }
}

export function saveMailbox(net: string, me: string, maxRound: bigint, messages: ChainMessage[]) {
  const confirmed = messages.filter((m) => m.round > 0n && !m.status)
  let wire = confirmed.map(toWire)
  let json = JSON.stringify({ v: 1, maxRound: maxRound.toString(), messages: wire } satisfies Stored)
  // Over budget: drop the oldest messages; they'll refetch on demand if ever needed.
  while (json.length > MAX_BYTES && wire.length > 50) {
    wire = wire.slice(Math.ceil(wire.length / 4))
    json = JSON.stringify({ v: 1, maxRound: maxRound.toString(), messages: wire } satisfies Stored)
  }
  try {
    localStorage.setItem(key(net, me), json)
  } catch {
    /* quota — the chain is the source of truth anyway */
  }
}

export function clearMailbox(net: string, me: string) {
  localStorage.removeItem(key(net, me))
}
