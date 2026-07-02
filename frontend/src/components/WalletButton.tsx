import { useWallet } from '../hooks/useWallet'
import { formatBalance } from '../utils/format'

export default function WalletButton() {
  const { publicKey, loading, error, balance, connectWallet, disconnectWallet, isConnected } = useWallet()

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/50 border border-border-default">
        <div className="w-4 h-4 rounded-full border-2 border-slate-500 border-t-transparent animate-spin" />
        <span className="text-sm text-slate-400">Connecting…</span>
      </div>
    )
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        {balance && (
          <div className="hidden sm:flex flex-col items-end leading-none">
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Balance</span>
            <span className="text-sm font-semibold text-emerald-300">{formatBalance(balance)} XLM</span>
          </div>
        )}
        {/* Network badge */}
        <span className="text-xs font-mono tracking-wider px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
          TESTNET
        </span>
        {/* Address pill */}
        <button
          type="button"
          onClick={disconnectWallet}
          title="Disconnect wallet"
          className="group flex items-center gap-2.5 px-4 py-2 rounded-xl
                     bg-slate-800/50 border border-border-default hover:border-border-hover
                     transition-all duration-200 card-glow"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500 ring-1 ring-green-500/30" />
          </span>
          <span className="text-sm font-mono text-slate-300">
            {publicKey?.slice(0, 6)}…{publicKey?.slice(-4)}
          </span>
          <svg className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={connectWallet}
        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-950
                   bg-gradient-to-r from-cyan-400 to-cyan-500
                   hover:from-cyan-300 hover:to-cyan-400 hover:shadow-lg hover:shadow-cyan-500/20
                   active:scale-[0.98] transition-all duration-200"
      >
        Connect Wallet
      </button>
      {error && (
        <p className="text-xs text-red-400 max-w-64 text-right leading-tight animate-slide-up-enter">{error}</p>
      )}
    </div>
  )
}
