import React from 'react'
import { AlertTriangle, RotateCcw, Copy } from 'lucide-react'
import i18n from '@/i18n'

interface Props {
  /** 'root' shows a full-window fallback; 'page' is contained inside the content area. */
  scope: 'root' | 'page'
  /** Changing this key resets the boundary (e.g. current page id). */
  resetKey?: string
  children: React.ReactNode
}
interface State { error: Error | null }

/**
 * Resilience layer: a crash inside one page must never blank the whole app.
 * Page-scoped boundaries reset automatically when the user navigates away.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Local-only observability: DragonHub never sends telemetry.
    console.error('[DragonHub] render error', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  private copy = () => {
    const e = this.state.error
    if (!e) return
    const text = `${e.name}: ${e.message}\n${e.stack ?? ''}`
    try { void navigator.clipboard?.writeText(text) } catch { /* best effort */ }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const t = (k: string) => i18n.t(k)
    const root = this.props.scope === 'root'
    return (
      <div role="alert" className={root ? 'h-screen w-screen flex items-center justify-center bg-surface-50 p-6' : 'h-full min-h-[320px] flex items-center justify-center p-6'}>
        <div className="surface-raised max-w-md w-full p-6 text-center">
          <div className="mx-auto mb-4 grid place-items-center h-12 w-12 rounded-2xl bg-rose-500/12 text-rose-500"><AlertTriangle size={22} /></div>
          <h2 className="text-base font-semibold">{t('errors.title')}</h2>
          <p className="mt-1 text-sm text-surface-600">{t('errors.desc')}</p>
          <pre className="mt-4 max-h-28 overflow-auto rounded-lg bg-surface-200/70 p-3 text-start text-[11px] font-mono text-surface-700 selectable">{error.message}</pre>
          <div className="mt-5 flex justify-center gap-2">
            <button className="btn-soft" onClick={this.copy}><Copy size={14} />{t('errors.copy')}</button>
            <button className="btn-primary" onClick={() => (root ? window.location.reload() : this.setState({ error: null }))}><RotateCcw size={14} />{t('common.retry')}</button>
          </div>
        </div>
      </div>
    )
  }
}
