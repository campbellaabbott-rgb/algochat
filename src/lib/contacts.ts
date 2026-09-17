/**
 * Local contact state per (network, address): who you've accepted and who
 * you've blocked. Both live only in this browser; the chain has no notion of
 * either, so a blocked sender's payments still land — they just aren't shown.
 */
const k = (kind: string, net: string, me: string) => `algochat:${kind}:${net}:${me}`

function load(kind: string, net: string, me: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(k(kind, net, me)) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function save(kind: string, net: string, me: string, list: string[]) {
  localStorage.setItem(k(kind, net, me), JSON.stringify(list))
  return list
}

export const loadAccepted = (net: string, me: string) => load('accepted', net, me)
export const loadBlocked = (net: string, me: string) => load('blocked', net, me)

export function accept(net: string, me: string, addr: string) {
  const a = new Set(loadAccepted(net, me))
  a.add(addr)
  save('blocked', net, me, loadBlocked(net, me).filter((x) => x !== addr))
  return save('accepted', net, me, [...a])
}

export function block(net: string, me: string, addr: string) {
  const b = new Set(loadBlocked(net, me))
  b.add(addr)
  save('accepted', net, me, loadAccepted(net, me).filter((x) => x !== addr))
  return save('blocked', net, me, [...b])
}

export function unblock(net: string, me: string, addr: string) {
  return save('blocked', net, me, loadBlocked(net, me).filter((x) => x !== addr))
}
