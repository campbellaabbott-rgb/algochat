import { useState } from 'react'
import algosdk from 'algosdk'
import { NetworkId, type Wallet } from '@txnlab/use-wallet'
import { NETWORKS, type NetId } from '../lib/config'
import { presetMnemonic } from '../lib/mnemonicPrompt'

const BLURB: Record<string, { how: string; note: string }> = {
  pera: { how: 'Mobile app · scan a QR code', note: 'The most-used Algorand wallet.' },
  defly: { how: 'Mobile app · scan a QR code', note: 'Wallet with built-in DeFi tools.' },
  lute: { how: 'Browser extension', note: 'Connects directly in this browser.' },
}

type Props = {
  wallets: Wallet[]
  net: NetId
  onNet: (id: NetId) => void
  onConnected: (opts?: { newTestMnemonic?: string }) => void
  onError: (msg: string) => void
  onClose: () => void
}

export function ConnectModal({ wallets, net, onNet, onConnected, onError, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [phrase, setPhrase] = useState('')
  const mnemonicWallet = wallets.find((w) => w.id === 'mnemonic')
  const real = wallets.filter((w) => w.id !== 'mnemonic')
  const testnetLike = net !== NetworkId.MAINNET
  const words = phrase.trim().split(/\s+/).filter(Boolean).length

  async function connect(w: Wallet, opts?: { newTestMnemonic?: string }) {
    setBusy(w.id)
    try {
      await w.connect()
      onConnected(opts)
    } catch (e) {
      const msg = (e as Error).message || ''
      onError(/cancel|reject|closed/i.test(msg) ? 'Connection was cancelled in the wallet.' : msg || 'Could not connect.')
    } finally {
      setBusy(null)
    }
  }

  function createTestAccount() {
    if (!mnemonicWallet) return
    const acct = algosdk.generateAccount()
    const m = algosdk.secretKeyToMnemonic(acct.sk)
    presetMnemonic(m)
    void connect(mnemonicWallet, { newTestMnemonic: m })
  }

  function connectWithPhrase() {
    if (!mnemonicWallet || words !== 25) return
    presetMnemonic(phrase.trim())
    void connect(mnemonicWallet)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="row">
          <h2 id="connect-title">Connect a wallet</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="seg" role="radiogroup" aria-label="Network">
          {(Object.keys(NETWORKS) as NetId[])
            .filter((id) => id !== NetworkId.LOCALNET || import.meta.env.DEV)
            .map((id) => (
              <button key={id} role="radio" aria-checked={net === id} className={net === id ? 'on' : ''} onClick={() => onNet(id)} disabled={!!busy}>
                {NETWORKS[id].label}
              </button>
            ))}
        </div>
        <p className="muted small">
          {testnetLike ? 'TestNet uses free play-money ALGO — the right place to try things.' : 'MainNet uses real ALGO. Each message costs 0.001 ALGO.'}
        </p>

        <div className="wallet-list">
          {real.map((w) => (
            <button key={w.id} className="wallet-card" onClick={() => void connect(w)} disabled={!!busy}>
              <img src={w.metadata.icon} alt="" width={40} height={40} />
              <span className="wallet-text">
                <b>{w.metadata.name}</b>
                <span className="muted small">{BLURB[w.id]?.how ?? 'Wallet'}</span>
                <span className="muted small">{BLURB[w.id]?.note}</span>
              </span>
              <span className="chev">{busy === w.id ? '…' : '›'}</span>
            </button>
          ))}
        </div>

        {testnetLike && mnemonicWallet && (
          <div className="try">
            <b>No wallet yet?</b>
            <p className="muted small">Make a throwaway TestNet account right here. It lives in this browser — fine for trying the app, not for anything you care about.</p>
            <div className="row wrap">
              <button onClick={createTestAccount} disabled={!!busy}>
                {busy === 'mnemonic' ? 'Creating…' : 'Create a free test account'}
              </button>
              <button className="ghost" onClick={() => setPasting((p) => !p)}>
                I have a 25-word test phrase
              </button>
            </div>
            {pasting && (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault()
                  connectWithPhrase()
                }}
              >
                <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="word word word … (25 words, TestNet only)" autoFocus />
                <button type="submit" disabled={words !== 25 || !!busy}>
                  Connect
                </button>
              </form>
            )}
          </div>
        )}

        <p className="muted small">
          New to Algorand?{' '}
          <a href="https://perawallet.app" target="_blank" rel="noreferrer">
            Get Pera Wallet
          </a>{' '}
          on your phone, then come back and scan.
        </p>
      </div>
    </div>
  )
}
