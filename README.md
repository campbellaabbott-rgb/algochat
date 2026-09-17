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

Each message costs the 0.001 ALGO network fee and fits ~680 encrypted
characters (1024-byte note limit).

## How it works

| Note prefix | Meaning |
|---|---|
| `amsg1:k:<b64 pub>` | Key announcement — a self-payment publishing your x25519 public key |
| `amsg1:p:<text>` | Plaintext message |
| `amsg1:e:<b64 senderPub>.<b64 nonce>.<b64 box>` | Encrypted message; both parties can open it |

- **Reads** go through the public AlgoNode indexer: one `note-prefix` +
  `address` query returns your whole mailbox (sent and received), polled every
  6 s.
- **Writes** are signed by the connected wallet and submitted to AlgoNode
  algod; the UI waits for confirmation and shows the message as
  "indexing…" until the indexer catches up.
- **Keys** — wallets don't expose private keys, so each (network, address)
  gets a local x25519 keypair in `localStorage`. The 🔑 panel exports/imports
  it so another device can read your history. Sent messages are also cached
  locally by txid, so you can re-read them even if the peer rotates keys.

Source map: [`src/lib/protocol.ts`](src/lib/protocol.ts) wire format ·
[`src/lib/crypto.ts`](src/lib/crypto.ts) keys and boxes ·
[`src/lib/chain.ts`](src/lib/chain.ts) indexer reads and transaction sends ·
[`src/App.tsx`](src/App.tsx) UI.

## Tests

```bash
npm test
```

Covers the note codec, encrypt/decrypt for sender, recipient and a third
party, the size budget, and key persistence.

## Caveats

- Notes are public: metadata (who messaged whom, when, how often) is visible
  on-chain even though the content is encrypted. Plaintext messages are
  public forever.
- No forward secrecy — a leaked secret key opens the entire history.
- The mailbox is refetched in full each poll; fine for hundreds of messages,
  switch to `minRound` paging beyond that.
