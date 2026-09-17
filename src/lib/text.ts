import { Fragment, createElement, type ReactNode } from 'react'

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g

/** Render message text with clickable links; everything else stays literal. */
export function linkify(text: string): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0
    if (i > last) parts.push(text.slice(last, i))
    parts.push(createElement('a', { key: i, href: m[0], target: '_blank', rel: 'noopener noreferrer nofollow' }, m[0]))
    last = i + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return createElement(Fragment, null, ...parts)
}
