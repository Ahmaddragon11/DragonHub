import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import '@/i18n'
import { invoke, on } from '@/lib/api'
import { Ring } from '@/components/ui'
import type { ResLive, ResProcess, ResCardConfig } from '@shared/types'

function formatSpeed(bps: number): string {
  if (!isFinite(bps) || bps <= 0) return '0 B/s'
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`
}

export default function ResCard() {
  const { t, i18n } = useTranslation()
  const [snap, setSnap] = useState<ResLive | null>(null)
  const [top, setTop] = useState<string>('')
  const [cfg, setCfg] = useState<ResCardConfig>({ size: 'medium', opacity: 0.95, locked: false, x: null, y: null, showTopProcess: true })
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      invoke<ResLive>('res:snapshot').catch(() => null),
      invoke<ResCardConfig>('res:card:get').catch(() => null),
      invoke<ResProcess[]>('res:processes', 5).catch(() => []),
    ]).then(([s, c, p]) => {
      if (!alive) return
      if (s) setSnap(s)
      if (c) {
        setCfg(c)
        try { if (c.opacity) document.getElementById('rescard-root')?.style.setProperty('opacity', String(c.opacity)) } catch { /* ignore */ }
      }
      if (Array.isArray(p) && p.length > 0) setTop(p[0].displayName || p[0].name)
    })
    // Card inherits main language setting via settings store file? Fall back to navigator.
    try {
      const nav = navigator.language?.startsWith('ar') ? 'ar' : 'en'
      void i18n.changeLanguage(nav)
      invoke<{ language?: string }>('settings:get').then((s) => {
        if (s && (s.language === 'ar' || s.language === 'en')) void i18n.changeLanguage(s.language)
      }).catch(() => {})
    } catch { /* ignore */ }
    const off = on<ResLive>('res:update', (s) => { if (s && alive) setSnap(s) })
    const id = setInterval(() => {
      invoke<ResProcess[]>('res:processes', 5).then((p) => {
        if (alive && Array.isArray(p) && p.length > 0) setTop(p[0].displayName || p[0].name)
      }).catch(() => {})
    }, 5000)
    return () => { alive = false; clearInterval(id); off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patch = async (p: Partial<ResCardConfig>) => {
    const prev = cfg
    const next = { ...cfg, ...p }
    setCfg(next)
    try {
      if (p.opacity !== undefined) document.getElementById('rescard-root')?.style.setProperty('opacity', String(p.opacity))
      const saved = await invoke<ResCardConfig>('res:card:set', next)
      setCfg(saved)
    } catch { setCfg(prev) }
  }

  const small = cfg.size === 'small'
  const disk = snap?.disks?.[0]
  const diskPct = disk && disk.totalGB > 0 ? ((disk.totalGB - disk.freeGB) / disk.totalGB) * 100 : 0

  return (
    <div
      id="rescard-root"
      className="h-screen w-screen overflow-hidden rounded-2xl glass"
      style={{ opacity: cfg.opacity }}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
      onMouseDown={(e) => { if (menu && (e.target as HTMLElement).closest('[data-menu]') === null) setMenu(null) }}
    >
      {/* drag strip */}
      <div
        className="flex items-center gap-2 px-3 pt-2 pb-1 select-none"
        style={{ WebkitAppRegion: cfg.locked ? 'no-drag' : 'drag' } as unknown as React.CSSProperties}
      >
        <span className="text-[11px] font-bold gradient-text">DragonHub</span>
        <span className="flex-1" />
        <span className="text-[10px] opacity-50 font-mono" dir="ltr">{snap ? `${snap.cpuPercent.toFixed(0)}%` : '…'}</span>
      </div>

      <div className="flex items-center justify-around px-3" style={{ WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties}>
        <div className="flex flex-col items-center">
          <Ring value={snap?.cpuPercent ?? 0} size={small ? 64 : 76} stroke={8}>
            <span className="text-sm font-bold font-mono" dir="ltr">{snap ? `${snap.cpuPercent.toFixed(0)}%` : '—'}</span>
          </Ring>
          <span className="text-[10px] opacity-60">{t('res.cpu')}</span>
        </div>
        <div className="flex flex-col items-center">
          <Ring value={snap?.memoryPercent ?? 0} size={small ? 64 : 76} stroke={8}>
            <span className="text-sm font-bold font-mono" dir="ltr">{snap ? `${snap.memoryPercent.toFixed(0)}%` : '—'}</span>
          </Ring>
          <span className="text-[10px] opacity-60">{t('res.ram')}</span>
        </div>
        <div className="flex flex-col gap-1 text-[11px] font-mono min-w-[92px]" dir="ltr">
          <span title={t('net.down')}>↓ {formatSpeed(snap?.netDownSpeedBps ?? 0)}</span>
          <span title={t('net.up')}>↑ {formatSpeed(snap?.netUpSpeedBps ?? 0)}</span>
          {!small && <span title={t('res.disk')}>⛁ {disk ? `${disk.letter} ${diskPct.toFixed(0)}%` : '—'}</span>}
        </div>
      </div>

      {!small && cfg.showTopProcess && (
        <div className="px-3 pb-2 pt-1 text-[11px] truncate opacity-70" title={top}>
          ▲ {top || '…'}
        </div>
      )}

      {menu && (
        <div data-menu className="fixed z-50 card p-1.5 min-w-[190px] max-w-[min(232px,calc(100vw-16px))] max-h-[calc(100vh-16px)] overflow-y-auto text-xs" style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - Math.min(232, window.innerWidth - 16) - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - Math.min(340, window.innerHeight - 16) - 8)) }}>
          <button className="w-full text-start px-3 py-1.5 rounded-lg hover:bg-surface-200" onClick={() => { void patch({ locked: !cfg.locked }); setMenu(null) }}>
            {cfg.locked ? `🔓 ${t('resCard.unlock')}` : `🔒 ${t('resCard.lock')}`}
          </button>
          <button className="w-full text-start px-3 py-1.5 rounded-lg hover:bg-surface-200" onClick={() => { void patch({ size: small ? 'medium' : 'small' }); setMenu(null) }}>
            {small ? `⤢ ${t('resCard.toMedium')}` : `⤡ ${t('resCard.toSmall')}`}
          </button>
          <button className="w-full text-start px-3 py-1.5 rounded-lg hover:bg-surface-200" onClick={() => { void patch({ showTopProcess: !cfg.showTopProcess }); setMenu(null) }}>
            {cfg.showTopProcess ? `☰ ${t('resCard.hideTop')}` : `☰ ${t('resCard.showTop')}`}
          </button>
          {[0.6, 0.8, 0.95, 1].map((o) => (
            <button key={o} className="w-full text-start px-3 py-1.5 rounded-lg hover:bg-surface-200 font-mono" onClick={() => { void patch({ opacity: o }); setMenu(null) }}>
              ◐ {t('common.preview')} {Math.round(o * 100)}% {cfg.opacity === o ? '✓' : ''}
            </button>
          ))}
          <div className="divider my-1" />
          <button className="w-full text-start px-3 py-1.5 rounded-lg hover:bg-surface-200" onClick={() => { setMenu(null); window.dh.window.show() }}>
            ⬢ {t('nav.dashboard')}
          </button>
          <button className="w-full text-start px-3 py-1.5 rounded-lg hover:bg-surface-200" onClick={() => { setMenu(null); void invoke('res:card:hide').catch(() => window.close()) }}>
            {`✕ ${t('resCard.hideCard')}`}
          </button>
          <button className="w-full text-start px-3 py-1.5 rounded-lg hover:bg-rose-500/10 text-rose-500" onClick={() => { setMenu(null); window.dh.window.quit() }}>
            {`⏻ ${t('resCard.quit')}`}
          </button>
        </div>
      )}
    </div>
  )
}
