import { Link } from 'react-router-dom'

const FEATURES = [
  {
    title: 'Private Payments',
    desc: 'Deposit tokens into the shielded pool and withdraw to any address. ZK proofs keep your transactions private.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
  {
    title: 'ASP Compliance',
    desc: 'Association Set Providers manage allow/deny lists. Bad actors are blocked while legitimate users stay private.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    title: 'Auditor Access',
    desc: 'Authorized auditors can reconstruct transaction details via encrypted view keys — privacy with accountability.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
    ),
  },
  {
    title: 'Stellar Native',
    desc: 'Built on Soroban using Protocol 25+ BN254 host functions. Low fees, fast finality, real-world ready.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
      </svg>
    ),
  },
]

const STEPS = [
  { num: '1', title: 'Generate', desc: 'Create a secret commitment and nullifier off-chain using Poseidon hashes' },
  { num: '2', title: 'Deposit', desc: 'Send a fixed-denomination note to the pool — your commitment is recorded on-chain' },
  { num: '3', title: 'Prove', desc: 'Generate a Groth16 ZK proof that you own a valid, unspent deposit' },
  { num: '4', title: 'Withdraw', desc: 'Submit the proof and receive tokens at any address — no on-chain link to the deposit' },
]

export default function Home() {
  return (
    <div className="space-y-24 pb-8">
      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="text-center pt-12 pb-8">
        {/* Accent ring */}
        <div className="relative mx-auto mb-10 w-24 h-24">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400/20 to-violet-400/20 animate-pulse-glow" />
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-cyan-400/10 to-violet-400/10 backdrop-blur" />
          <div className="absolute inset-0 rounded-full border border-cyan-400/20 animate-pulse-ring" />
          <svg className="absolute inset-0 w-full h-full p-5 text-cyan-400" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
          </svg>
        </div>

        <p className="inline-flex mb-5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
          ZK privacy pool cockpit
        </p>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6">
          <span className="gradient-text">NullHaven</span>
        </h1>

        <p className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          A user-friendly Stellar privacy cockpit: shield funds, track wallet balance,
          <br className="hidden sm:block" /> and manage compliant withdrawal readiness without losing the plot.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link
            to="/deposit"
            className="group relative px-8 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 font-semibold text-base hover:from-cyan-400 hover:to-cyan-500 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-500/25 active:scale-[0.98]"
          >
            <span className="relative z-10">Start Depositing</span>
          </Link>
          <Link
            to="/admin"
            className="px-8 py-3.5 rounded-xl border border-border-default text-slate-300 font-semibold text-base hover:bg-slate-800/50 hover:border-border-hover transition-all duration-200 active:scale-[0.98]"
          >
            ASP Dashboard
          </Link>
        </div>
      </section>

      {/* ── Features grid ───────────────────────────────────── */}
      <section>
        <div className="text-center mb-12">
          <p className="text-xs font-semibold tracking-widest text-cyan-400 uppercase mb-3">Why NullHaven</p>
          <h2 className="text-3xl font-bold text-slate-100">Privacy without compromise</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {FEATURES.map(({ title, desc, icon }, i) => (
            <div
              key={title}
              className="group rounded-2xl border border-border-default bg-surface-card p-7 card-glow hover:-translate-y-0.5 transition-all duration-300"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="mb-4 text-cyan-400 group-hover:text-cyan-300 transition-colors duration-200">
                {icon}
              </div>
              <h3 className="text-lg font-semibold text-slate-100 mb-2">{title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────── */}
      <section>
        <div className="text-center mb-12">
          <p className="text-xs font-semibold tracking-widest text-violet-400 uppercase mb-3">How it works</p>
          <h2 className="text-3xl font-bold text-slate-100">Four steps to privacy</h2>
        </div>
        <div className="relative">
          {/* Connecting line (desktop) */}
          <div className="hidden md:block absolute top-10 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-500/0 via-cyan-500/30 to-cyan-500/0" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {STEPS.map(({ num, title, desc }, i) => (
              <div
                key={num}
                className="relative text-center group"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                {/* Step number circle */}
                <div className="relative z-10 mx-auto mb-5 w-16 h-16 rounded-2xl bg-surface-card border border-border-default flex items-center justify-center group-hover:border-cyan-500/30 group-hover:shadow-lg group-hover:shadow-cyan-500/5 transition-all duration-300">
                  <span className="text-xl font-bold gradient-text">{num}</span>
                </div>
                <h4 className="text-sm font-semibold text-slate-200 mb-2">{title}</h4>
                <p className="text-xs text-slate-500 leading-relaxed max-w-[200px] mx-auto">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ──────────────────────────────────────── */}
      <section className="rounded-2xl border border-border-default bg-gradient-to-br from-surface-card to-slate-900 p-10 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-violet-500/5" />
        <div className="relative z-10">
          <h2 className="text-2xl font-bold text-slate-100 mb-3">Ready to transact privately?</h2>
          <p className="text-slate-400 mb-7 max-w-lg mx-auto">
            Connect your Freighter wallet and start using the first compliant privacy pool on Stellar testnet.
          </p>
          <Link
            to="/deposit"
            className="inline-block px-8 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 font-semibold hover:from-cyan-400 hover:to-cyan-500 transition-all duration-200 hover:shadow-lg hover:shadow-cyan-500/25 active:scale-[0.98]"
          >
            Get Started
          </Link>
        </div>
      </section>
    </div>
  )
}
