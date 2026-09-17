import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NetworkId, WalletManager } from '@txnlab/use-wallet'
import { WalletProvider } from '@txnlab/use-wallet-react'
import { pera } from '@txnlab/use-wallet-pera'
import { defly } from '@txnlab/use-wallet-defly'
import { lute } from '@txnlab/use-wallet-lute'
import { mnemonic } from '@txnlab/use-wallet-mnemonic'
import App from './App'
import { promptForMnemonic } from './lib/mnemonicPrompt'
import './index.css'

const manager = new WalletManager({
  wallets: [
    pera(),
    defly(),
    lute({ siteName: 'AlgoChat' }),
    // Dev-only: the adapter itself refuses to run on MainNet.
    mnemonic({ persistToStorage: true, promptForMnemonic }),
  ],
  defaultNetwork: NetworkId.TESTNET,
  options: { persistNetwork: true },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider manager={manager}>
      <App />
    </WalletProvider>
  </StrictMode>,
)
