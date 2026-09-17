import algosdk from 'algosdk'
import { NetworkId } from '@txnlab/use-wallet'

export type NetId = typeof NetworkId.TESTNET | typeof NetworkId.MAINNET | typeof NetworkId.LOCALNET

type Endpoint = { url: string; port: number; token?: string }
export const NETWORKS: Record<NetId, { label: string; algod: Endpoint; indexer: Endpoint; explorer: string; dispenser?: string }> = {
  [NetworkId.TESTNET]: {
    label: 'TestNet',
    algod: { url: 'https://testnet-api.algonode.cloud', port: 443 },
    indexer: { url: 'https://testnet-idx.algonode.cloud', port: 443 },
    explorer: 'https://lora.algokit.io/testnet',
    dispenser: 'https://bank.testnet.algorand.network/',
  },
  [NetworkId.MAINNET]: {
    label: 'MainNet',
    algod: { url: 'https://mainnet-api.algonode.cloud', port: 443 },
    indexer: { url: 'https://mainnet-idx.algonode.cloud', port: 443 },
    explorer: 'https://lora.algokit.io/mainnet',
  },
  // AlgoKit LocalNet ports; `node scripts/mockchain.mjs` serves the same ones.
  [NetworkId.LOCALNET]: {
    label: 'LocalNet',
    algod: { url: 'http://localhost', port: 4001, token: 'a'.repeat(64) },
    indexer: { url: 'http://localhost', port: 8980 },
    explorer: 'https://lora.algokit.io/localnet',
  },
}

export function indexerFor(net: NetId) {
  const e = NETWORKS[net].indexer
  return new algosdk.Indexer(e.token ?? '', e.url, e.port)
}

export function algodFor(net: NetId) {
  const e = NETWORKS[net].algod
  return new algosdk.Algodv2(e.token ?? '', e.url, e.port)
}

export function asNetId(id: string): NetId {
  return id === NetworkId.MAINNET || id === NetworkId.LOCALNET ? id : NetworkId.TESTNET
}

/** Algorand rejects a receiver that would end below the 0.1 ALGO minimum balance. */
export const MIN_BALANCE = 100_000
export const MAX_NOTE_BYTES = 1024
