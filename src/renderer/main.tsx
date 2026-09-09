import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/index.css'
import './i18n'
import App from './App'

const isCard = (() => {
  try { return new URLSearchParams(window.location.search).get('card') === '1' } catch { return false }
})()

if (isCard) {
  document.documentElement.classList.add('rescard')
  document.body.classList.add('rescard-body')
}

const Root = isCard
  ? React.lazy(() => import('./pages/ResCard'))
  : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="splash-ring" style={{ width: 32, height: 32 }} /></div>}>
      <Root />
    </React.Suspense>
  </React.StrictMode>,
)
