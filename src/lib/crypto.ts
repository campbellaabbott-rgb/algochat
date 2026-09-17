import nacl from 'tweetnacl'
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from 'tweetnacl-util'

/**
 * Each (network, address) owns a local x25519 keypair. Wallets don't expose
 * private keys, so we can't derive one from the Algorand account; instead the
 * public half is published on-chain (see protocol.ts) and the secret half
 * lives in this browser. Export/import lets a user move it between devices.
 */
const storageKey = (net: string, addr: string) => `algochat:enc:${net}:${addr}`

export type EncKeys = { publicKey: Uint8Array; secretKey: Uint8Array }

export function loadKeys(net: string, addr: string): EncKeys | null {
  try {
    const raw = localStorage.getItem(storageKey(net, addr))
    if (!raw) return null
    const secretKey = decodeBase64(raw)
    if (secretKey.length !== nacl.box.secretKeyLength) return null
    return nacl.box.keyPair.fromSecretKey(secretKey)
  } catch {
    return null
  }
}

export function ensureKeys(net: string, addr: string): EncKeys {
  const existing = loadKeys(net, addr)
  if (existing) return existing
  const kp = nacl.box.keyPair()
  localStorage.setItem(storageKey(net, addr), encodeBase64(kp.secretKey))
  return kp
}

export function exportSecret(keys: EncKeys) {
  return encodeBase64(keys.secretKey)
}

export function importSecret(net: string, addr: string, b64: string): EncKeys {
  const secretKey = decodeBase64(b64.trim())
  if (secretKey.length !== nacl.box.secretKeyLength) throw new Error('Not a 32-byte key')
  localStorage.setItem(storageKey(net, addr), encodeBase64(secretKey))
  return nacl.box.keyPair.fromSecretKey(secretKey)
}

export function encrypt(text: string, theirPub: Uint8Array, mine: EncKeys) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const box = nacl.box(decodeUTF8(text), nonce, theirPub, mine.secretKey)
  return { nonce, box }
}

export function decrypt(box: Uint8Array, nonce: Uint8Array, theirPub: Uint8Array, mine: EncKeys): string | null {
  const open = nacl.box.open(box, nonce, theirPub, mine.secretKey)
  return open ? encodeUTF8(open) : null
}

export const b64 = { enc: encodeBase64, dec: decodeBase64 }
export const utf8 = { enc: decodeUTF8, dec: encodeUTF8 }
export const samePub = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Deterministic keys: the same seed always yields the same x25519 pair, so a
 * key derived from the wallet (its private key, or an ARC-60 signature over a
 * fixed message) is identical on every device with no export step.
 */
export function deriveKeys(seed: Uint8Array): EncKeys {
  const material = new Uint8Array(seed.length + 16)
  material.set(seed)
  material.set(decodeUTF8('algochat-enc-v1'), seed.length)
  const secretKey = nacl.hash(material).slice(0, nacl.box.secretKeyLength)
  return nacl.box.keyPair.fromSecretKey(secretKey)
}

export type KeySource = 'wallet' | 'local'
const sourceKey = (net: string, addr: string) => `${storageKey(net, addr)}:src`

export function keySource(net: string, addr: string): KeySource {
  return localStorage.getItem(sourceKey(net, addr)) === 'wallet' ? 'wallet' : 'local'
}

export function storeKeys(net: string, addr: string, keys: EncKeys, source: KeySource) {
  localStorage.setItem(storageKey(net, addr), encodeBase64(keys.secretKey))
  localStorage.setItem(sourceKey(net, addr), source)
}

/** The fixed ARC-60 (SIWA) payload whose signature seeds a wallet-derived key. */
export function keyDerivationMessage(address: string, chainId: string) {
  return {
    domain: location.host,
    account_address: address,
    uri: location.origin,
    version: '1',
    chain_id: chainId,
    nonce: 'algochat-enc-v1',
    statement: 'Derive your AlgoChat encryption key. Signing this does not send a transaction or spend anything.',
    type: 'ed25519' as const,
  }
}
