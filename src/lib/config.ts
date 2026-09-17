import algosdk from 'algosdk'
import { NetworkId } from '@txnlab/use-wallet'

export type NetId = typeof NetworkId.TESTNET | typeof NetworkId.MAINNET

export const NETWORKS: Record<NetId, { label: string; algod: string; indexer: string; explorer: string; dispenser?: string }> = {
  [NetworkId.TESTNET]: {
    label: 'TestNet',
    algod: 'https://testnet-api.algonode.cloud',
    indexer: 'https://testnet-idx.algonode.cloud',
    explorer: 'https://lora.algokit.io/testnet',
    dispenser: 'https://bank.testnet.algorand.network/',
  },
  [NetworkId.MAINNET]: {
    label: 'MainNet',
    algod: 'https://mainnet-api.algonode.cloud',
    indexer: 'https://mainnet-idx.algonode.cloud',
    explorer: 'https://lora.algokit.io/mainnet',
  },
}

export function indexerFor(net: NetId) {
  return new algosdk.Indexer('', NETWORKS[net].indexer, 443)
}

export function algodFor(net: NetId) {
  return new algosdk.Algodv2('', NETWORKS[net].algod, 443)
}

/** Algorand rejects a receiver that would end below the 0.1 ALGO minimum balance. */
export const MIN_BALANCE = 100_000
export const MAX_NOTE_BYTES = 1024
