import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkId } from '@txnlab/use-wallet'
import { isNfdName, resolveNfd, reverseNfd } from '../names'
import { parseToLink, shareLink } from '../links'

const ADDR = '5NBAJP3FDBY4HXY3RZWRBE3VG4YJLXWOULC2QC4WM75KKCX4JZYG4ASVJ4'

describe('names', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('recognises .algo names', () => {
    expect(isNfdName('silvio.algo')).toBe(true)
    expect(isNfdName('sub.silvio.algo')).toBe(true)
    expect(isNfdName('silvio')).toBe(false)
    expect(isNfdName(ADDR)).toBe(false)
  })

  it('resolves a name through the NFD API and rejects unknown ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/nfd/silvio.algo')
          ? new Response(JSON.stringify({ name: 'silvio.algo', depositAccount: ADDR }))
          : new Response('{"message":"not found"}', { status: 404 }),
      ),
    )
    expect(await resolveNfd(NetworkId.MAINNET, 'Silvio.algo')).toBe(ADDR)
    expect(await resolveNfd(NetworkId.MAINNET, 'nobody.algo')).toBeNull()
    expect(await resolveNfd(NetworkId.LOCALNET, 'silvio.algo')).toBeNull() // no API there
  })

  it('reverse-resolves in batches and caches misses', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ [ADDR]: { name: 'silvio.algo' } })))
    vi.stubGlobal('fetch', f)
    const other = 'FDM3LVUHBRLVWWGJAKCAKN73C33V5ZIFLJQ5R5T64C62BGCUZOLUAMUZLM'
    expect(await reverseNfd(NetworkId.MAINNET, [ADDR, other])).toEqual({ [ADDR]: 'silvio.algo' })
    expect(f).toHaveBeenCalledTimes(1)
    await reverseNfd(NetworkId.MAINNET, [ADDR, other])
    expect(f).toHaveBeenCalledTimes(1) // both cached
  })
})

describe('deep links', () => {
  it('parses and builds #/to/ links', () => {
    expect(parseToLink('#/to/silvio.algo')).toBe('silvio.algo')
    expect(parseToLink(`#/to/${ADDR}?x=1`)).toBe(ADDR)
    expect(parseToLink('#/other')).toBeNull()
    expect(parseToLink('')).toBeNull()
    expect(shareLink('silvio.algo')).toMatch(/#\/to\/silvio\.algo$/)
  })
})
