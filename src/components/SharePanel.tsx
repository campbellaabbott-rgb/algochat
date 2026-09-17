import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { shareLink } from '../lib/links'

export function SharePanel({ me, name, onClose }: { me: string; name: string; onClose: () => void }) {
  const link = shareLink(me)
  const [svg, setSvg] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toString(link, { type: 'svg', margin: 1, color: { dark: '#e6edf3', light: '#0000' } }).then(setSvg).catch(() => setSvg(''))
  }, [link])
  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setCopied(null)
    }
  }
  return (
    <div className="keypanel share">
      <div className="row">
        <b>Message me</b>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="muted">Anyone who opens this link lands straight in a conversation with {name}. Scan it or send it.</p>
      <div className="share-body">
        <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="share-text">
          <code className="secret">{link}</code>
          <div className="row wrap">
            <button onClick={() => copy('link', link)}>{copied === 'link' ? 'Copied!' : 'Copy link'}</button>
            <button className="ghost" onClick={() => copy('address', me)}>
              {copied === 'address' ? 'Copied!' : 'Copy address'}
            </button>
            {typeof navigator.share === 'function' && (
              <button className="ghost" onClick={() => navigator.share({ title: 'Message me on AlgoChat', url: link }).catch(() => {})}>
                Share…
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
