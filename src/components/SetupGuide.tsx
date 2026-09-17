import { useState } from 'react'
import { NetworkId } from '@txnlab/use-wallet'
import { MIN_BALANCE, NETWORKS, type NetId } from '../lib/config'

type Props = {
  net: NetId
  me: string
  balance: bigint | null
  keyPublished: boolean
  hasChats: boolean
  testMnemonic: string | null
  busy: boolean
  onPublish: () => void
  onNewChat: () => void
  onShare: () => void
}

/** One card, one action per step. Steps tick themselves as the chain catches up. */
export function SetupGuide({ net, me, balance, keyPublished, hasChats, testMnemonic, busy, onPublish, onNewChat, onShare }: Props) {
  const [copied, setCopied] = useState(false)
  const [showPhrase, setShowPhrase] = useState(false)
  const funded = balance !== null && balance >= BigInt(MIN_BALANCE) + 1000n
  const steps = [
    { title: 'Connect a wallet', done: true },
    { title: 'Add a little ALGO', done: funded },
    { title: 'Publish your encryption key', done: keyPublished },
    { title: 'Start your first chat', done: hasChats },
  ]
  const current = steps.findIndex((s) => !s.done)
  const allDone = current === -1
  const dispenser = NETWORKS[net].dispenser

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(me)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="guide">
      <div className="guide-head">
        <h2>{allDone ? 'You’re all set' : 'Get set up'}</h2>
        <span className="muted small">
          {steps.filter((s) => s.done).length} of {steps.length}
        </span>
      </div>

      {testMnemonic && (
        <div className="callout">
          <b>This is a throwaway TestNet account.</b> It exists only in this browser. If you want to keep it, save the recovery phrase.{' '}
          <button className="link" onClick={() => setShowPhrase((s) => !s)}>
            {showPhrase ? 'Hide phrase' : 'Show phrase'}
          </button>
          {showPhrase && <code className="secret block">{testMnemonic}</code>}
        </div>
      )}

      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title} className={`gstep ${s.done ? 'done' : ''} ${i === current ? 'current' : ''}`}>
            <span className="num">{s.done ? '✓' : i + 1}</span>
            <div className="gbody">
              <div className="gtitle">{s.title}</div>
              {i === current && i === 1 && (
                <div className="gdetail">
                  <p>
                    Messages cost the network fee (0.001 ALGO) and your account needs a 0.1 ALGO minimum balance. Send some ALGO to your address:
                  </p>
                  <div className="row">
                    <code className="secret ell">{me}</code>
                    <button className="ghost" onClick={copy}>
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  {dispenser ? (
                    <p>
                      On TestNet it’s free:{' '}
                      <a href={dispenser} target="_blank" rel="noreferrer" onClick={copy}>
                        open the dispenser
                      </a>
                      , paste your address, solve the captcha. This step ticks itself once the ALGO lands (about 10 seconds).
                    </p>
                  ) : net === NetworkId.MAINNET ? (
                    <p>Send at least 0.2 ALGO from an exchange or another wallet. This step ticks itself when it arrives.</p>
                  ) : null}
                </div>
              )}
              {i === current && i === 2 && (
                <div className="gdetail">
                  <p>One transaction (0.001 ALGO) announces your public key so people can write to you privately. Without it, they can only send plaintext.</p>
                  <button onClick={onPublish} disabled={busy}>
                    Publish key
                  </button>
                </div>
              )}
              {i === current && i === 3 && (
                <div className="gdetail">
                  <p>Message someone by address or <code>name.algo</code> — or share your link so they can message you.</p>
                  <div className="row wrap">
                    <button onClick={onNewChat}>New message</button>
                    <button className="ghost" onClick={onShare}>
                      Share my link
                    </button>
                  </div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {allDone && (
        <div className="row wrap">
          <button onClick={onNewChat}>New message</button>
          <button className="ghost" onClick={onShare}>
            Share my link
          </button>
        </div>
      )}
    </div>
  )
}
