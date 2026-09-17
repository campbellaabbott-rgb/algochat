import algosdk from 'algosdk'
import { MAX_NOTE_BYTES, MIN_BALANCE, algodFor, indexerFor, type NetId } from './config'
import { PREFIX, PREFIX_KEY, decodeNote, encodeEncrypted, encodeKey, encodePlain, type Payload } from './protocol'
import { encrypt, type EncKeys } from './crypto'

export type ChainMessage = {
  id: string
  from: string
  to: string
  round: bigint
  time: number // unix seconds
  payload: Payload
}

type Signer = (txns: algosdk.Transaction[], indexes: number[]) => Promise<Uint8Array[]>

/** Every amsg1 payment where `addr` is sender or receiver, oldest first. */
export async function fetchMessages(net: NetId, addr: string, minRound?: bigint): Promise<ChainMessage[]> {
  const indexer = indexerFor(net)
  const out: ChainMessage[] = []
  let next: string | undefined
  do {
    let q = indexer
      .searchForTransactions()
      .address(addr)
      .txType('pay')
      .notePrefix(new TextEncoder().encode(PREFIX))
      .limit(1000)
    if (minRound !== undefined) q = q.minRound(minRound)
    if (next) q = q.nextToken(next)
    const res = await q.do()
    for (const t of res.transactions) {
      const to = t.paymentTransaction?.receiver
      if (!to) continue
      const payload = decodeNote(t.note)
      if (!payload || payload.kind === 'key') continue
      out.push({ id: t.id ?? '', from: t.sender, to, round: t.confirmedRound ?? 0n, time: t.roundTime ?? 0, payload })
    }
    next = res.nextToken
  } while (next)
  out.sort((a, b) => (a.round === b.round ? 0 : a.round < b.round ? -1 : 1))
  return out
}

/** Latest x25519 key `addr` announced for itself, or null if it never has. */
export async function fetchPublishedKey(net: NetId, addr: string): Promise<Uint8Array | null> {
  const res = await indexerFor(net)
    .searchForTransactions()
    .address(addr)
    .addressRole('sender')
    .txType('pay')
    .notePrefix(new TextEncoder().encode(PREFIX_KEY))
    .limit(1000)
    .do()
  let best: { round: bigint; pub: Uint8Array } | null = null
  for (const t of res.transactions) {
    if (t.paymentTransaction?.receiver !== addr) continue // only self-announcements count
    const p = decodeNote(t.note)
    if (p?.kind !== 'key') continue
    const round = t.confirmedRound ?? 0n
    if (!best || round > best.round) best = { round, pub: p.pub }
  }
  return best?.pub ?? null
}

export async function isFunded(net: NetId, addr: string): Promise<boolean> {
  try {
    const info = await algodFor(net).accountInformation(addr).do()
    return info.amount >= BigInt(MIN_BALANCE)
  } catch {
    return false
  }
}

async function sendNote(net: NetId, from: string, to: string, note: Uint8Array, signer: Signer): Promise<string> {
  if (note.length > MAX_NOTE_BYTES) throw new Error(`Message too long (${note.length} of ${MAX_NOTE_BYTES} bytes)`)
  const algod = algodFor(net)
  const suggestedParams = await algod.getTransactionParams().do()
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: from, receiver: to, amount: 0, note, suggestedParams })
  const [signed] = await signer([txn], [0])
  const { txid } = await algod.sendRawTransaction(signed).do()
  await algosdk.waitForConfirmation(algod, txid, 8)
  return txid
}

export function publishKey(net: NetId, addr: string, keys: EncKeys, signer: Signer) {
  return sendNote(net, addr, addr, encodeKey(keys.publicKey), signer)
}

export function buildMessageNote(text: string, mine: EncKeys, theirPub: Uint8Array | null): Uint8Array {
  if (!theirPub) return encodePlain(text)
  const { nonce, box } = encrypt(text, theirPub, mine)
  return encodeEncrypted(mine.publicKey, nonce, box)
}

export async function sendMessage(net: NetId, from: string, to: string, note: Uint8Array, signer: Signer) {
  if (!(await isFunded(net, to))) {
    throw new Error('Recipient has never been funded; Algorand refuses payments that leave an account under 0.1 ALGO.')
  }
  return sendNote(net, from, to, note, signer)
}

/** algod errors embed the whole account record; keep the part a person can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/overspend/.test(msg)) return 'Your account has no ALGO to cover the 0.001 fee. Fund it first (TestNet dispenser link on the start page).'
  if (/below min/.test(msg)) return 'Recipient would end below the 0.1 ALGO minimum balance, so Algorand rejected the payment.'
  if (/rejected|cancel/i.test(msg)) return 'Signature request was rejected in the wallet.'
  return msg.split(', data {')[0].slice(0, 300)
}
