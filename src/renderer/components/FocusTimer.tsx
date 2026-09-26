import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Pause, RotateCcw, Timer } from 'lucide-react'
import { Ring, Segmented } from './ui'
import { invoke } from '@/lib/api'
import { cn } from '@/lib/utils'

const MODES = { work: 25 * 60, short: 5 * 60, long: 15 * 60 } as const
type Mode = keyof typeof MODES
const todayKey = () => new Date().toISOString().slice(0, 10)
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

/** Pomodoro-style focus timer widget: work/break cycles, desktop notification,
 *  daily session count persisted via the main-process data store. */
export default function FocusTimer() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('work')
  const [left, setLeft] = useState(MODES.work)
  const [running, setRunning] = useState(false)
  const [sessions, setSessions] = useState(0)

  useEffect(() => {
    invoke<{ date: string; count: number }>('data:get', 'focus', { date: todayKey(), count: 0 })
      .then((d) => { if (d && d.date === todayKey()) setSessions(Math.max(0, d.count | 0)) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!running) return
    // Deadline-based countdown: immune to timer throttling when the window is
    // hidden/minimised (a naive `s - 1` per tick drifts by minutes in background).
    const deadline = Date.now() + left * 1000
    const tick = () => setLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
    const i = setInterval(tick, 500)
    return () => clearInterval(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // Reflect the countdown in the window title while running; restore on stop/unmount.
  useEffect(() => {
    if (!running) { document.title = 'DragonHub'; return }
    document.title = `${fmt(left)} • DragonHub`
    return () => { document.title = 'DragonHub' }
  }, [left, running])

  const switchMode = (m: Mode) => { setMode(m); setRunning(false); setLeft(MODES[m]) }

  useEffect(() => {
    if (left !== 0) return
    setRunning(false)
    try { if (typeof Notification !== 'undefined') new Notification(t('focus.title'), { body: t(mode === 'work' ? 'focus.workDone' : 'focus.breakDone') }) } catch { /* notifications are best-effort */ }
    if (mode === 'work') {
      const next = sessions + 1
      setSessions(next)
      invoke('data:set', 'focus', { date: todayKey(), count: next }).catch(() => {})
      switchMode('short')
    } else {
      switchMode('work')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])

  const pct = ((MODES[mode] - left) / MODES[mode]) * 100
  return (
    <section className="card p-4 flex flex-col" aria-label={t('focus.title')}>
      <header className="flex items-center justify-between gap-2 mb-3 px-1">
        <h2 className="section-title"><Timer size={15} />{t('focus.title')}</h2>
        <span className="text-[11px] text-surface-500 tabular-nums">{t('focus.sessions', { count: sessions })}</span>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <Ring value={pct} size={132} stroke={7}>
          <span className="text-[28px] font-semibold tracking-tight tabular-nums leading-none" aria-live="off">{fmt(left)}</span>
          <span className={cn('mt-1 text-[11px] font-medium flex items-center gap-1.5', running ? 'text-accent' : 'text-surface-500')}>
            {running && <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />}{t(`focus.${mode}`)}
          </span>
        </Ring>
        <Segmented size="sm" value={mode} onChange={switchMode} label={t('focus.title')} options={(['work', 'short', 'long'] as Mode[]).map((m) => ({ value: m, label: t(`focus.${m}`) }))} />
        <div className="flex items-center gap-2">
          <button className="btn-primary min-w-[112px]" onClick={() => setRunning((r) => !r)} aria-pressed={running}>{running ? <Pause size={14} /> : <Play size={14} />}{running ? t('common.pause') : t('common.start')}</button>
          <button className="btn-icon" title={t('common.reset')} aria-label={t('common.reset')} disabled={left === MODES[mode] && !running} onClick={() => { setRunning(false); setLeft(MODES[mode]) }}><RotateCcw size={15} /></button>
        </div>
      </div>
    </section>
  )
}
