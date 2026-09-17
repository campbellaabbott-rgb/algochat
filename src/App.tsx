import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import algosdk from 'algosdk'
import { NetworkId, ScopeType } from '@txnlab/use-wallet'
import { useNetwork, useWallet } from '@txnlab/use-wallet-react'
import { NETWORKS, asNetId } from './lib/config'
import { buildMessageNote, fetchPublishedKey, friendlyError, publishKey, sendMessage, type ChainMessage } from './lib/chain'
import {
  decrypt,
  deriveKeys,
  ensureKeys,
  importSecret,
  keyDerivationMessage,
  keySource,
  loadKeys,
  samePub,
  storeKeys,
  type EncKeys,
  type KeySource,
} from './lib/crypto'
import { isNfdName, loadNicknames, resolveNfd, reverseNfd, saveNickname } from './lib/names'
import { useMnemonicPromptOpen } from './lib/mnemonicPrompt'
import { useMailbox } from './hooks/useMailbox'
import { useBalance } from './hooks/useBalance'
import { clearToLink, parseToLink } from './lib/links'
import { SharePanel } from './components/SharePanel'
import { MIN_BALANCE } from './lib/config'
import { MnemonicModal } from './components/MnemonicModal'
import { KeyPanel } from './components/KeyPanel'
import { Thread, type Rendered } from './components/Thread'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const sentCacheKey = (id: string) => `algochat:sent:${id}`
const readKey = (net: string, me: string) => `algochat:read:${net}:${me}`

type ThreadSummary = { peer: string; messages: ChainMessage[]; last: number; unread: number }

export default function App() {
  const { activeNetwork, activeNetworkConfig, setActiveNetwork } = useNetwork()
  const { wallets, activeAddress, activeWallet, transactionSigner, signData, withPrivateKey, isReady } = useWallet()
  const net = asNetId(activeNetwork)
  const me = activeAddress

  const [keys, setKeys] = useState<EncKeys | null>(null)
  const [source, setSource] = useState<KeySource>('local')
  const [publishedKey, setPublishedKey] = useState<Uint8Array | null | undefined>(undefined)
  const [peerKeys, setPeerKeys] = useState<Record<string, Uint8Array | null>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [newPeer, setNewPeer] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [linkTarget, setLinkTarget] = useState<string | null>(() => parseToLink())
  const [nicks, setNicks] = useState<Record<string, string>>({})
  const [nfd, setNfd] = useState<Record<string, string>>({})
  const [lastRead, setLastRead] = useState<Record<string, string>>({})
  const [notify, setNotify] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted')
  const [visible, setVisible] = useState(!document.hidden)
  const mnemonicOpen = useMnemonicPromptOpen()

  useEffect(() => {
    const f = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])

  const name = useCallback((addr: string) => nicks[addr] || nfd[addr] || short(addr), [nicks, nfd])

  const render = useCallback(
    (m: ChainMessage): Rendered => {
      const cached = localStorage.getItem(sentCacheKey(m.id))
      if (cached !== null) return { text: cached, locked: false }
      if (m.payload.kind === 'plain') return { text: m.payload.text, locked: false }
      if (m.payload.kind === 'enc' && keys) {
        // Incoming: open with the sender's key from the note. Outgoing: the
        // recipient's current published key (fails if they've rotated since).
        const theirPub = m.from === me ? peerKeys[m.to] : m.payload.senderPub
        if (theirPub) {
          const text = decrypt(m.payload.box, m.payload.nonce, theirPub, keys)
          if (text !== null) return { text, locked: false }
        }
      }
      return { text: 'Encrypted — cannot decrypt with this device’s key', locked: true }
    },
    [keys, me, peerKeys],
  )

  const onNew = useCallback(
    (incoming: ChainMessage[]) => {
      if (!notify || typeof Notification === 'undefined') return
      for (const m of incoming) {
        if (visible && m.from === selected) continue
        new Notification(name(m.from), { body: render(m).text.slice(0, 120), tag: m.id })
      }
    },
    [notify, visible, selected, name, render],
  )

  const mailbox = useMailbox(net, me, onNew)
  const balance = useBalance(net, me)

  useEffect(() => {
    const f = () => setLinkTarget(parseToLink())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  // Per-account local state: encryption key, nicknames, read markers.
  useEffect(() => {
    setPeerKeys({})
    setSelected(null)
    setPublishedKey(undefined)
    if (!me) {
      setKeys(null)
      setNicks({})
      setLastRead({})
      return
    }
    setNicks(loadNicknames(net, me))
    try {
      setLastRead(JSON.parse(localStorage.getItem(readKey(net, me)) ?? '{}'))
    } catch {
      setLastRead({})
    }
    fetchPublishedKey(net, me).then(setPublishedKey).catch(() => setPublishedKey(null))

    const stored = loadKeys(net, me)
    if (stored) {
      setKeys(stored)
      setSource(keySource(net, me))
    } else if (activeWallet?.canUsePrivateKey) {
      // Mnemonic-style wallets: derive silently, no prompt involved.
      withPrivateKey(async (sk) => new Uint8Array(sk.subarray(0, 32)))
        .then((seed) => {
          const k = deriveKeys(seed)
          seed.fill(0)
          storeKeys(net, me, k, 'wallet')
          setKeys(k)
          setSource('wallet')
        })
        .catch(() => {
          setKeys(ensureKeys(net, me))
          setSource('local')
        })
    } else {
      setKeys(ensureKeys(net, me))
      setSource('local')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, me])

  const threads = useMemo<ThreadSummary[]>(() => {
    if (!me) return []
    const byPeer = new Map<string, ChainMessage[]>()
    for (const m of [...mailbox.messages, ...mailbox.pending]) {
      const peer = m.from === me ? m.to : m.from
      if (!byPeer.has(peer)) byPeer.set(peer, [])
      byPeer.get(peer)!.push(m)
    }
    return [...byPeer.entries()]
      .map(([peer, ms]) => {
        ms.sort((a, b) => (a.round === b.round ? a.time - b.time : a.round < b.round ? -1 : 1))
        const readUpTo = BigInt(lastRead[peer] ?? '0')
        const unread = ms.filter((m) => m.from === peer && m.round > readUpTo).length
        return { peer, messages: ms, last: ms[ms.length - 1]?.time ?? 0, unread }
      })
      .sort((a, b) => b.last - a.last)
  }, [mailbox.messages, mailbox.pending, me, lastRead])

  const totalUnread = threads.reduce((s, t) => s + t.unread, 0)
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) AlgoChat` : 'AlgoChat'
  }, [totalUnread])

  // Opening a thread marks it read; messages that arrive while it is open are
  // marked read only if the page is actually visible.
  const lastSelected = useRef<string | null>(null)
  useEffect(() => {
    if (!me || !selected) return
    const justOpened = lastSelected.current !== selected
    lastSelected.current = selected
    if (!justOpened && !visible) return
    const t = threads.find((x) => x.peer === selected)
    if (!t?.unread) return
    const top = t.messages.reduce((m, x) => (x.round > m ? x.round : m), 0n)
    setLastRead((prev) => {
      const next = { ...prev, [selected]: top.toString() }
      localStorage.setItem(readKey(net, me), JSON.stringify(next))
      return next
    })
  }, [me, net, selected, visible, threads])

  const loadPeerKey = useCallback(
    async (peer: string, force = false) => {
      if (!force && peer in peerKeys) return peerKeys[peer]
      const k = await fetchPublishedKey(net, peer).catch(() => null)
      setPeerKeys((p) => ({ ...p, [peer]: k }))
      return k
    },
    [net, peerKeys],
  )

  // Keys for every peer (so outgoing history decrypts) and a fresh look at the
  // open thread's key on each poll — a peer can publish at any time.
  useEffect(() => {
    for (const t of threads) if (!(t.peer in peerKeys)) void loadPeerKey(t.peer)
  }, [threads, peerKeys, loadPeerKey])
  useEffect(() => {
    if (!selected) return
    void loadPeerKey(selected, true)
    const t = setInterval(() => void loadPeerKey(selected, true), 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, net])

  // Reverse-resolve .algo names for everyone in the sidebar.
  useEffect(() => {
    const addrs = [...threads.map((t) => t.peer), ...(me ? [me] : [])].filter((a) => !(a in nfd))
    if (!addrs.length) return
    reverseNfd(net, addrs).then((found) => setNfd((p) => ({ ...p, ...Object.fromEntries(addrs.map((a) => [a, found[a] ?? ''])) })))
  }, [threads, me, net, nfd])

  const needsPublish = keys && publishedKey !== undefined && (!publishedKey || !samePub(publishedKey, keys.publicKey))

  async function run<T>(label: string, f: () => Promise<T>): Promise<T> {
    setBusy(label)
    setError(null)
    try {
      return await f()
    } catch (e) {
      setError(friendlyError(e))
      throw e
    } finally {
      setBusy(null)
    }
  }

  const onPublishKey = () =>
    run('Publishing your encryption key…', async () => {
      if (!me || !keys) return
      await publishKey(net, me, keys, transactionSigner)
      setPublishedKey(keys.publicKey)
      void balance.refresh()
    }).catch(() => {})

  const onDeriveFromWallet = () =>
    run('Waiting for the wallet to sign the key-derivation message…', async () => {
      if (!me) return
      const chainId = activeNetworkConfig.caipChainId ?? `algorand:${net}`
      const payload = btoa(JSON.stringify(keyDerivationMessage(me, chainId)))
      const res = await signData(payload, { scope: ScopeType.AUTH, encoding: 'base64' })
      const k = deriveKeys(res.signature)
      storeKeys(net, me, k, 'wallet')
      setKeys(k)
      setSource('wallet')
      setPublishedKey((p) => (p && samePub(p, k.publicKey) ? p : null))
    }).catch(() => {})

  const noteBytesFor = useCallback(
    (text: string) => (keys ? buildMessageNote(text, keys, selected ? (peerKeys[selected] ?? null) : null).length : 0),
    [keys, selected, peerKeys],
  )

  const onSend = (text: string) =>
    run('Waiting for signature…', async () => {
      if (!me || !keys || !selected) return
      const theirPub = await loadPeerKey(selected, true)
      const note = buildMessageNote(text, keys, theirPub)
      setBusy('Confirming on-chain…')
      const id = await sendMessage(net, me, selected, note, transactionSigner)
      localStorage.setItem(sentCacheKey(id), text)
      void balance.refresh()
      mailbox.addPending({ id, from: me, to: selected, round: 0n, time: Math.floor(Date.now() / 1000), payload: { kind: 'plain', text }, txCount: 1 })
    })

  const openConversation = useCallback(
    async (target: string) => {
      let a = target.trim()
      if (isNfdName(a)) {
        const resolved = await run(`Resolving ${a}…`, () => resolveNfd(net, a)).catch(() => null)
        if (!resolved) return setError(`${a} did not resolve on ${NETWORKS[net].label}`)
        a = resolved
      }
      if (!algosdk.isValidAddress(a)) return setError('Enter an Algorand address or a .algo name')
      if (a === me) return setError('That is your own address')
      setError(null)
      setSelected(a)
      setNewPeer('')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [net, me],
  )

  // A `#/to/…` link opens that conversation as soon as a wallet is connected.
  useEffect(() => {
    if (!me || !linkTarget) return
    setLinkTarget(null)
    clearToLink()
    void openConversation(linkTarget)
  }, [me, linkTarget, openConversation])

  async function toggleNotify() {
    if (typeof Notification === 'undefined') return setError('This browser has no notification support')
    if (notify) return setNotify(false)
    const p = await Notification.requestPermission()
    setNotify(p === 'granted')
    if (p !== 'granted') setError('Notifications were not allowed')
  }

  const thread = threads.find((t) => t.peer === selected)
  const peerKeyState = selected ? (selected in peerKeys ? (peerKeys[selected] ? 'ok' : 'none') : 'loading') : 'none'
  const canDerive = !!activeWallet?.canSignData

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">◈</span> AlgoChat
        </div>
        <div className="controls">
          <select value={net} onChange={(e) => void setActiveNetwork(e.target.value)} disabled={!!busy}>
            {Object.entries(NETWORKS).map(([id, n]) => (
              <option key={id} value={id}>
                {n.label}
              </option>
            ))}
          </select>
          {me ? (
            <>
              <button className="ghost" onClick={toggleNotify} title={notify ? 'Notifications on' : 'Enable notifications'}>
                {notify ? '🔔' : '🔕'}
              </button>
              <button className="ghost" onClick={() => setShowKeys((s) => !s)} title="Encryption key">
                🔑
              </button>
              <button className="ghost addr" title={me} onClick={() => setShowShare((s) => !s)}>
                {name(me)}
                {balance.micro !== null && <span className="bal"> · {(Number(balance.micro) / 1e6).toFixed(3)} ALGO</span>}
              </button>
              <button onClick={() => activeWallet?.disconnect()} title="Disconnect">
                <span className="full">Disconnect</span>
                <span className="compact">⏻</span>
              </button>
            </>
          ) : (
            wallets.map((w) => (
              <button key={w.id} onClick={() => w.connect().catch((e) => setError(friendlyError(e)))} disabled={!isReady}>
                {w.metadata.name}
              </button>
            ))
          )}
        </div>
      </header>

      {mailbox.error && <div className="banner error">{mailbox.error}</div>}
      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {busy && <div className="banner">{busy}</div>}
      {me && needsPublish && !busy && (
        <div className="banner warn">
          Your encryption key isn’t on-chain yet, so people can only send you plaintext.{' '}
          <button onClick={onPublishKey}>Publish key (0.001 ALGO)</button>
          {canDerive && source !== 'wallet' && (
            <>
              {' '}
              <button className="ghost" onClick={onDeriveFromWallet}>
                Derive from wallet first
              </button>
            </>
          )}
        </div>
      )}

      {mnemonicOpen && <MnemonicModal />}

      {showShare && me && <SharePanel me={me} name={name(me)} onClose={() => setShowShare(false)} />}

      {showKeys && me && keys && (
        <KeyPanel
          keys={keys}
          source={source}
          canDerive={canDerive}
          onDerive={onDeriveFromWallet}
          onImport={(b64) => {
            const k = importSecret(net, me, b64)
            storeKeys(net, me, k, 'local')
            setKeys(k)
            setSource('local')
            setPublishedKey((p) => (p && samePub(p, k.publicKey) ? p : null))
          }}
          onClose={() => setShowKeys(false)}
        />
      )}

      {!me ? (
        <main className="empty">
          {linkTarget && <div className="banner warn">Connect a wallet to message {linkTarget}.</div>}
          <h1>Messages that live on Algorand</h1>
          <p>
            Every message is a 0-ALGO payment with the text in the note field, encrypted end-to-end with NaCl. Nothing is
            stored on a server — the chain is the mailbox.
          </p>
          <p>
            Connect a wallet to start. On TestNet, the <b>Mnemonic</b> option lets you paste a throwaway 25-word phrase;
            fund it at the{' '}
            <a href={NETWORKS[NetworkId.TESTNET].dispenser} target="_blank" rel="noreferrer">
              dispenser
            </a>
            .
          </p>
        </main>
      ) : (
        <main className={`layout ${selected ? 'thread-open' : ''}`}>
          <aside>
            <form
              className="newpeer"
              onSubmit={(e) => {
                e.preventDefault()
                void openConversation(newPeer)
              }}
            >
              <input placeholder="Address or name.algo…" value={newPeer} onChange={(e) => setNewPeer(e.target.value)} />
              <button type="submit" disabled={!!busy}>
                New
              </button>
            </form>
            {mailbox.loading && threads.length === 0 && <div className="muted">Loading mailbox…</div>}
            {!mailbox.loading && threads.length === 0 && <div className="muted">No conversations yet.</div>}
            {threads.map((t) => (
              <button key={t.peer} className={`thread ${t.peer === selected ? 'active' : ''}`} onClick={() => setSelected(t.peer)}>
                <div className="row">
                  <span className={nicks[t.peer] || nfd[t.peer] ? 'peer' : 'peer mono'}>{name(t.peer)}</span>
                  {t.unread > 0 && <span className="badge">{t.unread}</span>}
                </div>
                <div className="preview">{render(t.messages[t.messages.length - 1]).text}</div>
              </button>
            ))}
          </aside>

          <section className="chat">
            {!selected ? (
              <div className="center">
                <div className="checklist">
                  <h2>Getting set up</h2>
                  <Step done>Wallet connected as {name(me)}</Step>
                  <Step done={balance.micro !== null && balance.micro >= BigInt(MIN_BALANCE)}>
                    Funded — every message costs the 0.001 ALGO network fee
                    {balance.micro !== null && balance.micro < BigInt(MIN_BALANCE) && NETWORKS[net].dispenser && (
                      <>
                        {' '}
                        <a href={NETWORKS[net].dispenser} target="_blank" rel="noreferrer">
                          Get TestNet ALGO
                        </a>
                      </>
                    )}
                  </Step>
                  <Step done={!!publishedKey && !!keys && samePub(publishedKey, keys.publicKey)}>Encryption key published, so people can write to you privately</Step>
                  <Step done={threads.length > 0}>
                    First conversation — paste an address or <code>name.algo</code>, or{' '}
                    <button className="link" onClick={() => setShowShare(true)}>
                      share your link
                    </button>{' '}
                    so someone can message you
                  </Step>
                </div>
              </div>
            ) : (
              <Thread
                key={selected}
                net={net}
                me={me}
                peer={selected}
                peerName={name(selected)}
                nickname={nicks[selected]}
                messages={thread?.messages ?? []}
                peerKeyState={peerKeyState}
                render={render}
                noteBytesFor={noteBytesFor}
                busy={!!busy}
                onSend={onSend}
                onNickname={(n) => setNicks(saveNickname(net, me, selected, n))}
                onBack={() => setSelected(null)}
              />
            )}
          </section>
        </main>
      )}
    </div>
  )
}

function Step({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <div className={`step ${done ? 'done' : ''}`}>
      <span className="tick">{done ? '✓' : '○'}</span>
      <span>{children}</span>
    </div>
  )
}
