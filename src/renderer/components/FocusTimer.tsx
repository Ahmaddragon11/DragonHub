import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Pause, RotateCcw, Settings2, Timer } from 'lucide-react'
import { Ring, Segmented } from './ui'
import { invoke } from '@/lib/api'
import { cn } from '@/lib/utils'

const DEFAULT_MINS = { work: 25, short: 5, long: 15 }
type Mode = keyof typeof DEFAULT_MINS
type Mins = Record<Mode, number>
const clampMins = (n: number) => Math.min(180, Math.max(1, Math.round(n) || 1))
const sanitizeMins = (raw: unknown): Mins => {
  const out: Mins = { ...DEFAULT_MINS }
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out) as Mode[]) {
      const v = (raw as Record<string, unknown>)[k]
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = clampMins(v)
    }
  }
  return out
}
const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

/** Minutes field that keeps a local text draft, so clearing it mid-edit never
 *  snaps to 1; the clamp commits on blur/Enter instead. */
function MinsInput({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => { setTxt(String(value)) }, [value])
  const commit = () => {
    const n = Number(txt)
    const v = txt.trim() !== '' && Number.isFinite(n) ? clampMins(n) : value
    onCommit(v)
    setTxt(String(v))
  }
  return (
    <input type="number" inputMode="numeric" min={1} max={180} step={1} dir="ltr" className="input py-1 text-xs w-16 text-center tabular-nums"
      aria-label={label} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}

/** Pomodoro-style focus timer widget: work/break cycles with customizable
 *  durations, desktop notification, daily session count persisted via the
 *  main-process data store. */
export default function FocusTimer() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('work')
  const [left, setLeft] = useState(DEFAULT_MINS.work * 60)
  const [running, setRunning] = useState(false)
  const [sessions, setSessions] = useState(0)
  const [mins, setMins] = useState<Mins>({ ...DEFAULT_MINS })
  const [customizing, setCustomizing] = useState(false)

  const durations: Record<Mode, number> = { work: mins.work * 60, short: mins.short * 60, long: mins.long * 60 }
  const runningRef = useRef(running)
  const modeRef = useRef(mode)
  useEffect(() => { runningRef.current = running; modeRef.current = mode })

  const persist = (next: { date: string; count: number; mins: Mins }) => {
    invoke('data:set', 'focus', next).catch(() => {})
  }

  useEffect(() => {
    invoke<{ date: string; count: number; mins?: unknown }>('data:get', 'focus', { date: todayKey(), count: 0 })
      .then((d) => {
        if (!d) return
        const m = sanitizeMins(d.mins)
        setMins(m)
        if (d.date === todayKey()) setSessions(Math.max(0, d.count | 0))
        if (!runningRef.current) setLeft(m[modeRef.current] * 60)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!running) return
    // Keep the device awake while a focus session runs so the screen can't
    // sleep mid-session (best-effort; main tracks the blocker id, no-ops on refuse).
    invoke('app:keepAwake', true).catch(() => {})
    // Deadline-based countdown: immune to timer throttling when the window is
    // hidden/minimised (a naive `s - 1` per tick drifts by minutes in background).
    const deadline = Date.now() + left * 1000
    const tick = () => setLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
    const i = setInterval(tick, 1000)
    return () => { clearInterval(i); invoke('app:keepAwake', false).catch(() => {}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // Reflect the countdown in the window title while running; restore on stop/unmount.
  useEffect(() => {
    if (!running) { document.title = 'DragonHub'; return }
    document.title = `${fmt(left)} • DragonHub`
    return () => { document.title = 'DragonHub' }
  }, [left, running])

  const switchMode = (m: Mode) => { setMode(m); setRunning(false); setLeft(durations[m]) }

  const editMins = (m: Mode, v: number) => {
    const n = clampMins(v)
    const next = { ...mins, [m]: n }
    setMins(next)
    persist({ date: todayKey(), count: sessions, mins: next })
    if (!running && m === mode) setLeft(n * 60)
  }

  useEffect(() => {
    if (left !== 0) return
    setRunning(false)
    try { if (typeof Notification !== 'undefined') new Notification(t('focus.title'), { body: t(mode === 'work' ? 'focus.workDone' : 'focus.breakDone') }) } catch { /* notifications are best-effort */ }
    if (mode === 'work') {
      const next = sessions + 1
      setSessions(next)
      persist({ date: todayKey(), count: next, mins })
      switchMode('short')
    } else {
      switchMode('work')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])

  const pct = ((durations[mode] - left) / durations[mode]) * 100
  return (
    <section className="card p-4 flex flex-col" aria-label={t('focus.title')}>
      <header className="flex items-center justify-between gap-2 mb-3 px-1">
        <h2 className="section-title"><Timer size={15} />{t('focus.title')}</h2>
        <div className="flex items-center gap-0.5 -me-1">
          <span className="text-[11px] text-surface-500 tabular-nums">{t('focus.sessions', { count: sessions })}</span>
          <button className="btn-icon p-1" title={t('focus.customize')} aria-label={t('focus.customize')} aria-expanded={customizing}
            onClick={() => setCustomizing((c) => !c)}><Settings2 size={14} /></button>
        </div>
      </header>
      {customizing && (
        <div className="mx-1 mb-3 rounded-xl bg-surface-200/60 px-3 py-2.5 ring-1 ring-inset ring-[color:var(--hairline)] animate-fade-in">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-surface-700">{t('focus.customizeHint')}</span>
            <button className="btn-sm btn-soft" onClick={() => setCustomizing(false)}>{t('focus.done')}</button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(['work', 'short', 'long'] as Mode[]).map((m) => (
              <label key={m} className="flex flex-col items-center gap-1 min-w-0">
                <span className="text-[10.5px] text-surface-500 truncate max-w-full">{t(`focus.${m}Mins`)}</span>
                <MinsInput label={t(`focus.${m}Mins`)} value={mins[m]} onCommit={(n) => editMins(m, n)} />
              </label>
            ))}
          </div>
        </div>
      )}
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
          <button className="btn-icon" title={t('common.reset')} aria-label={t('common.reset')} disabled={left === durations[mode] && !running} onClick={() => { setRunning(false); setLeft(durations[mode]) }}><RotateCcw size={15} /></button>
        </div>
      </div>
    </section>
  )
}
