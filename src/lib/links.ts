/**
 * Deep links: `#/to/<address-or-name.algo>` opens (or starts) a conversation
 * once a wallet is connected. Hash routing keeps GitHub Pages happy.
 */
export function parseToLink(hash = location.hash): string | null {
  const m = /^#\/to\/([^/?#]+)/.exec(hash)
  return m ? decodeURIComponent(m[1]) : null
}

export function shareLink(target: string) {
  return `${location.origin}${location.pathname}#/to/${encodeURIComponent(target)}`
}

export function clearToLink() {
  if (parseToLink()) history.replaceState(null, '', location.pathname + location.search)
}
