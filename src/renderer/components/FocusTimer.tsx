import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Pause, RotateCcw, Timer } from 'lucide-react'
import { Ring } from './ui'
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
    const i = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(i)
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

  return (
    <section className="card p-5">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Timer size={16} className="text-accent" />{t('focus.title')}</h2>
      <div className="flex items-center gap-4">
        <Ring value={((MODES[mode] - left) / MODES[mode]) * 100} size={96} stroke={10}>
          <span className="text-lg font-black tabular-nums">{fmt(left)}</span>
          <span className="text-[10px] text-surface-500">{t(`focus.${mode}`)}</span>
        </Ring>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex gap-1 p-1 rounded-xl bg-surface-200 w-fit">
            {(['work', 'short', 'long'] as Mode[]).map((m) => (
              <button key={m} onClick={() => switchMode(m)} className={cn('px-2 py-1 rounded-lg text-[11px] transition-all duration-300', mode === m ? 'bg-surface-100 text-accent font-semibold shadow-sm' : 'text-surface-600 hover:text-surface-900')}>{t(`focus.${m}`)}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setRunning((r) => !r)}>{running ? <Pause size={13} /> : <Play size={13} />}{running ? t('common.pause') : t('common.start')}</button>
            <button className="btn-icon" title={t('common.reset')} onClick={() => { setRunning(false); setLeft(MODES[mode]) }}><RotateCcw size={14} /></button>
          </div>
          <p className="text-[11px] text-surface-500">{t('focus.sessions', { count: sessions })}</p>
        </div>
      </div>
    </section>
  )
}
