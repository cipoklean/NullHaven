import { useState, useCallback } from 'react'
import { useWallet } from '../hooks/useWallet'
import { deriveFromSecret, generateMerkleProof, generateWithdrawProof } from '../utils/zk'
import { getAspRoot, getPoolLeaves, withdraw } from '../utils/stellar'
import { isAspDenied } from '../utils/asp'
import { useToast } from '../components/Toast'

type Step =
  | { id: 'idle' }
  | { id: 'loading'; label: string; progress: number }
  | { id: 'done'; txHash: string }
  | { id: 'error'; message: string }

const HORIZON_BASE = 'https://stellar.expert/explorer/testnet/tx'

function isValidStellarAddr(s: string) { return /^[GC][A-Z2-7]{55}$/.test(s.trim()) }

const MILESTONES = [
  'Deriving commitment...',
  'Loading pool state...',
  'Building Merkle proof...',
  'Generating ZK proof...',
  'Submitting transaction...',
]

/** Load the most recent deposit metadata from localStorage by wallet address. */
function loadLastDeposit(pubkey: string): { commitment: string; nullifier: string } | null {
  try {
    const key = `nullhaven:deposits:${pubkey}`
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entries = JSON.parse(raw) as Array<{ commitment: string; nullifier: string }>
    for (const e of entries) {
      if (e.commitment && e.nullifier) return { commitment: e.commitment, nullifier: e.nullifier }
    }
    return null
  } catch {
    return null
  }
}

export default function WithdrawPage() {
  const { publicKey, sign, isConnected } = useWallet()
  const { addToast } = useToast()

  const [secret,    setSecret]    = useState('')
  const [showSec,   setShowSec]   = useState(false)
  const [recipient, setRecipient] = useState('')
  const [step,      setStep]      = useState<Step>({ id: 'idle' })

  const handleWithdraw = useCallback(async () => {
    if (!isConnected || !publicKey) return

    const secretTrim    = secret.trim()
    const recipientTrim = recipient.trim()

    if (!secretTrim)    return setStep({ id: 'error', message: 'Enter your secret note (64 hex characters from the deposit page).' })
    if (!/^[0-9a-fA-F]{64}$/.test(secretTrim))
      return setStep({ id: 'error', message: 'Secret must be exactly 64 hex characters. Did you paste the secret (not the nullifier) from the deposit page?' })
    if (!recipientTrim) return setStep({ id: 'error', message: 'Enter a recipient address.' })
    if (!isValidStellarAddr(recipientTrim))
      return setStep({ id: 'error', message: 'Invalid Stellar address — must start with G or C and be 56 characters.' })

    try {
      // 1. Derive commitment + nullifier from secret
      setStep({ id: 'loading', label: MILESTONES[0], progress: 0 })
      const { commitment } = await deriveFromSecret(secretTrim)

      const denied = await isAspDenied(publicKey, commitment)
      if (denied) {
        throw new Error('This commitment is on the ASP denylist. Withdrawal is blocked before proof generation.')
      }

      // 2. Load pool leaves from chain
      setStep({ id: 'loading', label: MILESTONES[1], progress: 20 })
      const leaves = await getPoolLeaves(publicKey)
      const leafIndex = leaves.indexOf(commitment)
      if (leafIndex === -1) {
        const hint = leaves.length === 0
          ? 'The pool has no deposits yet.'
          : `Pool has ${leaves.length} commitment${leaves.length > 1 ? 's' : ''}, but yours was not found. `
        throw new Error(
          hint +
          'Possible causes:\n'
          + '• You entered the nullifier instead of the secret. Use the 64-char hex from the amber "Secret Note" box on the deposit page.\n'
          + '• The deposit has not been confirmed on-chain yet.\n'
          + '• You already withdrew this note (nullifier burned).'
        )
      }

      // 3. Build pool Merkle inclusion proof
      setStep({ id: 'loading', label: MILESTONES[2], progress: 35 })
      const merkleProof = await generateMerkleProof(leaves, leafIndex)

      // 4. Load ASP path from localStorage (set by admin)
      setStep({ id: 'loading', label: 'Loading ASP membership...', progress: 45 })
      const aspKey  = `nullhaven:asp:path:${commitment}`
      const aspRootKey = 'nullhaven:asp:root'
      const storedPath = localStorage.getItem(aspKey)
      const storedRoot = localStorage.getItem(aspRootKey)
      if (!storedPath || !storedRoot) {
        throw new Error(
          'ASP membership proof not found for commitment:\n'
          + commitment
          + '\n\nOpen ASP Admin, add this commitment to the allowlist, and let it update the on-chain ASP root before withdrawing.'
        )
      }
      const aspPathData: { path: string[]; indices: number[] } = JSON.parse(storedPath)
      const onChainAspRoot = await getAspRoot(publicKey)
      if (!onChainAspRoot) {
        throw new Error('ASP root is not set on-chain. Approve the commitment in ASP Admin before withdrawing.')
      }
      if (storedRoot.toLowerCase() !== onChainAspRoot.toLowerCase()) {
        throw new Error(
          'Local ASP proof is stale. Open ASP Admin, add/approve this commitment, and sync the ASP root before withdrawing.'
        )
      }

      // 5. Generate Groth16 ZK proof in browser
      setStep({ id: 'loading', label: MILESTONES[3], progress: 55 })
      const zkProof = await generateWithdrawProof({
        secretHex:   secretTrim,
        recipient:   recipientTrim,
        merkleProof,
        aspPath:     aspPathData.path,
        aspIndices:  aspPathData.indices,
        aspRoot:     storedRoot,
      })

      // 6. Submit withdrawal to Stellar
      setStep({ id: 'loading', label: MILESTONES[4], progress: 85 })
      const txHash = await withdraw(publicKey, {
        to:          recipientTrim,
        leafIdx:     leafIndex,
        proof:       zkProof,
        merkleProof,
      }, sign)

      // Cleanup — remove ASP path so it can't be reused
      localStorage.removeItem(aspKey)
      localStorage.setItem(`nullhaven:withdrawn:${commitment}`, 'true')
      localStorage.setItem(`nullhaven:spent:${commitment}`, 'true')

      setStep({ id: 'done', txHash })
      addToast('success', 'Withdrawal confirmed! Funds sent to recipient.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Withdrawal failed. Please try again.'
      setStep({ id: 'error', message: msg })
      addToast('error', msg)
    }
  }, [secret, recipient, isConnected, publicKey, sign, addToast])

  const reset = () => { setStep({ id: 'idle' }); setSecret(''); setRecipient('') }

  const fillFromLastDeposit = () => {
    if (!publicKey) return
    const last = loadLastDeposit(publicKey)
    if (last) {
      setStep({ id: 'error', message: `Found deposit ${last.commitment.slice(0, 12)}... Paste your 64-character secret note to continue. The secret is never stored in the browser — you saved it during deposit.` })
    } else {
      setStep({ id: 'error', message: 'No saved deposits found for this wallet. Make a deposit first.' })
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
        <p className="text-slate-400">Connect your Freighter wallet to withdraw.</p>
      </div>
    )
  }

  const busy = step.id === 'loading'

  return (
    <div className="max-w-lg mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Withdraw</h1>
            <p className="text-xs text-slate-500">Generate a ZK proof and withdraw to any address</p>
          </div>
        </div>
        {/* Quick-fill button */}
        {step.id === 'idle' && (
          <button
            type="button"
            onClick={fillFromLastDeposit}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400
                       hover:bg-amber-500/20 transition-colors"
          >
            Load last deposit
          </button>
        )}
      </div>

      <p className="text-sm text-slate-400 leading-relaxed">
        Paste your 64-character secret from the deposit page. A Groth16 ZK proof is
        generated entirely in your browser — the secret never leaves your device.
      </p>

      {/* Form card */}
      <div className="rounded-xl border border-border-default bg-surface-card p-6 space-y-5">
        {/* Secret input */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Secret Note
            <span className="ml-1.5 text-amber-400 font-normal text-xs">(64-char hex from deposit page)</span>
          </label>
          <div className="relative">
            <input
              type={showSec ? 'text' : 'password'}
              value={secret}
              onChange={e => { setStep({ id: 'idle' }); setSecret(e.target.value) }}
              disabled={busy}
              placeholder="Paste the 64-character secret (not the nullifier)..."
              className="w-full rounded-lg bg-slate-800/80 border border-border-default px-4 py-3
                         font-mono text-sm text-slate-100 placeholder-slate-500 pr-16
                         focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20
                         disabled:opacity-50 transition-all duration-200"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowSec(!showSec)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500
                         hover:text-slate-300 transition-colors select-none"
            >
              {showSec ? 'Hide' : 'Show'}
            </button>
          </div>
          {secret && !/^[0-9a-fA-F]{64}$/.test(secret) && (
            <p className="text-amber-400 text-xs mt-1.5 flex items-center gap-1">
              Must be exactly 64 hex characters. Make sure you copied the secret (not the nullifier).
            </p>
          )}
        </div>

        {/* Recipient input */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Recipient Address
            <span className="ml-1.5 text-slate-500 font-normal text-xs">(any Stellar address)</span>
          </label>
          <input
            type="text"
            value={recipient}
            onChange={e => { setStep({ id: 'idle' }); setRecipient(e.target.value) }}
            disabled={busy}
            placeholder="GABC..."
            className="w-full rounded-lg bg-slate-800/80 border border-border-default px-4 py-3
                       font-mono text-sm text-slate-100 placeholder-slate-500
                       focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20
                       disabled:opacity-50 transition-all duration-200"
            spellCheck={false}
          />
          {recipient && !isValidStellarAddr(recipient) && (
            <p className="text-amber-400 text-xs mt-1.5 flex items-center gap-1">
              Must start with G or C and be exactly 56 characters.
            </p>
          )}
        </div>

        {/* Loading pipeline */}
        {busy && (
          <div className="rounded-lg bg-slate-800/50 border border-border-default p-4 space-y-3 animate-scale-in">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{step.label}</span>
              <span>{step.progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-700 ease-out"
                style={{ width: `${step.progress}%` }}
              />
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-cyan-400 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
              <span className="text-xs text-cyan-400">Processing...</span>
            </div>
          </div>
        )}

        {/* Error */}
        {step.id === 'error' && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400 animate-slide-up-enter whitespace-pre-line">
            {step.message}
          </div>
        )}

        {/* Submit button */}
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={busy || !secret.trim() || !recipient.trim()}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 text-white font-semibold
                     hover:from-violet-400 hover:to-violet-500 transition-all duration-200
                     hover:shadow-lg hover:shadow-violet-500/20 active:scale-[0.98]
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
        >
          {busy ? 'Working...' : 'Generate Proof & Withdraw'}
        </button>
      </div>

      {/* Done state */}
      {step.id === 'done' && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6 space-y-4 animate-scale-in">
          <div className="flex items-center gap-2 text-green-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span className="text-sm font-semibold">Withdrawal confirmed</span>
          </div>

          <div className="rounded-lg bg-slate-900/50 border border-border-default p-3">
            <p className="text-xs text-slate-500 mb-1">Transaction</p>
            <a
              href={`${HORIZON_BASE}/${step.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-cyan-400 hover:text-cyan-300 transition-colors break-all"
            >
              {step.txHash}
            </a>
          </div>

          <p className="text-xs text-slate-500">
            Your nullifier has been recorded on-chain. This secret can no longer be used.
          </p>

          <button
            type="button"
            onClick={reset}
            className="w-full py-2.5 rounded-lg bg-slate-800/50 border border-border-default text-sm text-slate-300
                       hover:bg-slate-800 hover:border-border-hover transition-all duration-200"
          >
            Withdraw Another Note
          </button>
        </div>
      )}
    </div>
  )
}
