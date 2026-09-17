import { useSyncExternalStore } from 'react'

/**
 * Bridges the Mnemonic adapter's `promptForMnemonic` callback to the UI. Two
 * paths: a preset answer (the app already knows the phrase — e.g. it just
 * generated a test account), or a modal that asks the person to paste one.
 */
type Pending = { resolve: (v: string | null) => void } | null
let pending: Pending = null
let preset: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function promptForMnemonic(): Promise<string | null> {
  if (preset) {
    const m = preset
    preset = null
    return Promise.resolve(m)
  }
  pending?.resolve(null)
  return new Promise((resolve) => {
    pending = { resolve }
    emit()
  })
}

/** Answer the next prompt without showing the modal. */
export function presetMnemonic(m: string) {
  preset = m
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
