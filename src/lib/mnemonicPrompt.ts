import { useSyncExternalStore } from 'react'

/**
 * Bridges the Mnemonic adapter's `promptForMnemonic` callback to a React
 * modal, replacing the default window.prompt.
 */
type Pending = { resolve: (v: string | null) => void } | null
let pending: Pending = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function promptForMnemonic(): Promise<string | null> {
  pending?.resolve(null)
  return new Promise((resolve) => {
    pending = { resolve }
    emit()
  })
}

export function answerMnemonic(value: string | null) {
  pending?.resolve(value)
  pending = null
  emit()
}

export function useMnemonicPromptOpen() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pending !== null,
  )
}
