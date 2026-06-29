import { useState, useEffect } from 'react'
import { CONTRACTS } from '../config'
import { simulateCall } from '../lib/stellar-rpc'
import { useWallet } from '../hooks/useWallet'

interface DepositRecord {
  commitment: string
  txHash:     string
  date:       string
}

interface Stats {
  poolSize:     number | null
  memberCount:  number | null
  deniedCount:  number | null
  loading:      boolean
}

const BADGE: Record<string, string> = {
  Active:    'bg-green-500/10 text-green-400 border-green-500/20',
  Withdrawn: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

async function readU32(source: string, contractId: string, method: string): Promise<number | null> {
  if (!contractId || !source) return null
  const val = await simulateCall(source, contractId, method)
  if (!val) return null
  const raw = val.value()
  return typeof raw === 'number' ? raw : typeof raw === 'bigint' ? Number(raw) : null
}

function loadDeposits(publicKey: string | null): DepositRecord[] {
  if (!publicKey) return []
  try {
    return JSON.parse(localStorage.getItem(`nullhaven:deposits:${publicKey}`) ?? '[]') as DepositRecord[]
  } catch { return [] }
}

export default function DashboardPage() {
  const { publicKey } = useWallet()

  const [stats,    setStats]    = useState<Stats>({ poolSize: null, memberCount: null, deniedCount: null, loading: true })
  const [deposits, setDeposits] = useState<DepositRecord[]>(() => loadDeposits(publicKey))
  const [confirmClear, setConfirmClear] = useState(false)

  // Re-load deposits from localStorage when publicKey becomes available or changes
  useEffect(() => {
    setDeposits(loadDeposits(publicKey))
  }, [publicKey])

  // Fetch on-chain stats
  useEffect(() => {
    if (!publicKey) {
      queueMicrotask(() => setStats((s) => ({ ...s, loading: false })))
      return
    }
    if (!CONTRACTS.pool && !CONTRACTS.asp) {
      queueMicrotask(() => setStats((s) => ({ ...s, loading: false })))
      return
    }
    ;(async () => {
      setStats((s) => ({ ...s, loading: true }))
      const [poolSize, memberCount, deniedCount] = await Promise.all([
        readU32(publicKey, CONTRACTS.pool, 'next_idx'),
        readU32(publicKey, CONTRACTS.asp,  'member_count'),
        readU32(publicKey, CONTRACTS.asp,  'denied_count'),
      ])
      setStats({ poolSize, memberCount, deniedCount, loading: false })
    })()
  }, [publicKey])

  const isWithdrawn = (commitment: string) =>
    localStorage.getItem(`nullhaven:withdrawn:${commitment}`) === 'true'

  const isSpent = (commitment: string) =>
    localStorage.getItem(`nullhaven:spent:${commitment}`) === 'true'

  const removeDeposit = (commitment: string) => {
    const updated = deposits.filter(d => d.commitment !== commitment)
    setDeposits(updated)
    localStorage.setItem(`nullhaven:deposits:${publicKey}`, JSON.stringify(updated))
    localStorage.removeItem(`nullhaven:withdrawn:${commitment}`)
    localStorage.removeItem(`nullhaven:spent:${commitment}`)
  }

  const clearAllDeposits = () => {
    for (const d of deposits) {
      localStorage.removeItem(`nullhaven:withdrawn:${d.commitment}`)
      localStorage.removeItem(`nullhaven:spent:${d.commitment}`)
      localStorage.removeItem(`nullhaven:asp:path:${d.commitment}`)
    }
    setDeposits([])
    localStorage.setItem(`nullhaven:deposits:${publicKey}`, '[]')
    setConfirmClear(false)
  }

  const statItems = [
    { label: 'Total Deposits', value: stats.poolSize,    icon: '↑', color: 'cyan'   },
    { label: 'ASP Approved',   value: stats.memberCount, icon: '✓', color: 'green'  },
    { label: 'ASP Denied',     value: stats.deniedCount, icon: '✕', color: 'red'    },
  ] as const

  const colorMap: Record<string, string> = {
    cyan:  'border-cyan-500/20 bg-cyan-500/5',
    green: 'border-green-500/20 bg-green-500/5',
    red:   'border-red-500/20 bg-red-500/5',
  }
  const iconColorMap: Record<string, string> = {
    cyan:  'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    red:   'bg-red-500/10 text-red-400 border-red-500/20',
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-xs text-slate-500">Pool statistics and your deposits</p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statItems.map(({ label, value, icon, color }, i) => (
          <div
            key={label}
            className={`rounded-xl border ${colorMap[color]} p-5 card-glow animate-fade-in-up`}
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</span>
              <span className={`w-7 h-7 rounded-lg border ${iconColorMap[color]} flex items-center justify-center text-xs font-bold`}>
                {icon}
              </span>
            </div>
            {stats.loading ? (
              <div className="skeleton h-9 w-20" />
            ) : (
              <p className="text-3xl font-bold text-slate-100 animate-count-up">
                {value !== null ? value.toLocaleString() : '—'}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Warning if contracts not configured */}
      {!CONTRACTS.pool && !stats.loading && (
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 p-4 text-sm text-amber-400 flex items-start gap-3 animate-scale-in">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div>
            <p className="font-medium mb-0.5">Contracts not configured</p>
            <p className="text-amber-400/70">
              Add your contract addresses to <code className="font-mono text-xs bg-amber-500/10 px-1.5 py-0.5 rounded">.env</code> and restart to see live on-chain data.
            </p>
          </div>
        </div>
      )}

      {/* Deposits table */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-200">Your Deposits</h2>
          {deposits.length > 0 && (
            confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-400">Clear all {deposits.length} deposits?</span>
                <button
                  type="button"
                  onClick={clearAllDeposits}
                  className="text-xs px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 border border-border-default text-slate-400 hover:text-slate-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-800/50 border border-border-default text-slate-400 hover:text-red-400 hover:border-red-500/20 transition-colors"
              >
                Clear All
              </button>
            )
          )}
        </div>
        {!publicKey ? (
          <div className="rounded-xl border border-border-default bg-surface-card p-8 text-center">
            <svg className="w-8 h-8 mx-auto mb-3 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <p className="text-sm text-slate-500">Connect your wallet to view your deposits.</p>
          </div>
        ) : deposits.length === 0 ? (
          <div className="rounded-xl border border-border-default bg-surface-card p-8 text-center">
            <svg className="w-8 h-8 mx-auto mb-3 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125 2.25 2.25m0 0 2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
            </svg>
            <p className="text-sm text-slate-500">No deposits found for this wallet on this device.</p>
            <p className="text-xs text-slate-600 mt-1">
              Deposits are stored locally. Make a deposit to see it here.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border-default overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/60 text-slate-400 text-xs font-medium">
                  <th className="px-5 py-3.5 text-left">Commitment</th>
                  <th className="px-5 py-3.5 text-left hidden sm:table-cell">Date</th>
                  <th className="px-5 py-3.5 text-left">Status</th>
                  <th className="px-5 py-3.5 text-left">Tx</th>
                  <th className="px-5 py-3.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {deposits.map((d, i) => {
                  const status = (isSpent(d.commitment) || isWithdrawn(d.commitment)) ? 'Withdrawn' : 'Active'
                  return (
                    <tr
                      key={d.commitment}
                      className="bg-surface-card hover:bg-slate-800/40 transition-colors animate-fade-in-up"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <td className="px-5 py-3.5">
                        <code className="font-mono text-xs text-slate-300">{d.commitment.slice(0, 16)}...</code>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell text-xs">
                        {d.date.slice(0, 10)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${BADGE[status] ?? BADGE.Active}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusDot(status)}`} />
                          {status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${d.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-cyan-400 hover:text-cyan-300 transition-colors hover:underline"
                        >
                          {d.txHash.slice(0, 10)}...
                        </a>
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          type="button"
                          onClick={() => removeDeposit(d.commitment)}
                          className="text-slate-600 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10"
                          title="Remove from dashboard"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function statusDot(status: string): string {
  if (status === 'Active') return 'bg-green-400'
  return 'bg-slate-400'
}
