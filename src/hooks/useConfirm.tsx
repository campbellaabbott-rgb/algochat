import { useCallback, useState, type ReactNode } from 'react'

type Ask = { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void }

/** Promise-based confirm dialog: `const ok = await confirm({...})`. */
export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const confirm = useCallback(
    (opts: Omit<Ask, 'resolve'>) =>
      new Promise<boolean>((resolve) => {
        setAsk({ ...opts, resolve })
      }),
    [],
  )
  const close = (ok: boolean) => {
    ask?.resolve(ok)
    setAsk(null)
  }
  const dialog = ask ? (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <b>{ask.title}</b>
        <div className="muted">{ask.body}</div>
        <div className="row">
          <span />
          <span>
            <button className="ghost" onClick={() => close(false)}>
              Cancel
            </button>{' '}
            <button className={ask.danger ? 'danger' : ''} onClick={() => close(true)} autoFocus>
              {ask.confirmLabel}
            </button>
          </span>
        </div>
      </div>
    </div>
  ) : null
  return { confirm, dialog }
}
