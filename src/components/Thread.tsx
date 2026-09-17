import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChainMessage } from '../lib/chain'
import { shippingCost } from '../lib/chain'
import { NETWORKS, type NetId } from '../lib/config'
import { linkify } from '../lib/text'

export type Rendered = { text: string; locked: boolean }

function dayLabel(unix: number) {
  const d = new Date(unix * 1000)
  const today = new Date()
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

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
  onBack: () => void
  relation: 'contact' | 'request' | 'blocked'
  onAccept: () => void
  onBlock: () => void
  onUnblock: () => void
}

export function Thread({ net, me, peer, peerName, nickname, messages, peerKeyState, render, noteBytesFor, busy, onSend, onNickname, onBack, relation, onAccept, onBlock, onUnblock }: Props) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [nickDraft, setNickDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const explorer = NETWORKS[net].explorer

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [peer, messages.length])

  const noteBytes = useMemo(() => (draft ? noteBytesFor(draft) : 0), [draft, noteBytesFor])
  const cost = useMemo(() => shippingCost(noteBytes), [noteBytes])
  const canSend = !busy && draft.trim().length > 0 && cost !== null && relation !== 'blocked'

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
        <button className="ghost back" onClick={onBack} aria-label="Back to conversations">
          ‹
        </button>
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
      {relation === 'request' && (
        <div className="banner warn inline">
          <span>
            <b>{peerName}</b> isn’t in your contacts. Anyone can pay the network fee to write to you.
          </span>
          <span>
            <button onClick={onAccept}>Accept</button>{' '}
            <button className="ghost" onClick={onBlock}>
              Block
            </button>
          </span>
        </div>
      )}
      {relation === 'blocked' && (
        <div className="banner inline">
          <span>You’ve blocked {peerName}. Their messages are hidden.</span>
          <button className="ghost" onClick={onUnblock}>
            Unblock
          </button>
        </div>
      )}
      <div className="messages">
        {messages.map((m, i) => {
          const r = render(m)
          const mine = m.from === me
          const day = dayLabel(m.time)
          const newDay = i === 0 || dayLabel(messages[i - 1].time) !== day
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day">{day}</div>}
              <div className={`msg ${mine ? 'mine' : ''} ${r.locked ? 'locked' : ''}`}>
              <div className="body">{r.locked ? r.text : linkify(r.text)}</div>
              <div className="meta">
                {m.txCount > 1 && <span title="Sent as one atomic group">{m.txCount} txns · </span>}
                {m.status ? (
                  <span className="status">{{ signing: 'waiting for signature…', confirming: 'confirming on-chain…', indexing: 'confirmed · indexing…' }[m.status]}</span>
                ) : (
                  <a href={`${explorer}/transaction/${m.id}`} target="_blank" rel="noreferrer">
                    {new Date(m.time * 1000).toLocaleString()}
                  </a>
                )}
              </div>
              </div>
            </Fragment>
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
