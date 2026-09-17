import { useEffect, useRef, useState } from 'react'
import algosdk from 'algosdk'
import { fetchPublishedKey, isFunded } from '../lib/chain'
import { NETWORKS, type NetId } from '../lib/config'
import { isNfdName, resolveNfd } from '../lib/names'
import { Avatar } from './Avatar'

type Preview =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'invalid'; why: string }
  | { state: 'ok'; addr: string; funded: boolean; hasKey: boolean; via?: string }

type Props = {
  net: NetId
  me: string
  recent: { peer: string; name: string }[]
  onStart: (addr: string) => void
  onClose: () => void
}

export function NewChatModal({ net, me, recent, onStart, onClose }: Props) {
  const [value, setValue] = useState('')
  const [preview, setPreview] = useState<Preview>({ state: 'idle' })
  const seq = useRef(0)

  // Validate + look the recipient up as they type, debounced.
  useEffect(() => {
    const v = value.trim()
    const my = ++seq.current
    if (!v) return setPreview({ state: 'idle' })
    const t = setTimeout(async () => {
      let addr = v
      let via: string | undefined
      if (isNfdName(v)) {
        setPreview({ state: 'checking' })
        const r = await resolveNfd(net, v).catch(() => null)
        if (my !== seq.current) return
        if (!r) return setPreview({ state: 'invalid', why: `${v} doesn’t resolve on ${NETWORKS[net].label}.` })
        addr = r
        via = v
      } else if (!algosdk.isValidAddress(v)) {
        return setPreview({ state: 'invalid', why: v.length < 58 ? 'Keep going — an address is 58 characters, or use a name.algo.' : 'That isn’t a valid Algorand address.' })
      }
      if (addr === me) return setPreview({ state: 'invalid', why: 'That’s your own address.' })
      setPreview({ state: 'checking' })
      const [funded, key] = await Promise.all([isFunded(net, addr), fetchPublishedKey(net, addr).catch(() => null)])
      if (my !== seq.current) return
      setPreview({ state: 'ok', addr, funded, hasKey: !!key, via })
    }, 350)
    return () => clearTimeout(t)
  }, [value, net, me])

  async function paste() {
    try {
      setValue((await navigator.clipboard.readText()).trim())
    } catch {
      /* clipboard blocked — they can paste manually */
    }
  }

  const ok = preview.state === 'ok' ? preview : null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) onStart(ok.addr)
        }}
      >
        <div className="row">
          <h2>New message</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <label className="muted small" htmlFor="to">
          To — an Algorand address or a name like <code>alice.algo</code>
        </label>
        <div className="row">
          <input id="to" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste an address or type a name" spellCheck={false} />
          <button type="button" className="ghost" onClick={paste}>
            Paste
          </button>
        </div>

        {preview.state === 'checking' && <div className="preview muted">Looking up…</div>}
        {preview.state === 'invalid' && <div className="preview warn-text">{preview.why}</div>}
        {ok && (
          <div className="preview person">
            <Avatar addr={ok.addr} label={ok.via} />
            <div className="min0">
              <div className="mono ell">{ok.via ? `${ok.via} · ` : ''}{ok.addr}</div>
              {!ok.funded ? (
                <div className="warn-text">⚠ This account has never held ALGO, so it can’t receive messages yet.</div>
              ) : ok.hasKey ? (
                <div className="ok-text">🔒 Has an encryption key — your messages will be private.</div>
              ) : (
                <div className="warn-text">🔓 No encryption key published — messages to them would be public.</div>
              )}
            </div>
          </div>
        )}

        <div className="row">
          <span className="muted small">Each message costs the 0.001 ALGO network fee.</span>
          <button type="submit" disabled={!ok || !ok.funded}>
            Start chat
          </button>
        </div>

        {recent.length > 0 && !value && (
          <div className="recent">
            <div className="muted small">Recent</div>
            {recent.slice(0, 6).map((r) => (
              <button key={r.peer} type="button" className="recent-row" onClick={() => onStart(r.peer)}>
                <Avatar addr={r.peer} label={r.name} size={28} />
                <span className="ell">{r.name}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  )
}
