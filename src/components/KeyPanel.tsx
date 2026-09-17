import { useState } from 'react'
import { exportSecret, type EncKeys, type KeySource } from '../lib/crypto'

type Props = {
  keys: EncKeys
  source: KeySource
  canDerive: boolean
  onDerive: () => void
  onImport: (b64: string) => void
  onClose: () => void
}

export function KeyPanel({ keys, source, canDerive, onDerive, onImport, onClose }: Props) {
  const [val, setVal] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  return (
    <div className="keypanel">
      <div className="row">
        <b>Encryption key</b>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>
      {source === 'wallet' ? (
        <p className="muted">
          Derived from your wallet, so any device that connects the same account gets the same key — nothing to copy.
        </p>
      ) : (
        <p className="muted">
          A random key that lives only in this browser. Copy the secret to another device to read your history there
          {canDerive && ', or switch to a wallet-derived key that every device can recompute'}.
        </p>
      )}
      {canDerive && source !== 'wallet' && (
        <p>
          <button onClick={onDerive}>Derive key from wallet</button>
        </p>
      )}
      <div className="row">
        <code className="secret">{reveal ? exportSecret(keys) : '•'.repeat(44)}</code>
        <button className="ghost" onClick={() => setReveal((r) => !r)}>
          {reveal ? 'Hide' : 'Reveal'}
        </button>
      </div>
      <div className="row">
        <input placeholder="Paste a secret key to import…" value={val} onChange={(e) => setVal(e.target.value)} />
        <button
          onClick={() => {
            try {
              onImport(val)
              setVal('')
              setErr(null)
            } catch (e) {
              setErr((e as Error).message)
            }
          }}
        >
          Import
        </button>
      </div>
      {err && <div className="error-text">{err}</div>}
    </div>
  )
}
