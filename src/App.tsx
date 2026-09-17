import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import algosdk from 'algosdk'
import { NetworkId } from '@txnlab/use-wallet'
import { useNetwork, useWallet } from '@txnlab/use-wallet-react'
import { NETWORKS, asNetId } from './lib/config'
import { buildMessageNote, fetchMessages, fetchPublishedKey, friendlyError, publishKey, sendMessage, type ChainMessage } from './lib/chain'
import { decrypt, ensureKeys, exportSecret, importSecret, samePub, type EncKeys } from './lib/crypto'
import { MAX_NOTE_BYTES } from './lib/config'
import { answerMnemonic, useMnemonicPromptOpen } from './lib/mnemonicPrompt'

const POLL_MS = 6000
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const sentCacheKey = (id: string) => `algochat:sent:${id}`

type Thread = { peer: string; messages: ChainMessage[]; last: number }

export default function App() {
  const { activeNetwork, setActiveNetwork } = useNetwork()
  const { wallets, activeAddress, activeWallet, transactionSigner, isReady } = useWallet()
  const net = asNetId(activeNetwork)
  const me = activeAddress

  const [keys, setKeys] = useState<EncKeys | null>(null)
  const [publishedKey, setPublishedKey] = useState<Uint8Array | null | undefined>(undefined)
  const [messages, setMessages] = useState<ChainMessage[]>([])
  const [pending, setPending] = useState<ChainMessage[]>([])
  const [peerKeys, setPeerKeys] = useState<Record<string, Uint8Array | null>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [newPeer, setNewPeer] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [loading, setLoading] = useState(false)
  const mnemonicOpen = useMnemonicPromptOpen()

  // Local encryption keypair per (network, address).
  useEffect(() => {
    if (!me) {
      setKeys(null)
      setPublishedKey(undefined)
      return
    }
    setKeys(ensureKeys(net, me))
    setPublishedKey(undefined)
    setPeerKeys({})
    fetchPublishedKey(net, me).then(setPublishedKey).catch(() => setPublishedKey(null))
  }, [net, me])

  // Poll the indexer for the whole mailbox. Messages are immutable, so a full
  // refetch is fine at this scale; swap to minRound once a mailbox is large.
  const refresh = useCallback(async () => {
    if (!me) return
    try {
      const msgs = await fetchMessages(net, me)
      setMessages(msgs)
      // A peer can publish a key at any time; keep the open thread's current.
      if (selected) {
        const k = await fetchPublishedKey(net, selected).catch(() => undefined)
        if (k !== undefined) setPeerKeys((p) => ({ ...p, [selected]: k }))
      }
      setPending((p) => p.filter((x) => !msgs.some((m) => m.id === x.id)))
      setError((e) => (e?.startsWith('Indexer') ? null : e))
    } catch (e) {
      setError(`Indexer unreachable: ${(e as Error).message}`)
    }
  }, [net, me, selected])

  useEffect(() => {
    if (!me) {
      setMessages([])
      setPending([])
      setSelected(null)
      return
    }
    setLoading(true)
    refresh().finally(() => setLoading(false))
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [me, refresh])

  const threads = useMemo<Thread[]>(() => {
    if (!me) return []
    const byPeer = new Map<string, ChainMessage[]>()
    for (const m of [...messages, ...pending]) {
      const peer = m.from === me ? m.to : m.from
      if (!byPeer.has(peer)) byPeer.set(peer, [])
      byPeer.get(peer)!.push(m)
    }
    return [...byPeer.entries()]
      .map(([peer, ms]) => ({ peer, messages: ms, last: ms[ms.length - 1]?.time ?? 0 }))
      .sort((a, b) => b.last - a.last)
  }, [messages, pending, me])

  // Resolve the selected peer's published key (cached per session).
  const loadPeerKey = useCallback(
    async (peer: string) => {
      if (peer in peerKeys) return peerKeys[peer]
      const k = await fetchPublishedKey(net, peer).catch(() => null)
      setPeerKeys((p) => ({ ...p, [peer]: k }))
      return k
    },
    [net, peerKeys],
  )

  useEffect(() => {
    if (selected) void loadPeerKey(selected)
  }, [selected, loadPeerKey])

  // Fetch keys for every peer in the thread list so incoming messages decrypt.
  useEffect(() => {
    for (const t of threads) if (!(t.peer in peerKeys)) void loadPeerKey(t.peer)
  }, [threads, peerKeys, loadPeerKey])

  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [selected, threads])

  const needsPublish = keys && publishedKey !== undefined && (!publishedKey || !samePub(publishedKey, keys.publicKey))

  async function onPublishKey() {
    if (!me || !keys) return
    setBusy('Publishing your encryption key…')
    setError(null)
    try {
      await publishKey(net, me, keys, transactionSigner)
      setPublishedKey(keys.publicKey)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  const peerPub = selected ? (peerKeys[selected] ?? null) : null
  const noteBytes = useMemo(() => (keys && draft ? buildMessageNote(draft, keys, peerPub).length : 0), [draft, keys, peerPub])

  async function onSend() {
    if (!me || !keys || !selected || !draft.trim()) return
    const text = draft.trim()
    setBusy('Waiting for signature…')
    setError(null)
    try {
      const theirPub = await loadPeerKey(selected)
      const note = buildMessageNote(text, keys, theirPub)
      setBusy('Confirming on-chain…')
      const id = await sendMessage(net, me, selected, note, transactionSigner)
      localStorage.setItem(sentCacheKey(id), text)
      setPending((p) => [
        ...p,
        { id, from: me, to: selected, round: 0n, time: Math.floor(Date.now() / 1000), payload: { kind: 'plain', text } },
      ])
      setDraft('')
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  function render(m: ChainMessage): { text: string; locked: boolean } {
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
  }

  function startConversation() {
    const a = newPeer.trim()
    if (!algosdk.isValidAddress(a)) return setError('That is not a valid Algorand address')
    if (a === me) return setError('That is your own address')
    setError(null)
    setSelected(a)
    setNewPeer('')
  }

  const thread = threads.find((t) => t.peer === selected)

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
              <button className="ghost" onClick={() => setShowKeys((s) => !s)} title="Encryption key">
                🔑
              </button>
              <span className="addr" title={me}>
                {activeWallet?.metadata.name} · {short(me)}
              </span>
              <button onClick={() => activeWallet?.disconnect()}>Disconnect</button>
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
        </div>
      )}

      {mnemonicOpen && <MnemonicModal />}

      {showKeys && me && keys && (
        <KeyPanel keys={keys} onImport={(b64) => setKeys(importSecret(net, me, b64))} onClose={() => setShowKeys(false)} />
      )}

      {!me ? (
        <main className="empty">
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
        <main className="layout">
          <aside>
            <form
              className="newpeer"
              onSubmit={(e) => {
                e.preventDefault()
                startConversation()
              }}
            >
              <input placeholder="Recipient address…" value={newPeer} onChange={(e) => setNewPeer(e.target.value)} />
              <button type="submit">New</button>
            </form>
            {loading && threads.length === 0 && <div className="muted">Loading mailbox…</div>}
            {!loading && threads.length === 0 && <div className="muted">No conversations yet.</div>}
            {threads.map((t) => (
              <button key={t.peer} className={`thread ${t.peer === selected ? 'active' : ''}`} onClick={() => setSelected(t.peer)}>
                <div className="peer">{short(t.peer)}</div>
                <div className="preview">{render(t.messages[t.messages.length - 1]).text}</div>
              </button>
            ))}
          </aside>

          <section className="chat">
            {!selected ? (
              <div className="muted center">Pick a conversation or paste an address.</div>
            ) : (
              <>
                <div className="chathead">
                  <a href={`${NETWORKS[net].explorer}/account/${selected}`} target="_blank" rel="noreferrer">
                    {selected}
                  </a>
                  <span className={`pill ${peerPub ? 'ok' : ''}`}>
                    {selected in peerKeys ? (peerPub ? '🔒 end-to-end encrypted' : '🔓 plaintext — no key published') : '…'}
                  </span>
                </div>
                <div className="messages">
                  {thread?.messages.map((m) => {
                    const r = render(m)
                    const mine = m.from === me
                    return (
                      <div key={m.id} className={`msg ${mine ? 'mine' : ''} ${r.locked ? 'locked' : ''}`}>
                        <div className="body">{r.text}</div>
                        <div className="meta">
                          {m.round === 0n ? (
                            'confirmed · indexing…'
                          ) : (
                            <a href={`${NETWORKS[net].explorer}/transaction/${m.id}`} target="_blank" rel="noreferrer">
                              {new Date(m.time * 1000).toLocaleString()}
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void onSend()
                  }}
                >
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Message… (Enter to send, Shift+Enter for newline)"
                    disabled={!!busy}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void onSend()
                      }
                    }}
                  />
                  <div className="composer-foot">
                    <span className={`muted ${noteBytes > MAX_NOTE_BYTES ? 'over' : ''}`}>
                      {noteBytes}/{MAX_NOTE_BYTES} bytes · fee 0.001 ALGO
                    </span>
                    <button type="submit" disabled={!!busy || !draft.trim() || noteBytes > MAX_NOTE_BYTES}>
                      Send
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </main>
      )}
    </div>
  )
}

function KeyPanel({ keys, onImport, onClose }: { keys: EncKeys; onImport: (b64: string) => void; onClose: () => void }) {
  const [val, setVal] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="keypanel">
      <div className="row">
        <b>Encryption key</b>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="muted">
        Your secret key lives only in this browser. Copy it to another device to read your history there; after importing,
        no republish is needed if the public half matches.
      </p>
      <code className="secret">{exportSecret(keys)}</code>
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

function MnemonicModal() {
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
