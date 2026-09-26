import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/index.css'
import './i18n'
import { ErrorBoundary } from './components/ErrorBoundary'

const isCard = (() => {
  try { return new URLSearchParams(window.location.search).get('card') === '1' } catch { return false }
})()

if (isCard) {
  document.documentElement.classList.add('rescard')
  document.body.classList.add('rescard-body')
}

async function boot() {
  // DEV browser preview only: provide an in-memory bridge when running outside
  // Electron. Tree-shaken from production builds (import.meta.env.DEV === false).
  if (import.meta.env.DEV && !window.dh) {
    const { installDevBridge } = await import('./lib/devBridge')
    installDevBridge()
  }
  const Root = isCard
    ? React.lazy(() => import('./pages/ResCard'))
    : React.lazy(() => import('./App'))

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary scope="root">
        <React.Suspense fallback={null}>
          <Root />
        </React.Suspense>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

void boot()
