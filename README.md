# AlgoChat

Serverless messaging on Algorand. Every message is a 0-ALGO payment whose
note field carries the text, so the chain is the mailbox: no backend, no
accounts, nothing to take down. Messages are end-to-end encrypted with NaCl
box (x25519 + XSalsa20-Poly1305).

## Run it

```bash
npm install
npm run dev
```

Open the printed URL, pick a wallet:

- **Pera / Defly / Lute** — real wallets, TestNet or MainNet.
- **Mnemonic** — TestNet only. Paste a throwaway 25-word phrase; fund it at
  the [dispenser](https://bank.testnet.algorand.network/). Never paste a
  MainNet key.

Then:

1. **Publish key** (one 0.001 ALGO self-payment). Until you do, people can
   only send you plaintext.
2. Paste a recipient address → **New**, type, **Send**. The recipient must
   already hold ≥ 0.1 ALGO — Algorand refuses payments that leave an account
   under the minimum balance.

Each transaction costs the 0.001 ALGO network fee and carries up to 1024
note bytes (~680 encrypted characters). Longer messages ship as one atomic
group of up to 16 transactions (~10k characters, all-or-nothing, one
signature prompt), and the composer shows the transaction count and fee
before you send.

Recipients can be typed as an address or a `.algo` name (resolved through
NFDomains on TestNet/MainNet). Click a name in the thread header to set a
local nickname. Unread counts show per thread and in the tab title; the 🔔
button turns on browser notifications for messages that arrive while you're
elsewhere.

## How it works

| Note prefix | Meaning |
|---|---|
| `amsg1:k:<b64 pub>` | Key announcement — a self-payment publishing your x25519 public key |
| `amsg1:p:<text>` | Plaintext message |
| `amsg1:e:<b64 senderPub>.<b64 nonce>.<b64 box>` | Encrypted message; both parties can open it |
| `amsg1:x:<i>/<n>:<bytes>` | Piece *i* of *n* of a long message, sent as one atomic group; join by group id, then decode as above |

- **Reads** go through the public AlgoNode indexer: one `note-prefix` +
  `address` query returns your whole mailbox (sent and received) on connect,
  then every 6 s from the last confirmed round.
- **Writes** are signed by the connected wallet and submitted to AlgoNode
  algod; the UI waits for confirmation and shows the message as
  "indexing…" until the indexer catches up.
- **Keys** — an x25519 pair per (network, address). Where the wallet can
  help, it's *derived* so every device recomputes the same key: the Mnemonic
  wallet derives from the account's private key automatically; Pera and Lute
  can derive from an ARC-60 signature over a fixed message (🔑 → "Derive key
  from wallet"; the message includes the site origin, so a different
  deployment yields a different key). Otherwise a random key lives in
  `localStorage` and the 🔑 panel exports/imports it. Sent messages are also
  cached locally by txid, so you can re-read them even if the peer rotates
  keys.

Source map: [`src/lib/protocol.ts`](src/lib/protocol.ts) wire format ·
[`src/lib/crypto.ts`](src/lib/crypto.ts) keys and boxes ·
[`src/lib/chain.ts`](src/lib/chain.ts) indexer reads and transaction sends ·
[`src/App.tsx`](src/App.tsx) UI.

## Local chain without Docker

```bash
npm run mockchain -- --fund ADDR1,ADDR2
```

`scripts/mockchain.mjs` is an in-memory stand-in that speaks the algod +
indexer REST subset this app uses, on the AlgoKit LocalNet ports. It decodes
submitted transactions with algosdk, verifies the ed25519 signature, and
applies fee and minimum-balance rules — so the whole signing/encoding/reading
path runs for real without a dispenser. Pick **LocalNet** in the app's network
selector. It is not a consensus node (payments only; no TEAL, assets or
groups); a real AlgoKit LocalNet works on the same ports.

## Tests

```bash
npm test
```

Unit tests cover the note codec, encrypt/decrypt for sender, recipient and a
third party, the size budget, and key persistence. The integration test
spawns the mock chain and runs two accounts through key publish, encrypted
send and reply, plaintext fallback, and the rejection paths (unfunded
recipient, forged signature, oversize note).

## Caveats

- Notes are public: metadata (who messaged whom, when, how often) is visible
  on-chain even though the content is encrypted. Plaintext messages are
  public forever.
- No forward secrecy — a leaked secret key opens the entire history.
- Wallet-derived keys via ARC-60 have not been exercised against a real Pera
  or Lute here; the code falls back to a local key if signing fails.
