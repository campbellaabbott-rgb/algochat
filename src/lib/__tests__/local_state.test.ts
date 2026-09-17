import { beforeAll, describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadMailbox, saveMailbox } from '../cache'
import { accept, block, loadAccepted, loadBlocked, unblock } from '../contacts'
import { linkify } from '../text'
import type { ChainMessage } from '../chain'

beforeAll(() => {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  })
})

const A = 'A'.repeat(58), B = 'B'.repeat(58)
const msg = (i: number, extra: Partial<ChainMessage> = {}): ChainMessage => ({
  id: `TX${i}`, from: A, to: B, round: BigInt(100 + i), time: 1700000000 + i, txCount: 1,
  payload: { kind: 'enc', senderPub: nacl.randomBytes(32), nonce: nacl.randomBytes(24), box: nacl.randomBytes(40) },
  ...extra,
})

describe('mailbox cache', () => {
  it('round-trips messages with bigint rounds and binary payloads', () => {
    const msgs = [msg(1), msg(2, { payload: { kind: 'plain', text: 'héllo' }, txCount: 3 })]
    saveMailbox('testnet', A, 102n, msgs)
    const back = loadMailbox('testnet', A)!
    expect(back.maxRound).toBe(102n)
    expect(back.messages).toEqual(msgs)
    expect(loadMailbox('mainnet', A)).toBeNull()
  })

  it('never caches optimistic or unconfirmed entries', () => {
    saveMailbox('testnet', B, 5n, [msg(1, { status: 'indexing' }), msg(2, { round: 0n }), msg(3)])
    expect(loadMailbox('testnet', B)!.messages.map((m) => m.id)).toEqual(['TX3'])
  })

  it('drops the oldest messages when over budget', () => {
    const big = Array.from({ length: 400 }, (_, i) => msg(i, { payload: { kind: 'plain', text: 'x'.repeat(20_000) } }))
    saveMailbox('testnet', 'C', 999n, big)
    const back = loadMailbox('testnet', 'C')!
    expect(back.messages.length).toBeLessThan(400)
    expect(back.messages[back.messages.length - 1].id).toBe('TX399') // newest kept
  })
})

describe('contacts', () => {
  it('accept and block are mutually exclusive and persist', () => {
    expect(loadAccepted('t', A)).toEqual([])
    accept('t', A, B)
    expect(loadAccepted('t', A)).toEqual([B])
    block('t', A, B)
    expect(loadAccepted('t', A)).toEqual([])
    expect(loadBlocked('t', A)).toEqual([B])
    unblock('t', A, B)
    expect(loadBlocked('t', A)).toEqual([])
  })
})

describe('linkify', () => {
  it('links URLs and leaves the rest alone', () => {
    const html = renderToStaticMarkup(linkify('see https://algorand.co/docs, and (http://x.y/z) ok <b>'))
    expect(html).toContain('<a href="https://algorand.co/docs" target="_blank" rel="noopener noreferrer nofollow">https://algorand.co/docs</a>,')
    expect(html).toContain('(<a href="http://x.y/z"')
    expect(html).toContain('&lt;b&gt;') // escaped, not rendered
  })
})
