import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import algosdk from 'algosdk'
import nacl from 'tweetnacl'
import { NetworkId } from '@txnlab/use-wallet'
import { buildMessageNote, fetchMessages, fetchPublishedKey, isFunded, publishKey, sendMessage } from '../chain'
import { decrypt, type EncKeys } from '../crypto'

/**
 * End-to-end over HTTP against scripts/mockchain.mjs on non-default ports:
 * real algosdk signing, real note encoding, real indexer parsing.
 */
const ALGOD = 4101
const INDEXER = 8981
const NET = NetworkId.LOCALNET

vi.mock('../config', async (orig) => {
  const m = await orig<typeof import('../config')>()
  return {
    ...m,
    indexerFor: () => new algosdk.Indexer('', 'http://localhost', INDEXER),
    algodFor: () => new algosdk.Algodv2('', 'http://localhost', ALGOD),
  }
})

const signerFor = (acct: algosdk.Account) => async (txns: algosdk.Transaction[], idx: number[]) => idx.map((i) => txns[i].signTxn(acct.sk))

let proc: ChildProcess
const alice = algosdk.generateAccount()
const bob = algosdk.generateAccount()
const carol = algosdk.generateAccount() // never funded
const aliceKeys: EncKeys = nacl.box.keyPair()
const bobKeys: EncKeys = nacl.box.keyPair()
const A = alice.addr.toString()
const B = bob.addr.toString()
const C = carol.addr.toString()

beforeAll(async () => {
  proc = spawn('node', ['scripts/mockchain.mjs', '--algod', String(ALGOD), '--indexer', String(INDEXER), '--fund', `${A},${B}`], { stdio: 'pipe' })
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://localhost:${ALGOD}/health`)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('mockchain did not start')
}, 15_000)

afterAll(() => proc.kill())

describe('two funded accounts on the mock chain', () => {
  it('starts with empty mailboxes and no keys', async () => {
    expect(await fetchMessages(NET, A)).toEqual([])
    expect(await fetchPublishedKey(NET, A)).toBeNull()
    expect(await isFunded(NET, A)).toBe(true)
    expect(await isFunded(NET, C)).toBe(false)
  })

  it('publishes keys that the other side can look up', async () => {
    await publishKey(NET, A, aliceKeys, signerFor(alice))
    await publishKey(NET, B, bobKeys, signerFor(bob))
    expect(await fetchPublishedKey(NET, A)).toEqual(aliceKeys.publicKey)
    expect(await fetchPublishedKey(NET, B)).toEqual(bobKeys.publicKey)
    // key announcements are not messages
    expect(await fetchMessages(NET, A)).toEqual([])
  })

  it('delivers an encrypted message A→B that only B (and A) can read', async () => {
    const bobPub = await fetchPublishedKey(NET, B)
    const note = buildMessageNote('meet at the pier', aliceKeys, bobPub)
    const id = await sendMessage(NET, A, B, note, signerFor(alice))
    expect(id).toMatch(/^[A-Z2-7]{52}$/)

    const inbox = await fetchMessages(NET, B)
    expect(inbox).toHaveLength(1)
    const m = inbox[0]
    expect(m).toMatchObject({ id, from: A, to: B })
    expect(m.round).toBeGreaterThan(0n)
    expect(m.payload.kind).toBe('enc')
    if (m.payload.kind !== 'enc') return
    expect(decrypt(m.payload.box, m.payload.nonce, m.payload.senderPub, bobKeys)).toBe('meet at the pier')
    expect(decrypt(m.payload.box, m.payload.nonce, bobPub!, aliceKeys)).toBe('meet at the pier')
    expect(decrypt(m.payload.box, m.payload.nonce, m.payload.senderPub, nacl.box.keyPair())).toBeNull()
  })

  it('B replies; both mailboxes show the thread in order', async () => {
    const alicePub = await fetchPublishedKey(NET, A)
    await sendMessage(NET, B, A, buildMessageNote('see you there', bobKeys, alicePub), signerFor(bob))
    const forA = await fetchMessages(NET, A)
    const forB = await fetchMessages(NET, B)
    expect(forA.map((m) => [m.from, m.to])).toEqual([[A, B], [B, A]])
    expect(forB.map((m) => m.id)).toEqual(forA.map((m) => m.id))
    expect(forA[0].round < forA[1].round).toBe(true)
  })

  it('falls back to plaintext for a peer with no key, and is readable by anyone', async () => {
    await fetch(`http://localhost:${ALGOD}/fund?addr=${C}`, { method: 'POST' })
    expect(await fetchPublishedKey(NET, C)).toBeNull()
    await sendMessage(NET, A, C, buildMessageNote('hello stranger', aliceKeys, null), signerFor(alice))
    const inbox = await fetchMessages(NET, C)
    expect(inbox[0].payload).toEqual({ kind: 'plain', text: 'hello stranger' })
  })

  it('refuses an unfunded recipient before signing', async () => {
    const dave = algosdk.generateAccount().addr.toString()
    const signer = vi.fn(signerFor(alice))
    await expect(sendMessage(NET, A, dave, buildMessageNote('x', aliceKeys, null), signer)).rejects.toThrow(/never been funded/)
    expect(signer).not.toHaveBeenCalled()
  })

  it('the chain rejects a forged signature', async () => {
    const mallory = algosdk.generateAccount()
    const forged = async (txns: algosdk.Transaction[], idx: number[]) => idx.map((i) => txns[i].signTxn(mallory.sk))
    await expect(sendMessage(NET, A, B, buildMessageNote('x', aliceKeys, null), forged)).rejects.toThrow(/signature is invalid/)
  })

  it('rejects a note over 1024 bytes', async () => {
    await expect(sendMessage(NET, A, B, new Uint8Array(1025), signerFor(alice))).rejects.toThrow(/too long/)
  })
})
