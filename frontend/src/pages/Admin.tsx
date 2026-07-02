import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet'
import { addAspDenied, addAspMember, loadAspList, LS_DENIED, LS_MEMBERS, type AspEntry, type ProgressStep, validateCommitmentInput, formatStroopsAmount } from '../utils/asp'
import { useToast } from '../components/Toast'
import { useConfirm, ConfirmDialog } from '../components/ConfirmDialog'
import { CONTRACTS } from '../config'

type Tab = 'members' | 'denied'
type AspStatus = 'Active' | 'Withdrawn'

const STATUS_BADGE: Record<AspStatus, string> = {
  Active:    'bg-green-500/10 text-green-400 border-green-500/20',
  Withdrawn: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

function getAspStatus(commitment: string): AspStatus {
  if (localStorage.getItem(`nullhaven:spent:${commitment}`) === 'true') return 'Withdrawn'
  if (localStorage.getItem(`nullhaven:withdrawn:${commitment}`) === 'true') return 'Withdrawn'
  return 'Active'
}

export default function AdminPage() {
  const { publicKey, sign, isConnected } = useWallet()
  const { addToast } = useToast()
  const { confirm, dialog } = useConfirm()
  const [searchParams] = useSearchParams()
  const initialCommitment = searchParams.get('commitment')?.replace(/^0x/i, '').trim() ?? ''

  const [tab,      setTab]      = useState<Tab>('members')
  const [members,  setMembers]  = useState<AspEntry[]>(() => loadAspList(LS_MEMBERS))
  const [denied,   setDenied]   = useState<AspEntry[]>(() => loadAspList(LS_DENIED))
  const [input,    setInput]    = useState(initialCommitment)
  const [label,    setLabel]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [steps,    setSteps]    = useState<ProgressStep[]>([])
  const [actionLabel, setActionLabel] = useState('')

  // ── Add member
  const handleAddMember = useCallback(async () => {
    if (!input.trim() || !publicKey) return
    setLoading(true)
    setSteps([])
    setActionLabel('Validating input')
    try {
      const validation = await validateCommitmentInput(input, publicKey)
      let confirmed = false
      const finalCommitment = validation.commitment

      if (validation.kind === 'secret-derived') {
        const matchInfo = validation.depositMatch
          ? `Your deposit of ${formatStroopsAmount(validation.depositMatch.amount)} on ${validation.depositMatch.date.slice(0, 10)}.`
          : validation.fromOnChain ? 'This commitment exists in the pool.' : ''
        confirmed = await confirm({
          title: 'Secret Detected',
          message: `You pasted a secret, not a commitment.\n\nThe derived commitment is:\n${finalCommitment.slice(0, 32)}...\n\n${matchInfo}\n\nApprove this commitment instead?`,
          confirmLabel: 'Use Derived Commitment',
        })
      } else if (validation.kind === 'commitment') {
        const matchInfo = validation.depositMatch
          ? `Your deposit of ${formatStroopsAmount(validation.depositMatch.amount)} on ${validation.depositMatch.date.slice(0, 10)}.`
          : validation.fromOnChain ? 'This commitment exists in the pool.' : 'Not found in your local deposits — verify this is the correct commitment.'
        confirmed = await confirm({
          title: 'Approve Commitment',
          message: `Approve commitment ${finalCommitment.slice(0, 32)}...?\n\n${matchInfo}`,
          confirmLabel: 'Approve',
        })
      } else {
        confirmed = await confirm({
          title: 'Unrecognized Input',
          message: `This value is not recognized as a pool commitment.\n\nApproving it will add it to the allowlist, but it may not match any real deposit.\n\nProceed anyway?`,
          confirmLabel: 'Proceed Anyway',
          variant: 'danger',
        })
      }

      if (!confirmed) { setLoading(false); return }

      setActionLabel('Adding to Allowlist')
      const { commitment, root } = await addAspMember(publicKey, finalCommitment, label.trim() || 'unlabelled', sign, (step, status) => {
        setSteps(prev => {
          const existing = prev.findIndex(s => s.label === step)
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = { label: step, status }
            return updated
          }
          return [...prev, { label: step, status }]
        })
      })
      setMembers(loadAspList(LS_MEMBERS))
      setInput(''); setLabel('')
      addToast('success', `ASP root updated: 0x${root.slice(0, 16)}... Commitment ${commitment.slice(0, 12)}... approved.`)
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to add member')
    } finally {
      setLoading(false)
    }
  }, [input, label, publicKey, sign, addToast, confirm])

  // ── Remove member (with confirmation)
  const handleRemoveMember = useCallback(async (commitment: string) => {
    const confirmed = await confirm({
      title: 'Remove from Allowlist',
      message: `Remove commitment ${commitment.slice(0, 16)}... from the ASP allowlist? You will need to re-add and re-sync the root for future withdrawals.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    })
    if (!confirmed) return

    setLoading(true)
    setSteps([])
    setActionLabel('Removing from Allowlist')
    try {
      const onProgress = (step: string, status: 'active' | 'done') => {
        setSteps(prev => {
          const existing = prev.findIndex(s => s.label === step)
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = { label: step, status }
            return updated
          }
          return [...prev, { label: step, status }]
        })
      }

      // Remove on-chain only if actually present (localStorage can drift)
      const { isAspMember } = await import('../utils/asp')
      const { normalizeHex } = await import('../lib/stellar-rpc')
      const normCommitment = normalizeHex(commitment)
      const isOnChain = await isAspMember(publicKey!, normCommitment)

      if (isOnChain) {
        onProgress('Removing from ASP allowlist — confirm in wallet', 'active')
        const { Contract, Address, nativeToScVal } = await import('@stellar/stellar-sdk')
        const { bytesVal, buildAndSubmit } = await import('../lib/stellar-rpc')
        const aspOp = new Contract(CONTRACTS.asp).call(
          'remove_member',
          nativeToScVal(Address.fromString(publicKey!), { type: 'address' }),
          bytesVal(normCommitment),
        )
        await buildAndSubmit(publicKey!, aspOp, sign!, 30)
        onProgress('Removing from ASP allowlist — confirm in wallet', 'done')
      } else {
        onProgress('Commitment not on-chain — cleaning local state', 'done')
      }

      // Re-sync ASP root with remaining members
      const remaining = members.filter((m) => m.commitment !== commitment)
      if (remaining.length > 0) {
        const { syncAspRoot } = await import('../utils/asp')
        await syncAspRoot(publicKey!, remaining, sign!, onProgress)
      }

      // Update local state
      setMembers(remaining)
      localStorage.setItem(LS_MEMBERS, JSON.stringify(remaining))
      localStorage.removeItem(`nullhaven:asp:path:${commitment}`)
      addToast('success', `Commitment ${commitment.slice(0, 12)}... removed from allowlist.`)
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to remove member')
    } finally {
      setLoading(false)
    }
  }, [members, publicKey, sign, confirm, addToast])

  // ── Remove from denylist
  const handleRemoveDenied = useCallback(async (commitment: string) => {
    const confirmed = await confirm({
      title: 'Remove from Denylist',
      message: `Remove commitment ${commitment.slice(0, 16)}... from the ASP denylist? This will allow the commitment to withdraw again.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    })
    if (!confirmed) return

    setLoading(true)
    setSteps([])
    setActionLabel('Removing from Denylist')
    try {
      const onProgress = (step: string, status: 'active' | 'done') => {
        setSteps(prev => {
          const existing = prev.findIndex(s => s.label === step)
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = { label: step, status }
            return updated
          }
          return [...prev, { label: step, status }]
        })
      }

      // Check if actually on-chain before calling remove
      const { isAspDenied } = await import('../utils/asp')
      const normCommitment = commitment.replace(/^0x/i, '').padStart(64, '0').toLowerCase()
      const isDeniedOnChain = await isAspDenied(publicKey!, normCommitment)

      if (isDeniedOnChain) {
        onProgress('Removing from ASP denylist — confirm in wallet', 'active')
        const { Contract, Address, nativeToScVal } = await import('@stellar/stellar-sdk')
        const { bytesVal, buildAndSubmit, normalizeHex } = await import('../lib/stellar-rpc')
        const aspOp = new Contract(CONTRACTS.asp).call(
          'remove_denied',
          nativeToScVal(Address.fromString(publicKey!), { type: 'address' }),
          bytesVal(normalizeHex(commitment)),
        )
        await buildAndSubmit(publicKey!, aspOp, sign!, 30)
        onProgress('Removing from ASP denylist — confirm in wallet', 'done')
      }

      // Re-sync ASP root with remaining members
      const remainingMembers = loadAspList(LS_MEMBERS)
      if (remainingMembers.length > 0) {
        onProgress('Re-syncing ASP root — confirm in wallet', 'active')
        const { syncAspRoot } = await import('../utils/asp')
        await syncAspRoot(publicKey!, remainingMembers, sign!, onProgress)
      }

      // Update local state
      const updated = denied.filter((d) => d.commitment !== commitment)
      setDenied(updated)
      localStorage.setItem(LS_DENIED, JSON.stringify(updated))
      setMembers(loadAspList(LS_MEMBERS))
      addToast('success', `Commitment ${commitment.slice(0, 12)}... removed from denylist.`)
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to remove from denylist')
    } finally {
      setLoading(false)
    }
  }, [denied, publicKey, sign, confirm, addToast])

  // ── Add to denylist
  const handleAddDenied = useCallback(async () => {
    if (!input.trim() || !publicKey) return
    setLoading(true)
    setSteps([])
    setActionLabel('Validating input')
    try {
      const validation = await validateCommitmentInput(input, publicKey)
      let confirmed = false
      const finalCommitment = validation.commitment

      if (validation.kind === 'secret-derived') {
        const matchInfo = validation.depositMatch
          ? `Your deposit of ${formatStroopsAmount(validation.depositMatch.amount)} on ${validation.depositMatch.date.slice(0, 10)}.`
          : validation.fromOnChain ? 'This commitment exists in the pool.' : ''
        confirmed = await confirm({
          title: 'Secret Detected',
          message: `You pasted a secret, not a commitment.\n\nThe derived commitment is:\n${finalCommitment.slice(0, 32)}...\n\n${matchInfo}\n\nDeny this commitment instead?`,
          confirmLabel: 'Use Derived Commitment',
        })
      } else if (validation.kind === 'commitment') {
        const matchInfo = validation.depositMatch
          ? `Your deposit of ${formatStroopsAmount(validation.depositMatch.amount)} on ${validation.depositMatch.date.slice(0, 10)}.`
          : validation.fromOnChain ? 'This commitment exists in the pool.' : 'Not found in your local deposits — verify this is the correct commitment.'
        confirmed = await confirm({
          title: 'Deny Commitment',
          message: `Deny commitment ${finalCommitment.slice(0, 32)}...?\n\n${matchInfo}`,
          confirmLabel: 'Deny',
          variant: 'danger',
        })
      } else {
        confirmed = await confirm({
          title: 'Unrecognized Input',
          message: `This value is not recognized as a pool commitment.\n\nIf it's not a real commitment, denying it will have no effect.\n\nProceed anyway?`,
          confirmLabel: 'Proceed Anyway',
          variant: 'danger',
        })
      }

      if (!confirmed) { setLoading(false); return }

      setActionLabel('Adding to Denylist')
      const { commitment, root } = await addAspDenied(publicKey, finalCommitment, label.trim() || 'blocked', sign, (step, status) => {
        setSteps(prev => {
          const existing = prev.findIndex(s => s.label === step)
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = { label: step, status }
            return updated
          }
          return [...prev, { label: step, status }]
        })
      })
      setMembers(loadAspList(LS_MEMBERS))
      setDenied(loadAspList(LS_DENIED))
      setInput(''); setLabel('')
      addToast('success', root
        ? `Blocked on-chain. Allowlist root resynced: 0x${root.slice(0, 16)}...`
        : `Blocked on-chain. Allowlist is now empty.`)
      addToast('info', `Commitment ${commitment.slice(0, 12)}... is now denied and cannot withdraw.`)
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to add to denylist')
    } finally {
      setLoading(false)
    }
  }, [input, label, publicKey, sign, addToast, confirm])

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto pt-20 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-slate-800/50 border border-border-default flex items-center justify-center">
          <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
          </svg>
        </div>
        <p className="text-slate-400">Connect your wallet to access the ASP Admin panel.</p>
      </div>
    )
  }

  const list     = tab === 'members'
    ? [...members].sort((a, b) => {
        const sa = getAspStatus(a.commitment)
        const sb = getAspStatus(b.commitment)
        if (sa === sb) return 0
        return sa === 'Active' ? -1 : 1
      })
    : denied
  const addFn    = tab === 'members' ? handleAddMember : handleAddDenied
  const addLabel = tab === 'members' ? 'Add to Allowlist' : 'Add to Denylist'
  const isAllow  = tab === 'members'

  return (
    <>
      <ConfirmDialog dialog={dialog} />
      <div className="max-w-2xl mx-auto space-y-6 animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-100">ASP Admin</h1>
          </div>
          <code className="text-xs font-mono text-slate-500 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-border-default">
            {publicKey?.slice(0, 8)}...{publicKey?.slice(-4)}
          </code>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 bg-slate-800/50 rounded-xl p-1 border border-border-default">
          {(['members', 'denied'] as Tab[]).map((t) => {
            const active = tab === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`relative flex-1 px-4 py-2.5 text-sm font-medium capitalize rounded-lg transition-all duration-200 ${
                  active
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {active && (
                  <span className={`absolute inset-0 rounded-lg ${isAllow ? 'bg-cyan-500/15 border border-cyan-500/30' : 'bg-red-500/15 border border-red-500/30'} transition-all duration-200`} />
                )}
                <span className="relative z-10">
                  {t === 'members' ? `Allowlist (${members.length})` : `Denylist (${denied.length})`}
                </span>
              </button>
            )
          })}
        </div>

        {/* Add input card */}
        <div className="rounded-xl border border-border-default bg-surface-card p-5 space-y-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="Commitment hash (64-char hex)"
            className="w-full rounded-lg bg-slate-800/80 border border-border-default px-4 py-3
                       font-mono text-sm text-slate-100 placeholder-slate-500
                       focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20
                       disabled:opacity-50 transition-all duration-200"
            spellCheck={false}
          />
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={loading}
            placeholder="Label (optional)"
            className="w-full rounded-lg bg-slate-800/80 border border-border-default px-4 py-3
                       text-sm text-slate-100 placeholder-slate-500
                       focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20
                       disabled:opacity-50 transition-all duration-200"
          />
          <button
            type="button"
            onClick={addFn}
            disabled={loading || !input.trim()}
            className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200
                       disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]
                       ${isAllow
                         ? 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950 hover:shadow-lg hover:shadow-cyan-500/20'
                         : 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white hover:shadow-lg hover:shadow-red-500/20'
                       }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
                Processing...
              </span>
            ) : addLabel}
          </button>

          {/* Step-by-step progress */}
          {loading && steps.length > 0 && (
            <div className="rounded-lg bg-slate-800/50 border border-border-default p-4 space-y-2 animate-fade-in-up">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">{actionLabel}</p>
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                    step.status === 'done'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : step.status === 'active'
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 animate-pulse'
                        : 'bg-slate-700 text-slate-500 border border-slate-600'
                  }`}>
                    {step.status === 'done' ? (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : step.status === 'active' ? (
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="3" strokeDasharray="18 18" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <span className="text-[10px] font-bold">{i + 1}</span>
                    )}
                  </div>
                  <span className={`text-xs ${
                    step.status === 'done' ? 'text-green-400' : step.status === 'active' ? 'text-cyan-300' : 'text-slate-500'
                  }`}>
                    {step.label}
                    {step.status === 'active' && (
                      <span className="ml-1.5 text-cyan-400/70">— confirm in Freighter</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* List */}
        <div className="space-y-2">
          {list.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500 text-sm">No entries yet.</p>
              <p className="text-slate-600 text-xs mt-1">
                Add a commitment hash to the {isAllow ? 'allowlist' : 'denylist'} above.
              </p>
            </div>
          ) : (
            list.map((entry, i) => {
              const status = isAllow ? getAspStatus(entry.commitment) : null
              return (
                <div
                  key={entry.commitment}
                  className="flex items-center justify-between rounded-xl bg-surface-card border border-border-default px-5 py-4
                             hover:border-border-hover transition-all duration-200 card-glow animate-fade-in-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm text-slate-300 truncate">{entry.commitment}</p>
                      {status && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_BADGE[status]}`}>
                          {status}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {entry.label} &middot; {entry.addedAt.slice(0, 10)}
                    </p>
                  </div>
                  {isAllow && (
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(entry.commitment)}
                      disabled={loading}
                      className="ml-4 shrink-0 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10
                                 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                  {!isAllow && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDenied(entry.commitment)}
                      disabled={loading}
                      className="ml-4 shrink-0 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10
                                 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
