#!/usr/bin/env node
/**
 * A tiny in-memory Algorand stand-in for local development and tests.
 *
 * Speaks the algod + indexer REST subset AlgoChat uses, on the AlgoKit
 * LocalNet ports (algod 4001, indexer 8980) so the app's "LocalNet" entry
 * works against either. Submitted transactions are decoded with algosdk,
 * their ed25519 signatures verified, and fee / minimum-balance rules applied,
 * so the signing and encoding paths are exercised for real. It is NOT a
 * consensus node: no TEAL, no assets, no groups.
 *
 *   node scripts/mockchain.mjs [--fund ADDR[,ADDR...]] [--algod 4001] [--indexer 8980]
 *
 * POST /fund?addr=ADDR&amount=MICROALGOS on the algod port funds an account.
 */
import http from 'node:http'
import nacl from 'tweetnacl'
import algosdk from 'algosdk'
import { decodeMulti } from 'algorand-msgpack'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length))
const ALGOD_PORT = Number(args.algod ?? 4001)
const INDEXER_PORT = Number(args.indexer ?? 8980)
const MIN_FEE = 1000n
const MIN_BALANCE = 100_000n
const GENESIS_ID = 'mockchain-v1'
const GENESIS_HASH = nacl.hash(new TextEncoder().encode(GENESIS_ID)).slice(0, 32)

const balances = new Map() // addr -> bigint microalgos
const txns = [] // { id, round, time, stxn, txn }
let round = 1n
const seen = new Set()

const bal = (a) => balances.get(a) ?? 0n
const b64 = (u8) => Buffer.from(u8).toString('base64')

for (const a of (args.fund ?? '').split(',').filter(Boolean)) balances.set(a, 10_000_000n)

/** Validate one signed txn against the current ledger; returns the balance deltas without committing. */
function check(stxn, deltas) {
  const txn = stxn.txn
  const id = txn.txID()
  const cur = (a) => bal(a) + (deltas.get(a) ?? 0n)
  if (seen.has(id)) throw new Error(`TransactionPool.Remember: transaction already in ledger: ${id}`)
  if (txn.type !== 'pay') throw new Error(`mockchain only supports pay transactions, got ${txn.type}`)
  if (!stxn.sig) throw new Error('mockchain only supports plain ed25519 signatures')
  const sender = txn.sender.toString()
  const pk = algosdk.decodeAddress(sender).publicKey
  if (!nacl.sign.detached.verify(txn.bytesToSign(), stxn.sig, pk)) throw new Error(`TransactionPool.Remember: transaction ${id}: signature is invalid`)
  if (txn.fee < MIN_FEE) throw new Error(`TransactionPool.Remember: transaction ${id}: fee ${txn.fee} below threshold ${MIN_FEE}`)
  if (round < txn.firstValid || round > txn.lastValid) throw new Error(`TransactionPool.Remember: transaction ${id}: round ${round} outside of ${txn.firstValid}-${txn.lastValid}`)
  if (txn.note && txn.note.length > 1024) throw new Error(`TransactionPool.Remember: transaction ${id}: note too big: ${txn.note.length} > 1024`)
  const receiver = txn.payment.receiver.toString()
  const amount = txn.payment.amount
  const spend = amount + txn.fee
  if (cur(sender) < spend) throw new Error(`TransactionPool.Remember: transaction ${id}: overspend (account ${sender}, tried to spend ${spend})`)
  deltas.set(sender, (deltas.get(sender) ?? 0n) - spend)
  deltas.set(receiver, (deltas.get(receiver) ?? 0n) + amount)
  for (const a of [sender, receiver]) {
    const after = cur(a)
    if (after > 0n && after < MIN_BALANCE) throw new Error(`TransactionPool.Remember: transaction ${id}: account ${a} balance ${after} below min ${MIN_BALANCE}`)
  }
  return id
}

/** A POST body is one signed txn or a concatenation forming an atomic group. */
function apply(rawBytes) {
  const stxns = [...decodeMulti(rawBytes)].map((o) => algosdk.decodeSignedTransaction(algosdk.msgpackRawEncode(o)))
  if (stxns.length > 16) throw new Error('TransactionPool.Remember: group size exceeds 16')
  if (stxns.length > 1) {
    // rawTxID covers the group field, so recompute over group-less copies.
    const bare = stxns.map((s) => { const t = algosdk.decodeUnsignedTransaction(algosdk.encodeUnsignedTransaction(s.txn)); t.group = undefined; return t })
    const gid = algosdk.computeGroupID(bare)
    for (const s of stxns) {
      if (!s.txn.group || Buffer.compare(Buffer.from(s.txn.group), Buffer.from(gid)) !== 0) throw new Error('TransactionPool.Remember: transactionGroup: incomplete group')
    }
  }
  const deltas = new Map()
  const ids = stxns.map((s) => check(s, deltas))
  for (const [a, d] of deltas) balances.set(a, bal(a) + d)
  round += 1n
  const time = Math.floor(Date.now() / 1000)
  stxns.forEach((stxn, i) => {
    seen.add(ids[i])
    txns.push({ id: ids[i], round, time, stxn, txn: stxn.txn })
  })
  return ids[0]
}

function indexerTxn(t) {
  return new algosdk.indexerModels.Transaction({
    id: t.id,
    sender: t.txn.sender.toString(),
    fee: t.txn.fee,
    firstValid: t.txn.firstValid,
    lastValid: t.txn.lastValid,
    note: t.txn.note,
    txType: 'pay',
    group: t.txn.group,
    confirmedRound: t.round,
    roundTime: t.time,
    genesisId: GENESIS_ID,
    genesisHash: GENESIS_HASH,
    paymentTransaction: new algosdk.indexerModels.TransactionPayment({ receiver: t.txn.payment.receiver.toString(), amount: t.txn.payment.amount }),
  })
}

const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))) })
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
const json = (res, obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', ...CORS }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)) }
const fail = (res, message, status = 400) => json(res, { message }, status)
const status = () => new algosdk.modelsv2.NodeStatusResponse({ lastRound: round, catchupTime: 0, lastVersion: 'v1', nextVersion: 'v1', nextVersionRound: round + 1n, nextVersionSupported: true, stoppedAtUnsupportedRound: false, timeSinceLastRound: 0 })

const algod = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  try {
    if (p === '/health' || p === '/v2/status' || p.startsWith('/v2/status/wait-for-block-after/')) return json(res, algosdk.encodeJSON(status()))
    if (p === '/v2/transactions/params') {
      return json(res, { 'consensus-version': 'mock', fee: 0, 'genesis-hash': b64(GENESIS_HASH), 'genesis-id': GENESIS_ID, 'last-round': Number(round), 'min-fee': Number(MIN_FEE) })
    }
    if (p.startsWith('/v2/accounts/')) {
      const addr = p.split('/')[3]
      return json(res, algosdk.encodeJSON(new algosdk.modelsv2.Account({ address: addr, amount: bal(addr), amountWithoutPendingRewards: bal(addr), minBalance: MIN_BALANCE, pendingRewards: 0, rewards: 0, round, status: 'Offline', totalAppsOptedIn: 0, totalAssetsOptedIn: 0, totalCreatedApps: 0, totalCreatedAssets: 0 })))
    }
    if (p === '/v2/transactions' && req.method === 'POST') {
      const id = apply(new Uint8Array(await readBody(req)))
      return json(res, { txId: id })
    }
    if (p.startsWith('/v2/transactions/pending/')) {
      const t = txns.find((x) => x.id === p.split('/')[4])
      if (!t) return fail(res, 'transaction not found', 404)
      const body = algosdk.encodeMsgpack(new algosdk.modelsv2.PendingTransactionResponse({ poolError: '', txn: t.stxn, confirmedRound: t.round }))
      res.writeHead(200, { 'content-type': 'application/msgpack', ...CORS })
      return res.end(Buffer.from(body))
    }
    if (p === '/fund' && req.method === 'POST') {
      const addr = url.searchParams.get('addr')
      if (!algosdk.isValidAddress(addr)) return fail(res, 'bad address')
      balances.set(addr, bal(addr) + BigInt(url.searchParams.get('amount') ?? 10_000_000))
      return json(res, { address: addr, amount: Number(bal(addr)) })
    }
    fail(res, `mockchain algod: no route ${req.method} ${p}`, 404)
  } catch (e) {
    fail(res, e.message)
  }
})

const indexer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  if (url.pathname !== '/v2/transactions') return fail(res, `mockchain indexer: no route ${url.pathname}`, 404)
  const q = url.searchParams
  const address = q.get('address')
  const role = q.get('address-role')
  const prefix = q.get('note-prefix') ? Buffer.from(q.get('note-prefix'), 'base64') : null
  const minRound = q.get('min-round') ? BigInt(q.get('min-round')) : 0n
  const limit = Number(q.get('limit') ?? 1000)
  const offset = Number(q.get('next') ?? 0)
  const hits = txns.filter((t) => {
    const s = t.txn.sender.toString(), r = t.txn.payment.receiver.toString()
    if (address && !(role === 'sender' ? s === address : role === 'receiver' ? r === address : s === address || r === address)) return false
    if (q.get('tx-type') && q.get('tx-type') !== 'pay') return false
    if (prefix && !(t.txn.note && Buffer.from(t.txn.note.subarray(0, prefix.length)).equals(prefix))) return false
    return t.round >= minRound
  })
  const page = hits.slice(offset, offset + limit)
  const out = new algosdk.indexerModels.TransactionsResponse({ currentRound: round, transactions: page.map(indexerTxn), nextToken: offset + limit < hits.length ? String(offset + limit) : undefined })
  json(res, algosdk.encodeJSON(out))
})

algod.listen(ALGOD_PORT, () => console.log(`mockchain algod   http://localhost:${ALGOD_PORT}`))
indexer.listen(INDEXER_PORT, () => console.log(`mockchain indexer http://localhost:${INDEXER_PORT}`))
for (const [a, v] of balances) console.log(`funded ${a} ${v}`)
