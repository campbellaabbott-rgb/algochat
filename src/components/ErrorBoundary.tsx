import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="empty">
        <h1>Something broke</h1>
        <p className="muted">{this.state.error.message}</p>
        <p>
          <button onClick={() => location.reload()}>Reload</button>{' '}
          <button
            className="ghost"
            onClick={() => {
              for (const k of Object.keys(localStorage)) if (k.startsWith('algochat:') || k.startsWith('@txnlab')) localStorage.removeItem(k)
              location.reload()
            }}
          >
            Reset local state and reload
          </button>
        </p>
      </main>
    )
  }
}
