import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import algosdk from 'algosdk'
import { ScopeType } from '@txnlab/use-wallet'
import { useNetwork, useWallet } from '@txnlab/use-wallet-react'
import { NETWORKS, asNetId, type NetId } from './lib/config'
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
import { accept, block, loadAccepted, loadBlocked, unblock } from './lib/contacts'
import { useConfirm } from './hooks/useConfirm'
import { Landing } from './components/Landing'
import { ConnectModal } from './components/ConnectModal'
import { NewChatModal } from './components/NewChatModal'
import { SetupGuide } from './components/SetupGuide'
import { AccountMenu } from './components/AccountMenu'
import { Avatar } from './components/Avatar'
import { MnemonicModal } from './components/MnemonicModal'
import { KeyPanel } from './components/KeyPanel'
import { Thread, type Rendered } from './components/Thread'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const sentCacheKey = (id: string) => `algochat:sent:${id}`
const readKey = (net: string, me: string) => `algochat:read:${net}:${me}`

type Relation = 'contact' | 'request' | 'blocked'
type ThreadSummary = { peer: string; messages: ChainMessage[]; last: number; unread: number; relation: Relation }

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
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [testMnemonic, setTestMnemonic] = useState<string | null>(null)
  const testKey = (a: string) => `algochat:testacct:${a}`
  const [linkTarget, setLinkTarget] = useState<string | null>(() => parseToLink())
  const [accepted, setAccepted] = useState<string[]>([])
  const [blocked, setBlocked] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [showRequests, setShowRequests] = useState(true)
  const { confirm, dialog: confirmDialog } = useConfirm()
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
        if (blocked.includes(m.from)) continue
        if (visible && m.from === selected) continue
        new Notification(name(m.from), { body: render(m).text.slice(0, 120), tag: m.id })
      }
    },
    [notify, visible, selected, name, render, blocked],
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
      setAccepted([])
      setBlocked([])
      return
    }
    setTestMnemonic(localStorage.getItem(testKey(me)))
    setNicks(loadNicknames(net, me))
    setAccepted(loadAccepted(net, me))
    setBlocked(loadBlocked(net, me))
    setSearch('')
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
        // You've written to them, or explicitly accepted them → contact. Otherwise a request.
        const relation: Relation = blocked.includes(peer)
          ? 'blocked'
          : accepted.includes(peer) || ms.some((m) => m.from === me)
            ? 'contact'
            : 'request'
        return { peer, messages: ms, last: ms[ms.length - 1]?.time ?? 0, unread, relation }
      })
      .sort((a, b) => b.last - a.last)
  }, [mailbox.messages, mailbox.pending, me, lastRead, accepted, blocked])

  const matches = useCallback(
    (t: ThreadSummary) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      if (t.peer.toLowerCase().includes(q) || name(t.peer).toLowerCase().includes(q)) return true
      return t.messages.some((m) => render(m).text.toLowerCase().includes(q))
    },
    [search, name, render],
  )
  const contacts = threads.filter((t) => t.relation === 'contact' && matches(t))
  const requests = threads.filter((t) => t.relation === 'request' && matches(t))
  const blockedThreads = threads.filter((t) => t.relation === 'blocked' && matches(t))

  const totalUnread = threads.filter((t) => t.relation === 'contact').reduce((s, t) => s + t.unread, 0)
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

  const onSend = async (text: string) => {
    if (!me || !keys || !selected) return
    const peer = selected
    const theirPub = await loadPeerKey(peer, true)
    if (!theirPub) {
      const ok = await confirm({
        title: 'Send unencrypted?',
        body: `${name(peer)} hasn’t published an encryption key, so this message would be written to the blockchain in plaintext — readable by anyone, forever.`,
        confirmLabel: 'Send in plaintext',
        danger: true,
      })
      if (!ok) throw new Error('cancelled') // Thread restores the draft; no banner
    }
    const localId = `local:${Date.now()}`
    const base = { from: me, to: peer, round: 0n, time: Math.floor(Date.now() / 1000), payload: { kind: 'plain', text } as const, txCount: 1 }
    mailbox.addPending({ ...base, id: localId, status: 'signing' })
    await run('Waiting for signature…', async () => {
      try {
        const note = buildMessageNote(text, keys, theirPub)
        const id = await sendMessage(net, me, peer, note, transactionSigner, () => {
          setBusy('Confirming on-chain…')
          mailbox.updatePending(localId, { status: 'confirming' })
        })
        localStorage.setItem(sentCacheKey(id), text)
        mailbox.updatePending(localId, { id, status: 'indexing' })
        if (!accepted.includes(peer)) setAccepted(accept(net, me, peer))
        void balance.refresh()
      } catch (e) {
        mailbox.removePending(localId)
        throw e
      }
    })
  }

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
  const row = (t: ThreadSummary) => {
    const last = t.messages[t.messages.length - 1]
    return (
      <button key={t.peer} className={`thread ${t.peer === selected ? 'active' : ''}`} onClick={() => setSelected(t.peer)}>
        <Avatar addr={t.peer} label={nicks[t.peer] || nfd[t.peer]} />
        <div className="min0">
          <div className="row">
            <span className={nicks[t.peer] || nfd[t.peer] ? 'peer' : 'peer mono'}>{name(t.peer)}</span>
            {t.unread > 0 ? <span className="badge">{t.unread}</span> : <span className="muted small">{ago(last.time)}</span>}
          </div>
          <div className="preview">{last.from === me ? 'You: ' : ''}{render(last).text}</div>
        </div>
      </button>
    )
  }
  const peerKeyState = selected ? (selected in peerKeys ? (peerKeys[selected] ? 'ok' : 'none') : 'loading') : 'none'
  const canDerive = !!activeWallet?.canSignData

  const onNet = (id: NetId) => void setActiveNetwork(id)
  const recent = contacts.map((t) => ({ peer: t.peer, name: name(t.peer) }))

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">◈</span> AlgoChat
          {me && <span className="netpill">{NETWORKS[net].label}</span>}
        </div>
        <div className="controls">
          {me ? (
            <div className="acct-wrap">
              <button className="acct-btn" onClick={() => setShowMenu((m) => !m)} aria-haspopup="menu" aria-expanded={showMenu}>
                <Avatar addr={me} label={name(me)} size={30} />
                <span className="acct-name ell">{name(me)}</span>
                <span className="chev">▾</span>
              </button>
              {showMenu && (
                <AccountMenu
                  me={me}
                  name={name(me)}
                  wallet={activeWallet}
                  net={net}
                  balance={balance.micro}
                  notify={notify}
                  keySource={source}
                  onNet={onNet}
                  onToggleNotify={() => void toggleNotify()}
                  onShare={() => {
                    setShowMenu(false)
                    setShowShare(true)
                  }}
                  onKeys={() => {
                    setShowMenu(false)
                    setShowKeys(true)
                  }}
                  onDisconnect={() => {
                    setShowMenu(false)
                    setTestMnemonic(null)
                    void activeWallet?.disconnect()
                  }}
                  onClose={() => setShowMenu(false)}
                />
              )}
            </div>
          ) : (
            <button className="primary" onClick={() => setShowConnect(true)} disabled={!isReady}>
              Connect wallet
            </button>
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
      {me && selected && needsPublish && !busy && (
        <div className="banner warn">
          People can only send you plaintext until your encryption key is on-chain.{' '}
          <button onClick={onPublishKey}>Publish key (0.001 ALGO)</button>
        </div>
      )}

      {showConnect && !me && (
        <ConnectModal
          wallets={wallets}
          net={net}
          onNet={onNet}
          onConnected={(opts) => {
            setShowConnect(false)
            if (opts?.newTestMnemonic) {
              // The adapter already persists the phrase; this flag just keeps the "throwaway account" reminder visible.
              const addr = algosdk.mnemonicToSecretKey(opts.newTestMnemonic).addr.toString()
              localStorage.setItem(testKey(addr), opts.newTestMnemonic)
              setTestMnemonic(opts.newTestMnemonic)
            }
          }}
          onError={setError}
          onClose={() => setShowConnect(false)}
        />
      )}
      {showNew && me && (
        <NewChatModal
          net={net}
          me={me}
          recent={recent}
          onStart={(addr) => {
            setShowNew(false)
            void openConversation(addr)
          }}
          onClose={() => setShowNew(false)}
        />
      )}
      {mnemonicOpen && <MnemonicModal />}
      {confirmDialog}

      {showShare && me && (
        <div className="modal-backdrop" onClick={() => setShowShare(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <SharePanel me={me} name={name(me)} onClose={() => setShowShare(false)} />
          </div>
        </div>
      )}
      {showKeys && me && keys && (
        <div className="modal-backdrop" onClick={() => setShowKeys(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>
      )}

      {!me ? (
        <Landing linkTarget={linkTarget} onConnect={() => setShowConnect(true)} />
      ) : (
        <main className={`layout ${selected ? 'thread-open' : ''}`}>
          <aside>
            <button className="primary block" onClick={() => setShowNew(true)}>
              ✎ New message
            </button>
            {threads.length > 3 && <input className="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />}
            {mailbox.loading && threads.length === 0 && <div className="muted pad">Loading your mailbox…</div>}
            {!mailbox.loading && threads.length === 0 && (
              <div className="muted pad">
                No conversations yet. Start one, or share your link so someone can message you.
              </div>
            )}
            {requests.length > 0 && (
              <button className="section" onClick={() => setShowRequests((v) => !v)}>
                {showRequests ? '▾' : '▸'} Requests <span className="badge">{requests.length}</span>
              </button>
            )}
            {showRequests && requests.map(row)}
            {requests.length > 0 && contacts.length > 0 && <div className="section muted">Conversations</div>}
            {contacts.map(row)}
            {blockedThreads.length > 0 && (
              <details className="blocked">
                <summary className="section muted">Blocked ({blockedThreads.length})</summary>
                {blockedThreads.map(row)}
              </details>
            )}
          </aside>
          <section className="chat">
            {!selected ? (
              <div className="center">
                <SetupGuide
                  net={net}
                  me={me}
                  balance={balance.micro}
                  keyPublished={!!publishedKey && !!keys && samePub(publishedKey, keys.publicKey)}
                  hasChats={threads.some((t) => t.relation === 'contact')}
                  testMnemonic={testMnemonic}
                  busy={!!busy}
                  onPublish={() => void onPublishKey()}
                  onNewChat={() => setShowNew(true)}
                  onShare={() => setShowShare(true)}
                />
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
                relation={thread?.relation ?? 'contact'}
                onAccept={() => setAccepted(accept(net, me, selected))}
                onBlock={() => {
                  setBlocked(block(net, me, selected))
                  setAccepted(loadAccepted(net, me))
                  setSelected(null)
                }}
                onUnblock={() => setBlocked(unblock(net, me, selected))}
              />
            )}
          </section>
        </main>
      )}
    </div>
  )
}

function ago(unix: number) {
  const d = Date.now() / 1000 - unix
  if (d < 60) return 'now'
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  if (d < 7 * 86400) return `${Math.floor(d / 86400)}d`
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
