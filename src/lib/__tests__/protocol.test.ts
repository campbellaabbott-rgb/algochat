import { beforeAll, describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { decrypt, encrypt, ensureKeys, importSecret, exportSecret, loadKeys } from '../crypto'
import { decodeNote, encodeEncrypted, encodeKey, encodePlain } from '../protocol'
import { buildMessageNote } from '../chain'
import { MAX_NOTE_BYTES } from '../config'

describe('note protocol', () => {
  it('round-trips a plaintext note', () => {
    const p = decodeNote(encodePlain('hi there — ünïcödé 🚀'))
    expect(p).toEqual({ kind: 'plain', text: 'hi there — ünïcödé 🚀' })
  })

  it('round-trips a key announcement', () => {
    const kp = nacl.box.keyPair()
    const p = decodeNote(encodeKey(kp.publicKey))
    expect(p?.kind).toBe('key')
    expect(p?.kind === 'key' && p.pub).toEqual(kp.publicKey)
  })

  it('rejects garbage and foreign notes', () => {
    expect(decodeNote(undefined)).toBeNull()
    expect(decodeNote(new TextEncoder().encode('hello world'))).toBeNull()
    expect(decodeNote(new TextEncoder().encode('amsg1:e:not.enough'))).toBeNull()
    expect(decodeNote(new TextEncoder().encode('amsg1:k:AAAA'))).toBeNull()
    expect(decodeNote(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull()
  })
})

describe('encryption', () => {
  it('both parties can open a box; a third party cannot', () => {
    const alice = nacl.box.keyPair()
    const bob = nacl.box.keyPair()
    const eve = nacl.box.keyPair()
    const { nonce, box } = encrypt('secret plan', bob.publicKey, alice)
    const p = decodeNote(encodeEncrypted(alice.publicKey, nonce, box))
    expect(p?.kind).toBe('enc')
    if (p?.kind !== 'enc') return
    expect(decrypt(p.box, p.nonce, p.senderPub, bob)).toBe('secret plan') // recipient
    expect(decrypt(p.box, p.nonce, bob.publicKey, alice)).toBe('secret plan') // sender re-reads
    expect(decrypt(p.box, p.nonce, p.senderPub, eve)).toBeNull()
  })

  it('falls back to plaintext when the peer has no published key', () => {
    const alice = nacl.box.keyPair()
    expect(decodeNote(buildMessageNote('yo', alice, null))).toEqual({ kind: 'plain', text: 'yo' })
    expect(decodeNote(buildMessageNote('yo', alice, nacl.box.keyPair().publicKey))?.kind).toBe('enc')
  })

  it('fits ~680 encrypted chars into the 1024-byte note', () => {
    const alice = nacl.box.keyPair()
    const bob = nacl.box.keyPair()
    expect(buildMessageNote('x'.repeat(680), alice, bob.publicKey).length).toBeLessThanOrEqual(MAX_NOTE_BYTES)
    expect(buildMessageNote('x'.repeat(720), alice, bob.publicKey).length).toBeGreaterThan(MAX_NOTE_BYTES)
  })
})

describe('key storage', () => {
  // Node ships a stub `localStorage` global that shadows jsdom's; use a real one.
  beforeAll(() => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    })
  })

  it('persists per network+address and survives export/import', () => {
    const k1 = ensureKeys('testnet', 'ADDR')
    expect(ensureKeys('testnet', 'ADDR').secretKey).toEqual(k1.secretKey)
    expect(loadKeys('mainnet', 'ADDR')).toBeNull()
    const k2 = importSecret('mainnet', 'ADDR', exportSecret(k1))
    expect(k2.publicKey).toEqual(k1.publicKey)
    expect(() => importSecret('mainnet', 'ADDR', 'AAAA')).toThrow()
  })
})

describe('long messages', () => {
  it('splits a big note into ≤16 chunks that join back exactly', async () => {
    const { decodeChunk, encodeChunks, joinChunks } = await import('../protocol')
    const note = encodePlain('é'.repeat(3000)) // multi-byte, 6008 bytes
    const chunks = encodeChunks(note, 1024)
    expect(chunks.length).toBe(6)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1024)
    const parsed = chunks.map(decodeChunk)
    expect(parsed.map((p) => p!.i)).toEqual([0, 1, 2, 3, 4, 5])
    expect(parsed.every((p) => p!.n === 6)).toBe(true)
    const joined = joinChunks(parsed.map((p) => p!.bytes))
    expect(decodeNote(joined)).toEqual({ kind: 'plain', text: 'é'.repeat(3000) })
    expect(encodeChunks(new Uint8Array(500), 1024)).toHaveLength(1)
    expect(() => encodeChunks(new Uint8Array(20_000), 1024)).toThrow(/too long/)
    expect(decodeChunk(encodePlain('amsg1:x:not a chunk'))).toBeNull()
  })
})

describe('key derivation', () => {
  it('is deterministic per seed and distinct across seeds', async () => {
    const { deriveKeys } = await import('../crypto')
    const seed = nacl.randomBytes(64)
    expect(deriveKeys(seed).publicKey).toEqual(deriveKeys(new Uint8Array(seed)).publicKey)
    expect(deriveKeys(seed).publicKey).not.toEqual(deriveKeys(nacl.randomBytes(64)).publicKey)
    // and the derived key actually works as a box key
    const a = deriveKeys(seed), b = nacl.box.keyPair()
    const { nonce, box } = encrypt('hi', b.publicKey, a)
    expect(decrypt(box, nonce, a.publicKey, b)).toBe('hi')
  })
})
