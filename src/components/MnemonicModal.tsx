import { useState } from 'react'
import { answerMnemonic } from '../lib/mnemonicPrompt'

export function MnemonicModal() {
  const [val, setVal] = useState('')
  const words = val.trim().split(/\s+/).filter(Boolean).length
  return (
    <div className="modal-backdrop" onClick={() => answerMnemonic(null)}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          answerMnemonic(val.trim())
        }}
      >
        <b>TestNet mnemonic</b>
        <p className="muted">
          Paste a 25-word phrase for a throwaway TestNet account. It is stored in this browser only. Never paste a
          MainNet key here.
        </p>
        <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="word word word …" rows={4} />
        <div className="row">
          <span className="muted">{words}/25 words</span>
          <span>
            <button type="button" className="ghost" onClick={() => answerMnemonic(null)}>
              Cancel
            </button>{' '}
            <button type="submit" disabled={words !== 25}>
              Connect
            </button>
          </span>
        </div>
      </form>
    </div>
  )
}
