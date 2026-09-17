import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChainMessage } from '../lib/chain'
import { shippingCost } from '../lib/chain'
import { NETWORKS, type NetId } from '../lib/config'

export type Rendered = { text: string; locked: boolean }

type Props = {
  net: NetId
  me: string
  peer: string
  peerName: string
  nickname: string | undefined
  messages: ChainMessage[]
  peerKeyState: 'loading' | 'none' | 'ok'
  render: (m: ChainMessage) => Rendered
  noteBytesFor: (text: string) => number
  busy: boolean
  onSend: (text: string) => Promise<void>
  onNickname: (name: string) => void
}

export function Thread({ net, me, peer, peerName, nickname, messages, peerKeyState, render, noteBytesFor, busy, onSend, onNickname }: Props) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [nickDraft, setNickDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const explorer = NETWORKS[net].explorer

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [peer, messages.length])

  useEffect(() => setDraft(''), [peer])

  const noteBytes = useMemo(() => (draft ? noteBytesFor(draft) : 0), [draft, noteBytesFor])
  const cost = useMemo(() => shippingCost(noteBytes), [noteBytes])
  const canSend = !busy && draft.trim().length > 0 && cost !== null

  async function submit() {
    if (!canSend) return
    const text = draft.trim()
    setDraft('')
    try {
      await onSend(text)
    } catch {
      setDraft(text) // give it back on failure; the error banner explains
    }
  }

  return (
    <>
      <div className="chathead">
        <div className="who">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onNickname(nickDraft)
                setEditing(false)
              }}
            >
              <input autoFocus value={nickDraft} onChange={(e) => setNickDraft(e.target.value)} placeholder="Nickname (empty to clear)" />
              <button type="submit">Save</button>{' '}
              <button type="button" className="ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <button
                className="ghost name"
                title="Set a nickname"
                onClick={() => {
                  setNickDraft(nickname ?? '')
                  setEditing(true)
                }}
              >
                {peerName} ✎
              </button>
              <a className="mono" href={`${explorer}/account/${peer}`} target="_blank" rel="noreferrer">
                {peer}
              </a>
            </>
          )}
        </div>
        <span className={`pill ${peerKeyState === 'ok' ? 'ok' : ''}`}>
          {peerKeyState === 'loading' ? '…' : peerKeyState === 'ok' ? '🔒 end-to-end encrypted' : '🔓 plaintext — no key published'}
        </span>
      </div>
      <div className="messages">
        {messages.map((m) => {
          const r = render(m)
          const mine = m.from === me
          return (
            <div key={m.id} className={`msg ${mine ? 'mine' : ''} ${r.locked ? 'locked' : ''}`}>
              <div className="body">{r.text}</div>
              <div className="meta">
                {m.txCount > 1 && <span title="Sent as one atomic group">{m.txCount} txns · </span>}
                {m.round === 0n ? (
                  'confirmed · indexing…'
                ) : (
                  <a href={`${explorer}/transaction/${m.id}`} target="_blank" rel="noreferrer">
                    {new Date(m.time * 1000).toLocaleString()}
                  </a>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="composer-foot">
          <span className={`muted ${cost === null ? 'over' : ''}`}>
            {cost === null
              ? `Too long — ${noteBytes} bytes exceeds the 16-transaction group budget`
              : `${noteBytes} bytes · ${cost.txns} txn${cost.txns > 1 ? 's' : ''} · fee ${(cost.feeMicro / 1e6).toFixed(3)} ALGO`}
          </span>
          <button type="submit" disabled={!canSend}>
            Send
          </button>
        </div>
      </form>
    </>
  )
}
