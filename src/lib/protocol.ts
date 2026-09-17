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

/**
 * Long messages: the logical note is split into ≤16 pieces sent as one atomic
 * group, each wrapped as `amsg1:x:<i>/<n>:<raw bytes>`. Readers reassemble by
 * group id and then decode the joined bytes as a normal note.
 */
export const PREFIX_CHUNK = PREFIX + 'x:'
export const MAX_CHUNKS = 16
const CHUNK_HEADER_MAX = PREFIX_CHUNK.length + '15/16:'.length

export function encodeChunks(note: Uint8Array, maxNote: number): Uint8Array[] {
  if (note.length <= maxNote) return [note]
  const cap = maxNote - CHUNK_HEADER_MAX
  const n = Math.ceil(note.length / cap)
  if (n > MAX_CHUNKS) throw new Error(`Message too long (${note.length} bytes; max ${cap * MAX_CHUNKS})`)
  return Array.from({ length: n }, (_, i) => {
    const head = utf8.enc(`${PREFIX_CHUNK}${i}/${n}:`)
    const body = note.subarray(i * cap, (i + 1) * cap)
    const out = new Uint8Array(head.length + body.length)
    out.set(head)
    out.set(body, head.length)
    return out
  })
}

export function decodeChunk(note: Uint8Array | undefined): { i: number; n: number; bytes: Uint8Array } | null {
  if (!note || note.length < PREFIX_CHUNK.length + 4) return null
  const head = utf8.dec(note.subarray(0, CHUNK_HEADER_MAX))
  if (!head.startsWith(PREFIX_CHUNK)) return null
  const m = /^(\d+)\/(\d+):/.exec(head.slice(PREFIX_CHUNK.length))
  if (!m) return null
  const i = Number(m[1]), n = Number(m[2])
  if (!(n >= 2 && n <= MAX_CHUNKS && i >= 0 && i < n)) return null
  return { i, n, bytes: note.subarray(PREFIX_CHUNK.length + m[0].length) }
}

export function joinChunks(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
