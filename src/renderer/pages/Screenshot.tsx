import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, Camera, CheckCircle2, Copy, Crop, Image as ImageIcon, Loader2, MonitorUp, Pencil, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useApp } from '@/store'
import { PageHeader, Empty, Field, Segmented, Skeleton } from '@/components/ui'
import { invoke, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { CaptureDisplay, CaptureResult, ScreenSource } from '@shared/types'

type Mode = 'region' | 'window' | 'display'
type Delay = '0' | '3' | '5' | '10'

const DELAYS: Delay[] = ['0', '3', '5', '10']
const stamp = () => new Date().toISOString().replace('T', '-').slice(0, 19)

/** Screenshot page: real region / window / full-screen capture with a results
 *  area (Copy / Save / Edit / Discard) and a session recents strip. */
export default function Screenshot() {
  const { t } = useTranslation()
  const { toast } = useApp(useShallow((s) => ({ toast: s.toast })))
  const [mode, setMode] = useState<Mode>('region')
  const [delay, setDelay] = useState<Delay>('0')
  const [displays, setDisplays] = useState<CaptureDisplay[]>([])
  const [windows, setWindows] = useState<ScreenSource[]>([])
  const [selDisplay, setSelDisplay] = useState<number | null>(null)
  const [selWindow, setSelWindow] = useState('')
  const [shot, setShot] = useState<CaptureResult | null>(null)
  const [recents, setRecents] = useState<CaptureResult[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingSources, setLoadingSources] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)
  const locked = busy || countdown !== null

  const loadDisplays = useCallback(async () => {
    setLoadingSources(true)
    try {
      const list = await window.dh.capture.displays()
      const next = Array.isArray(list) ? list : []
      setDisplays(next)
      setSelDisplay((id) => (next.some((d) => d.id === id) ? id : next.find((d) => d.primary)?.id ?? next[0]?.id ?? null))
    } catch {
      setDisplays([])
    } finally {
      setLoadingSources(false)
    }
  }, [])

  const loadWindows = useCallback(async () => {
    setLoadingSources(true)
    try {
      const list = await window.dh.capture.windows()
      const next = Array.isArray(list) ? list.filter((s) => s && typeof s.thumbnail === 'string') : []
      setWindows(next)
      setSelWindow((id) => (next.some((w) => w.id === id) ? id : next[0]?.id ?? ''))
    } catch {
      setWindows([])
    } finally {
      setLoadingSources(false)
    }
  }, [])

  useEffect(() => { void loadDisplays() }, [loadDisplays])
  useEffect(() => {
    if (mode === 'window') void loadWindows()
    else if (mode === 'display' && displays.length === 0) void loadDisplays()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const clearTimer = useCallback(() => {
    if (tick.current) { clearInterval(tick.current); tick.current = null }
    setCountdown(null)
  }, [])

  /** Runs `fn` once the configured delay elapses (immediately when delay is 0). */
  const afterDelay = (fn: () => void) => {
    clearTimer()
    const total = Number(delay)
    if (total <= 0) { fn(); return }
    let left = total
    setCountdown(left)
    tick.current = setInterval(() => {
      left -= 1
      if (left <= 0) { clearTimer(); fn() } else setCountdown(left)
    }, 1000)
  }
  useEffect(() => () => { if (tick.current) clearInterval(tick.current) }, [])

  const copyShot = useCallback(async (res: CaptureResult) => {
    try {
      await invoke('clipboard:writeImage', res.dataUrl)
      toast(t('capture.copied'), 'success')
    } catch (e) { toast(errorMessage(e, t('capture.error')), 'error') }
  }, [toast, t])

  const saveShot = useCallback(async (res: CaptureResult, openAfter = false): Promise<string | null> => {
    try {
      const out = await invoke<string | null>('dialog:save', { defaultPath: `screenshot-${stamp()}.png`, filters: [{ name: 'PNG', extensions: ['png'] }], title: t('capture.saveTitle') })
      if (!out) return null
      const b64 = res.dataUrl.split(',')[1]
      if (!b64) { toast(t('toast.error'), 'error'); return null }
      await invoke('fs:writeText', out, b64, 'base64')
      if (openAfter) {
        await invoke('fs:open', out).catch(() => {})
        toast(t('capture.opened'), 'success')
      } else {
        toast(t('capture.saved'), 'success')
      }
      return out
    } catch (e) { toast(errorMessage(e, t('capture.error')), 'error'); return null }
  }, [toast, t])

  const runCapture = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      let result: CaptureResult | null = null
      if (mode === 'region') {
        result = await window.dh.capture.region()
      } else if (mode === 'display') {
        if (selDisplay === null) { toast(t('capture.noSource'), 'warning'); return }
        result = await window.dh.capture.display(selDisplay)
      } else {
        if (!selWindow) { toast(t('capture.noSource'), 'warning'); return }
        result = await window.dh.capture.window(selWindow, windows.find((w) => w.id === selWindow)?.name)
      }
      if (!result || !result.dataUrl) { toast(t('capture.cancelled'), 'info'); return }
      setShot(result)
      setRecents((r) => [result as CaptureResult, ...r.filter((x) => x.dataUrl !== (result as CaptureResult).dataUrl)].slice(0, 4))
      if (result.action === 'copy') await copyShot(result)
      else if (result.action === 'save') await saveShot(result)
      else toast(t('capture.done'), 'success')
    } catch (e) {
      const msg = errorMessage(e, t('capture.error'))
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }, [busy, mode, selDisplay, selWindow, windows, toast, t, copyShot, saveShot])

  const startCapture = () => afterDelay(() => { void runCapture() })

  const modes = [
    { value: 'region' as Mode, label: t('capture.modeRegion'), icon: <Crop size={14} /> },
    { value: 'window' as Mode, label: t('capture.modeWindow'), icon: <AppWindow size={14} /> },
    { value: 'display' as Mode, label: t('capture.modeDisplay'), icon: <MonitorUp size={14} /> },
  ]

  const canCapture = mode === 'region' || (mode === 'window' ? !!selWindow : selDisplay !== null)

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('screenshot.title')} icon={<Camera />} subtitle={t('capture.subtitle')}>
        <Segmented value={mode} options={modes} onChange={(m) => setMode(m)} label={t('capture.mode')} size="sm" />
      </PageHeader>

      <div className="flex flex-1 min-h-0 gap-4 p-4 pt-0">
        <section className="card flex-1 min-h-0 flex flex-col p-3" aria-label={t('capture.preview')}>
          <div className="relative flex-1 min-h-0 w-full overflow-hidden rounded-xl bg-black/30">
            {busy && (
              <div className="glass absolute inset-0 z-10 grid place-items-center">
                <div className="flex flex-col items-center gap-2 text-surface-800">
                  <Loader2 size={26} className="animate-spin text-accent" />
                  <span className="text-sm font-medium">{t('capture.starting')}</span>
                </div>
              </div>
            )}
            {countdown !== null && (
              <div className="glass absolute inset-0 z-10 grid place-items-center">
                <div className="flex flex-col items-center gap-2">
                  <span dir="ltr" className="font-mono text-5xl font-semibold tabular-nums text-surface-900">{countdown}</span>
                  <button className="btn-ghost" onClick={clearTimer}><X size={14} /> {t('capture.cancelCountdown')}</button>
                </div>
              </div>
            )}
            {error ? (
              <Empty icon={<X size={40} />} text={error} hint={t('capture.hint')} action={<button className="btn-primary" onClick={() => { setError(null); startCapture() }}><RefreshCw size={16} /> {t('capture.start')}</button>} />
            ) : shot ? (
              <img src={shot.dataUrl} alt={t('capture.preview')} className="absolute inset-0 h-full w-full object-contain" />
            ) : (
              <Empty icon={<ImageIcon size={40} />} text={t('capture.previewEmpty')} hint={t('capture.hint')} />
            )}
          </div>

          {shot && (
            <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
              <span className="badge bg-success/15 text-success"><CheckCircle2 size={12} /> {t('capture.done')}</span>
              <span className="flex-1" />
              <button className="btn" onClick={() => { void copyShot(shot) }}><Copy size={15} /> {t('capture.copy')}</button>
              <button className="btn" onClick={() => { void saveShot(shot) }}><Save size={15} /> {t('capture.save')}</button>
              <button className="btn" onClick={() => { void saveShot(shot, true) }}><Pencil size={15} /> {t('capture.edit')}</button>
              <button className="btn-ghost" onClick={() => setShot(null)}><Trash2 size={15} /> {t('capture.discard')}</button>
            </div>
          )}
        </section>

        <aside className="w-80 shrink-0 card overflow-y-auto p-4 space-y-4">
          <p className="text-xs text-surface-500">
            {mode === 'region' ? t('capture.regionDesc') : mode === 'window' ? t('capture.windowDesc') : t('capture.displayDesc')}
          </p>

          {mode === 'window' && (
            <Field label={t('capture.sourceWindow')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-surface-500">{loadingSources ? t('capture.loadingSources') : `${windows.length}`}</span>
                <button className="btn-sm btn-soft" onClick={() => { void loadWindows() }} disabled={loadingSources}><RefreshCw size={13} /> {t('capture.refresh')}</button>
              </div>
              {loadingSources && windows.length === 0 ? <Skeleton className="h-32 w-full" /> : windows.length === 0 ? (
                <p className="rounded-lg bg-surface-200/50 p-3 text-xs text-surface-500">{t('capture.emptyWindows')}</p>
              ) : (
                <div className="mt-1 max-h-72 space-y-1.5 overflow-y-auto" role="radiogroup" aria-label={t('capture.sourceWindow')}>
                  {windows.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      role="radio"
                      aria-checked={w.id === selWindow}
                      title={w.name}
                      onClick={() => setSelWindow(w.id)}
                      className={cn('flex w-full items-center gap-2 rounded-lg p-1.5 text-start transition-colors', w.id === selWindow ? 'bg-accent/20 ring-1 ring-accent/40' : 'bg-surface-200/50 hover:bg-surface-300')}
                    >
                      <img src={w.thumbnail} alt="" className="h-10 w-16 shrink-0 rounded object-cover ring-1 ring-black/10" />
                      <span className="min-w-0 flex-1 truncate text-xs text-surface-700" dir="ltr">{w.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </Field>
          )}

          {mode === 'display' && (
            <Field label={t('capture.sourceDisplay')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-surface-500">{loadingSources ? t('capture.loadingSources') : `${displays.length}`}</span>
                <button className="btn-sm btn-soft" onClick={() => { void loadDisplays() }} disabled={loadingSources}><RefreshCw size={13} /> {t('capture.refresh')}</button>
              </div>
              {loadingSources && displays.length === 0 ? <Skeleton className="h-24 w-full" /> : displays.length === 0 ? (
                <p className="rounded-lg bg-surface-200/50 p-3 text-xs text-surface-500">{t('capture.emptyDisplays')}</p>
              ) : (
                <div className="mt-1 space-y-1.5" role="radiogroup" aria-label={t('capture.sourceDisplay')}>
                  {displays.map((d, i) => (
                    <button
                      key={d.id}
                      type="button"
                      role="radio"
                      aria-checked={d.id === selDisplay}
                      onClick={() => setSelDisplay(d.id)}
                      className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors', d.id === selDisplay ? 'bg-accent/20 text-accent' : 'bg-surface-200/50 text-surface-700 hover:bg-surface-300')}
                    >
                      <MonitorUp size={14} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-start" dir="ltr">{d.label || `Display ${i + 1}`}</span>
                      <span dir="ltr" className="shrink-0 font-mono text-[10px] text-surface-500">{d.width}×{d.height} · {d.scaleFactor}×</span>
                      {d.primary && <span className="badge bg-accent/15 text-accent shrink-0">{t('capture.primary')}</span>}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          )}

          <Field label={t('capture.delayLabel')} hint={t('capture.delayHint')}>
            <Segmented value={delay} options={DELAYS.map((d) => ({ value: d, label: d }))} onChange={setDelay} label={t('capture.delayLabel')} size="sm" />
          </Field>

          <button className="btn-primary w-full !py-2.5" onClick={startCapture} disabled={locked || !canCapture}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Crop size={16} />}
            {busy ? t('capture.starting') : mode === 'region' ? t('capture.modeRegion') : t('capture.start')}
          </button>

          <div className="divider" />

          <div>
            <p className="label mb-2">{t('capture.recent')}</p>
            {recents.length === 0 ? (
              <p className="text-xs text-surface-500">{t('capture.noRecent')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {recents.map((r, i) => (
                  <button key={`${i}-${r.dataUrl.length}`} type="button" onClick={() => setShot(r)} className="overflow-hidden rounded-lg ring-1 ring-[color:var(--hairline)] transition-transform hover:scale-[1.02]" title={t('capture.preview')}>
                    <img src={r.dataUrl} alt="" className="block h-20 w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-surface-500">{t('capture.hint')}</p>
        </aside>
      </div>
    </div>
  )
}
