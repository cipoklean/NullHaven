import { Outlet, Link, useLocation } from 'react-router-dom'
import WalletButton from './WalletButton'

const NAV = [
  { path: '/',          label: 'Home'       },
  { path: '/deposit',   label: 'Deposit'    },
  { path: '/withdraw',  label: 'Withdraw'   },
  { path: '/dashboard', label: 'Dashboard'  },
  { path: '/admin',     label: 'ASP Admin'  },
]

export default function Layout() {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-surface text-slate-100 antialiased relative overflow-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_34%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_32%),linear-gradient(180deg,#07111f_0%,#0b0f19_55%,#05070c_100%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.06] bg-[linear-gradient(rgba(255,255,255,0.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.8)_1px,transparent_1px)] bg-[size:56px_56px]" />
      {/* ── Nav bar ─────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 glass border-b border-emerald-500/10">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo + nav links */}
            <div className="flex items-center gap-10">
              <Link
                to="/"
                className="text-xl font-black tracking-tight gradient-text select-none"
              >
                NullHaven<span className="text-emerald-300">.</span>
              </Link>

              <div className="hidden md:flex items-center gap-0.5">
                {NAV.map(({ path, label }) => {
                  const active = pathname === path
                  return (
                    <Link
                      key={path}
                      to={path}
                      className={`relative px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                        active
                          ? 'text-cyan-300'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      {label}
                      {active && (
                        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-gradient-to-r from-cyan-400 to-violet-400 rounded-full" />
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-4">
              {/* Mobile nav condensed */}
              <div className="md:hidden flex items-center gap-1">
                {NAV.filter(n => n.path !== '/').map(({ path, label }) => (
                  <Link
                    key={path}
                    to={path}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      pathname === path
                        ? 'bg-cyan-500/10 text-cyan-400'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </div>
              <WalletButton />
            </div>
          </div>
        </div>
      </nav>

      {/* ── Page content with staggered entry ────────────────── */}
      <main className="max-w-6xl mx-auto px-6 lg:px-8 py-10 animate-fade-in-up">
        <Outlet />
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-border-default py-8 mt-16">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 text-center text-xs text-slate-600">
          NullHaven &mdash; Compliant Privacy Pools on Stellar
        </div>
      </footer>
    </div>
  )
}
