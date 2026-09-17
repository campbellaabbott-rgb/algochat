import { useEffect, useRef } from 'react'
import type { Wallet } from '@txnlab/use-wallet'
import { NETWORKS, type NetId } from '../lib/config'
import { Avatar } from './Avatar'

type Props = {
  me: string
  name: string
  wallet: Wallet | null
  net: NetId
  balance: bigint | null
  notify: boolean
  keySource: 'wallet' | 'local'
  onNet: (id: NetId) => void
  onToggleNotify: () => void
  onShare: () => void
  onKeys: () => void
  onDisconnect: () => void
  onClose: () => void
}

export function AccountMenu({ me, name, wallet, net, balance, notify, keySource, onNet, onToggleNotify, onShare, onKeys, onDisconnect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const short = `${me.slice(0, 8)}…${me.slice(-6)}`
  return (
    <div className="menu" ref={ref} role="menu">
      <div className="menu-id">
        <Avatar addr={me} label={name} size={40} />
        <div className="min0">
          <div className="ell">
            <b>{name}</b>
          </div>
          <button className="link mono small" onClick={() => navigator.clipboard?.writeText(me)} title="Copy address">
            {short} ⧉
          </button>
        </div>
      </div>
      <div className="menu-row">
        <span className="muted">Balance</span>
        <span>{balance === null ? '…' : `${(Number(balance) / 1e6).toFixed(3)} ALGO`}</span>
      </div>
      {wallet && wallet.accounts.length > 1 && (
        <div className="menu-row">
          <span className="muted">Account</span>
          <select value={me} onChange={(e) => wallet.setActiveAccount(e.target.value)}>
            {wallet.accounts.map((a) => (
              <option key={a.address} value={a.address}>
                {a.name || `${a.address.slice(0, 6)}…${a.address.slice(-4)}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="menu-row">
        <span className="muted">Network</span>
        <select value={net} onChange={(e) => onNet(e.target.value as NetId)}>
          {(Object.keys(NETWORKS) as NetId[])
            .filter((id) => id !== 'localnet' || import.meta.env.DEV)
            .map((id) => (
              <option key={id} value={id}>
                {NETWORKS[id].label}
              </option>
            ))}
        </select>
      </div>
      <button className="menu-item" role="menuitem" onClick={onShare}>
        <span>Share my link / QR</span>
        <span className="chev">›</span>
      </button>
      <button className="menu-item" role="menuitem" onClick={onToggleNotify}>
        <span>Notifications</span>
        <span className={`toggle ${notify ? 'on' : ''}`} aria-hidden />
      </button>
      <button className="menu-item" role="menuitem" onClick={onKeys}>
        <span>Encryption key</span>
        <span className="muted small">{keySource === 'wallet' ? 'from wallet' : 'this browser'} ›</span>
      </button>
      <button className="menu-item danger-text" role="menuitem" onClick={onDisconnect}>
        Disconnect {wallet?.metadata.name}
      </button>
    </div>
  )
}
