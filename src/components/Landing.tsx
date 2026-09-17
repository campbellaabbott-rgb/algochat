import { NetworkId } from '@txnlab/use-wallet'
import { NETWORKS } from '../lib/config'

export function Landing({ linkTarget, onConnect }: { linkTarget: string | null; onConnect: () => void }) {
  return (
    <main className="landing">
      {linkTarget && (
        <div className="banner warn">
          Someone shared their link with you. Connect a wallet to message <b>{linkTarget}</b>.
        </div>
      )}
      <section className="hero">
        <h1>Messages that live on Algorand</h1>
        <p className="lede">
          Every message is a 0-ALGO transaction with the text in its note, end-to-end encrypted with NaCl. There is no
          server to trust, subpoena, or shut down — the chain is the mailbox, and your wallet is your login.
        </p>
        <div className="row wrap cta">
          <button className="primary big" onClick={onConnect}>
            Connect wallet
          </button>
          <span className="muted small">or try it free on TestNet — no wallet needed</span>
        </div>
      </section>

      <section className="grid3">
        <div className="card">
          <h3>1 · Connect</h3>
          <p>Pera, Defly or Lute. On TestNet you can paste a throwaway mnemonic instead.</p>
        </div>
        <div className="card">
          <h3>2 · Publish a key</h3>
          <p>One transaction announces your encryption key so anyone can write to you privately.</p>
        </div>
        <div className="card">
          <h3>3 · Message</h3>
          <p>
            Paste an address or <code>name.algo</code>, or share your link. Each message is one signature.
          </p>
        </div>
      </section>

      <section>
        <h2>What it costs</h2>
        <table>
          <tbody>
            <tr>
              <td>Publish your key</td>
              <td>0.001 ALGO, once</td>
            </tr>
            <tr>
              <td>Message up to ~680 characters</td>
              <td>0.001 ALGO</td>
            </tr>
            <tr>
              <td>Longer messages (up to ~10k characters)</td>
              <td>0.001 ALGO per 1 KB, sent as one atomic group</td>
            </tr>
            <tr>
              <td>Reading, names, notifications</td>
              <td>free</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Fees go to the network, not to this app. Recipients must hold at least 0.1 ALGO (Algorand’s minimum balance).
        </p>
      </section>

      <section>
        <h2>Questions</h2>
        <details>
          <summary>Is it private?</summary>
          <p>
            Message <em>content</em> is encrypted so only you and the recipient can read it. Message <em>metadata</em> — who
            wrote to whom, when, and how often — is public on the blockchain forever, like any transaction. If the
            recipient hasn’t published a key, the app warns you before sending in plaintext.
          </p>
        </details>
        <details>
          <summary>Can messages be deleted?</summary>
          <p>No. The chain is permanent. You can hide conversations and block senders in this app, locally.</p>
        </details>
        <details>
          <summary>Where are my keys?</summary>
          <p>
            Your encryption key is derived from your wallet where possible, so every device that connects the same account
            gets the same key. Otherwise it lives in this browser and can be exported from the 🔑 panel.
          </p>
        </details>
        <details>
          <summary>How do I try it for free?</summary>
          <p>
            Switch to TestNet, get free ALGO from the{' '}
            <a href={NETWORKS[NetworkId.TESTNET].dispenser} target="_blank" rel="noreferrer">
              dispenser
            </a>
            , and message yourself from a second account.
          </p>
        </details>
        <details>
          <summary>Is this open source?</summary>
          <p>
            Yes —{' '}
            <a href="https://github.com/campbellaabbott-rgb/algochat" target="_blank" rel="noreferrer">
              github.com/campbellaabbott-rgb/algochat
            </a>
            . The app is a static page; you can host your own copy.
          </p>
        </details>
      </section>
    </main>
  )
}
