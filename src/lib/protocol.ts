import { b64, utf8 } from './crypto'

/**
 * Wire format lives in the transaction note field (≤1024 bytes):
 *   amsg1:k:<b64 x25519 pub>                     — key announcement (self-payment)
 *   amsg1:p:<utf8 text>                          — plaintext message
 *   amsg1:e:<b64 senderPub>.<b64 nonce>.<b64 box> — NaCl box, decryptable by both parties
 */
export const PREFIX = 'amsg1:'
export const PREFIX_MSG_PLAIN = PREFIX + 'p:'
export const PREFIX_MSG_ENC = PREFIX + 'e:'
export const PREFIX_KEY = PREFIX + 'k:'

export type Payload =
  | { kind: 'key'; pub: Uint8Array }
  | { kind: 'plain'; text: string }
  | { kind: 'enc'; senderPub: Uint8Array; nonce: Uint8Array; box: Uint8Array }

export function encodeKey(pub: Uint8Array) {
  return utf8.enc(PREFIX_KEY + b64.enc(pub))
}

export function encodePlain(text: string) {
  return utf8.enc(PREFIX_MSG_PLAIN + text)
}

export function encodeEncrypted(senderPub: Uint8Array, nonce: Uint8Array, box: Uint8Array) {
  return utf8.enc(PREFIX_MSG_ENC + [senderPub, nonce, box].map(b64.enc).join('.'))
}

export function decodeNote(note: Uint8Array | undefined): Payload | null {
  if (!note || note.length === 0) return null
  let s: string
  try {
    s = utf8.dec(note)
  } catch {
    return null
  }
  try {
    if (s.startsWith(PREFIX_KEY)) {
      const pub = b64.dec(s.slice(PREFIX_KEY.length))
      return pub.length === 32 ? { kind: 'key', pub } : null
    }
    if (s.startsWith(PREFIX_MSG_PLAIN)) return { kind: 'plain', text: s.slice(PREFIX_MSG_PLAIN.length) }
    if (s.startsWith(PREFIX_MSG_ENC)) {
      const parts = s.slice(PREFIX_MSG_ENC.length).split('.')
      if (parts.length !== 3) return null
      const [senderPub, nonce, box] = parts.map(b64.dec)
      if (senderPub.length !== 32 || nonce.length !== 24) return null
      return { kind: 'enc', senderPub, nonce, box }
    }
  } catch {
    return null
  }
  return null
}
