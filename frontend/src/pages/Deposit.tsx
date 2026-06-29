import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet'
import { addAspMember, type ProgressStep } from '../utils/asp'
import { createDepositNote, type DepositNote } from '../utils/zk'
import { deposit, getPoolLeaves } from '../utils/stellar'
import { computeCircomlibRoot } from '../utils/circuits'
import { useToast } from '../components/Toast'
import { formatXlm, formatBalance } from '../utils/format'

type Phase = 'idle' | 'generating' | 'signing' | 'done'
type AspPhase = 'idle' | 'approving' | 'approved'

// XLM presets the user can choose from
const PRESETS = [
  { label: '1 XLM',   stroops: 10_000_000n },
  { label: '5 XLM',   stroops: 50_000_000n },
  { label: '10 XLM',  stroops: 100_000_000n },
  { label: '50 XLM',  stroops: 500_000_000n },
  { label: '100 XLM', stroops: 1_000_000_000n },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCustomAmount(raw: string): { stroops: bigint; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { stroops: 0n, error: null }

  const num = parseFloat(trimmed)
  if (isNaN(num) || !isFinite(num)) return { stroops: 0n, error: 'Enter a valid number.' }
  if (num <= 0) return { stroops: 0n, error: 'Amount must be greater than 0.' }
  if (num > 1_000_000) return { stroops: 0n, error: 'Maximum deposit is 1,000,000 XLM.' }

  // Convert to stroops, truncating to integer
  const stroops = BigInt(Math.floor(num * 10_000_000))
  return { stroops, error: null }
}

function downloadSecret(secret: string, commitment: string) {
  const content = [
    '# NullHaven Deposit Secret',
    '# KEEP THIS FILE SAFE — it is the ONLY way to withdraw your funds.',
    '# Do NOT share this file with anyone.',
    '',
    `Commitment: ${commitment}`,
    `Secret:     ${secret}`,
    '',
    `Generated:  ${new Date().toISOString()}`,
  ].join('\n')

  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nullhaven-secret-${commitment.slice(0, 8)}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DepositPage() {
  const { publicKey, sign, isConnected, balance, refreshBalance } = useWallet()
  const { addToast } = useToast()

  const [phase,    setPhase]    = useState<Phase>('idle')
  const [receipt,  setReceipt]  = useState<DepositNote | null>(null)
  const [txHash,   setTxHash]   = useState('')
  const [aspPhase, setAspPhase] = useState<AspPhase>('idle')
  const [aspSteps, setAspSteps] = useState<ProgressStep[]>([])
  const [copied,   setCopied]   = useState('')
  const [secretRevealed, setSecretRevealed] = useState(false)
  const [amountIdx, setAmountIdx] = useState(0)
  const [customAmount, setCustomAmount] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  const customParsed = useCustom ? parseCustomAmount(customAmount) : null
  const customError = customParsed?.error ?? null

  const selectedStroops = useCustom
    ? (customParsed?.stroops ?? 0n)
    : PRESETS[amountIdx].stroops

  const handleDeposit = useCallback(async () => {
    if (!publicKey || !sign) return
    setPhase('idle'); setTxHash(''); setReceipt(null); setSecretRevealed(false); setAspPhase('idle')

    // Validate amount
    if (selectedStroops <= 0n) {
      addToast('error', 'Select or enter a valid deposit amount.')
      return
    }

    try {
      // Phase 1 — generate ZK commitment off-chain
      setPhase('generating')
      const r = await createDepositNote()
      setReceipt(r)

      // Phase 2 — compute circomlib root (including new commitment) and deposit
      // The root must include the new leaf, so we fetch existing leaves and append.
      setPhase('signing')
      const existingLeaves = await getPoolLeaves(publicKey)
      const allLeaves = [...existingLeaves, r.commitment]
      const circomRoot = await computeCircomlibRoot(allLeaves)

      const hash = await deposit(publicKey, r.commitment, selectedStroops, sign, circomRoot)
      setTxHash(hash)
      void refreshBalance()
      window.dispatchEvent(new Event('nullhaven:refresh-balance'))

      // Persist deposit locally (commitment + metadata only — secret is NEVER stored)
      const key = `nullhaven:deposits:${publicKey}`
      const prev = JSON.parse(localStorage.getItem(key) ?? '[]')
      prev.unshift({
        commitment: r.commitment,
        nullifier:  r.nullifier,
        amount:     selectedStroops.toString(),
        txHash:     hash,
        date:       new Date().toISOString(),
      })
      localStorage.setItem(key, JSON.stringify(prev))

      setPhase('done')
      addToast('success', `Deposited ${formatXlm(selectedStroops)} XLM successfully.`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Deposit failed. Please try again.'
      addToast('error', msg)
      setPhase('idle')
    }
  }, [publicKey, sign, selectedStroops, addToast, refreshBalance])

  const handleApproveAsp = useCallback(async () => {
    if (!publicKey || !sign || !receipt) return
    setAspPhase('approving')
    setAspSteps([])
    try {
      const { root } = await addAspMember(publicKey, receipt.commitment, 'deposit', sign, (step, status) => {
        setAspSteps(prev => {
          const existing = prev.findIndex(s => s.label === step)
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = { label: step, status }
            return updated
          }
          return [...prev, { label: step, status }]
        })
      })
      setAspPhase('approved')
      addToast('success', `ASP approval submitted. Root ${root.slice(0, 8)}... is synced or pending finality.`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'ASP approval failed.'
      addToast('error', msg)
      setAspPhase('idle')
      setAspSteps([])
    }
  }, [publicKey, sign, receipt, addToast])

  const copySecret = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      addToast('error', 'Failed to copy to clipboard. Try selecting and copying manually.')
    }
  }

  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto pt-20 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-slate-800/50 border border-border-default flex items-center justify-center">
          <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <p className="text-slate-400">Connect your Freighter wallet to deposit.</p>
      </div>
    )
  }

  const isLoading = phase === 'generating' || phase === 'signing'
  const displayAmount = useCustom
    ? `${customAmount || '0'} XLM`
    : PRESETS[amountIdx].label

  return (
    <div className="max-w-lg mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">Deposit</h1>
          <p className="text-xs text-slate-500">Send XLM to the privacy pool</p>
        </div>
      </div>

      {/* Amount selector card */}
      <div className="rounded-xl border border-border-default bg-surface-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Amount</span>
          <button
            type="button"
            onClick={() => setUseCustom(!useCustom)}
            className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            {useCustom ? 'Presets' : 'Custom'}
          </button>
        </div>

        {useCustom ? (
          <div className="relative">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={customAmount}
              onChange={e => setCustomAmount(e.target.value)}
              disabled={isLoading}
              placeholder="Enter XLM amount..."
              className={`w-full rounded-lg bg-slate-800/80 border px-4 py-3
                         text-lg font-semibold text-cyan-400 placeholder-slate-500
                         focus:outline-none focus:ring-1 transition-all duration-200
                         disabled:opacity-50 ${
                           customError
                             ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20'
                             : 'border-border-default focus:border-cyan-500 focus:ring-cyan-500/20'
                         }`}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">XLM</span>
            {customError && (
              <p className="text-red-400 text-xs mt-1.5">{customError}</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setAmountIdx(i)}
                disabled={isLoading}
                className={`py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 border
                  ${amountIdx === i
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 shadow-sm shadow-cyan-500/10'
                    : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border-default">
          <span className="text-sm text-slate-400">From</span>
          <code className="text-xs font-mono text-slate-300">{publicKey?.slice(0, 10)}...{publicKey?.slice(-6)}</code>
        </div>
        <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-[0.18em] text-emerald-400/70">Wallet balance</span>
          <span className="text-sm font-semibold text-emerald-300">{balance ? `${formatBalance(balance)} XLM` : 'Loading…'}</span>
        </div>
      </div>

      {/* Loading pipeline */}
      {isLoading && (
        <div className="rounded-xl border border-border-default bg-surface-card p-6 space-y-4 animate-scale-in">
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${phase === 'generating' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 animate-pulse' : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}>
              {phase === 'generating' ? (
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
              ) : '✓'}
            </div>
            <span className="text-sm text-slate-300">Generating ZK commitment off-chain</span>
          </div>
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${phase === 'signing' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 animate-pulse' : 'bg-slate-800 text-slate-600 border border-slate-700'}`}>
              {phase === 'signing' ? (
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
              ) : '2'}
            </div>
            <span className="text-sm text-slate-300">
              Signing transaction with Freighter ({displayAmount})
            </span>
          </div>
        </div>
      )}

      {/* Done state */}
      {phase === 'done' && receipt && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6 space-y-4 animate-scale-in">
          <div className="flex items-center gap-2 text-green-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span className="text-sm font-semibold">Deposited {displayAmount}</span>
          </div>

          {/* SECRET NOTE */}
          <div className="rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <span className="text-sm font-semibold text-amber-300">Secret Note — required to withdraw</span>
            </div>
            <p className="text-xs text-amber-400/70">
              This is the <strong>only</strong> way to withdraw your funds. Save it now —
              if you lose it, your deposit is permanently locked.
            </p>
            <div className="flex items-center justify-between gap-2">
              <code className="font-mono text-xs text-amber-200 break-all select-all flex-1">
                {secretRevealed ? receipt.secret : '•'.repeat(64)}
              </code>
              <div className="flex gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setSecretRevealed(!secretRevealed)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors font-medium"
                >
                  {secretRevealed ? 'Hide' : 'Reveal'}
                </button>
                {secretRevealed && (
                  <>
                    <button
                      type="button"
                      onClick={() => copySecret(receipt.secret, 'secret')}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors font-medium"
                    >
                      {copied === 'secret' ? '✓ Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadSecret(receipt.secret, receipt.commitment)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors font-medium"
                    >
                      ↓ Save
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ASP approval notice */}
          <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/15 p-3 text-xs text-cyan-400/80 space-y-2">
            <p>Approve this commitment before withdrawing. Wallet confirmations can take a moment; once submitted, slow RPC finality is treated as pending instead of a failed approval.</p>
            <button
              type="button"
              onClick={handleApproveAsp}
              disabled={aspPhase === 'approving' || aspPhase === 'approved'}
              className="w-full py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 font-medium hover:bg-cyan-500/25 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {aspPhase === 'approving' ? 'Confirm in wallet, then wait for sync...' : aspPhase === 'approved' ? 'ASP approval submitted ✓' : 'One-click approve for withdrawal'}
            </button>

            {/* Step-by-step progress for ASP approval */}
            {aspPhase === 'approving' && aspSteps.length > 0 && (
              <div className="rounded-lg bg-slate-800/50 border border-border-default p-3 space-y-1.5">
                {aspSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                      step.status === 'done'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 animate-pulse'
                    }`}>
                      {step.status === 'done' ? (
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : (
                        <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="3" strokeDasharray="18 18" strokeLinecap="round" />
                        </svg>
                      )}
                    </div>
                    <span className={`text-[11px] ${step.status === 'done' ? 'text-green-400' : 'text-cyan-300'}`}>
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <Link
              to={`/admin?commitment=${receipt.commitment}`}
              className="inline-flex items-center gap-1 font-medium text-cyan-300 hover:text-cyan-200 transition-colors"
            >
              Or open ASP Admin with this commitment →
            </Link>
          </div>

          <div className="rounded-lg bg-slate-900/50 border border-border-default p-3">
            <p className="text-xs text-slate-500 mb-1">Commitment (stored on-chain)</p>
            <code className="font-mono text-xs text-slate-400 break-all">{receipt.commitment}</code>
          </div>

          {txHash && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              View on Stellar Expert
            </a>
          )}

          <button
            type="button"
            onClick={() => { setPhase('idle'); setReceipt(null); setTxHash(''); setSecretRevealed(false); setAspPhase('idle') }}
            className="w-full py-2.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-sm font-medium hover:bg-cyan-500/20 transition-colors"
          >
            Make Another Deposit
          </button>
        </div>
      )}

      {/* Idle state — deposit button */}
      {phase === 'idle' && (
        <button
          type="button"
          onClick={handleDeposit}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 font-semibold text-base hover:from-cyan-400 hover:to-cyan-500 transition-all duration-200 hover:shadow-lg hover:shadow-cyan-500/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!publicKey || (useCustom && !!customError)}
        >
          Deposit {displayAmount}
        </button>
      )}
    </div>
  )
}
