import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Catches unhandled React errors and displays a recovery UI instead of a
 * blank white screen.  Wrap the root <App> or individual routes.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  private handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center space-y-5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100 mb-1">Something went wrong</h2>
            <p className="text-sm text-slate-400">
              An unexpected error occurred. You can try continuing or reload the page.
            </p>
          </div>
          {this.state.error && (
            <pre className="text-xs text-red-400/70 bg-red-500/5 border border-red-500/10 rounded-lg p-3 text-left overflow-auto max-h-32 font-mono">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-5 py-2.5 rounded-xl text-sm font-medium border border-border-default text-slate-300 hover:bg-slate-800/50 transition-colors"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 hover:from-cyan-400 hover:to-cyan-500 transition-all"
            >
              Reload Page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
