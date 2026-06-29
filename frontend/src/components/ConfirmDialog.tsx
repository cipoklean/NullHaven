import { useState, useCallback, useEffect } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
  })

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({
          ...options,
          open: true,
          onConfirm: () => { setState((s) => ({ ...s, open: false })); resolve(true) },
          onCancel:  () => { setState((s) => ({ ...s, open: false })); resolve(false) },
        })
      })
    },
    [],
  )

  return { confirm, dialog: state }
}

// ─── Dialog component ────────────────────────────────────────────────────────

export function ConfirmDialog({
  dialog,
}: {
  dialog: ConfirmState
}) {
  // Close on Escape — must be called unconditionally (rules of hooks)
  useEffect(() => {
    if (!dialog.open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dialog.onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dialog.open, dialog.onCancel])

  if (!dialog.open) return null

  const isDanger = dialog.variant === 'danger'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={dialog.onCancel}
      />
      {/* Dialog */}
      <div className="relative max-w-sm w-full rounded-2xl border border-border-default bg-surface-elevated p-6 space-y-4 animate-scale-in shadow-2xl">
        <h3 className="text-lg font-bold text-slate-100">{dialog.title}</h3>
        <p className="text-sm text-slate-400 leading-relaxed" style={{ whiteSpace: 'pre-line' }}>{dialog.message}</p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={dialog.onCancel}
            className="px-4 py-2.5 rounded-xl text-sm font-medium border border-border-default text-slate-300 hover:bg-slate-800/50 transition-colors"
          >
            {dialog.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={dialog.onConfirm}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
              isDanger
                ? 'bg-gradient-to-r from-red-600 to-red-700 text-white hover:from-red-500 hover:to-red-600'
                : 'bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 hover:from-cyan-400 hover:to-cyan-500'
            }`}
          >
            {dialog.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
