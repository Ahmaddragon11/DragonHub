import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, MonitorUp, Copy, Save, RotateCw, SquareDashed, Loader2, Crop as CropIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useApp } from '@/store'
import { PageHeader, Empty, Field, Segmented, Skeleton } from '@/components/ui'
import { invoke, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ScreenSource } from '@shared/types'

/** Selection rectangle in CSS pixels, relative to the capture container. */
type Rect = { x: number; y: number; w: number; h: number }
/** Where the image is actually painted inside the container (object-contain letterbox). */
type Box = { x: number; y: number; w: number; h: number; scale: number }

const DELAYS = ['0', '3', '5', '10'] as const
const MIN_SIDE = 8
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const stamp = () => new Date().toISOString().replace('T', '-').slice(0, 19)

export default function Screenshot() {
  const { t } = useTranslation()
  const { toast } = useApp(useShallow((s) => ({ toast: s.toast })))
  const [sources, setSources] = useState<ScreenSource[]>([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState('')
  const [rect, setRect] = useState<Rect | null>(null)
  const [shot, setShot] = useState<string | null>(null)
  const [delay, setDelay] = useState<(typeof DELAYS)[number]>('0')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x0: number; y0: number; box: Box } | null>(null)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)
  const src = sources.find((s) => s.id === selId) ?? sources[0] ?? null
  const locked = busy || countdown !== null

  const clearTimer = () => {
    if (tick.current) { clearInterval(tick.current); tick.current = null }
    setCountdown(null)
  }
  /** Runs `fn` once the configured delay elapses (immediately when the delay is 0). */
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
  const cancelDelay = () => clearTimer()

  /** The box the image occupies inside the container, plus the CSS -> source px factor. */
  const fit = (): Box | null => {
    const el = containerRef.current, img = imgRef.current
    if (!el || !img) return null
    const cw = el.clientWidth, ch = el.clientHeight
    const nw = img.naturalWidth, nh = img.naturalHeight
    if (!cw || !ch || !nw || !nh) return null
    const k = Math.min(cw / nw, ch / nh)
    const w = nw * k, h = nh * k
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h, scale: nw / w }
  }

  /** Crops the selection (or the whole image) to a PNG data URL. Never taints: the source is a data URL. */
  const cropUrl = (r: Rect | null): string | null => {
    const img = imgRef.current, box = fit()
    if (!img || !box || !img.naturalWidth || !img.naturalHeight) return null
    const nw = img.naturalWidth, nh = img.naturalHeight
    try {
      const x = r ? clamp(Math.round((r.x - box.x) * box.scale), 0, nw - 1) : 0
      const y = r ? clamp(Math.round((r.y - box.y) * box.scale), 0, nh - 1) : 0
      const w = Math.max(1, Math.min(r ? Math.round(r.w * box.scale) : nw, nw - x))
      const h = Math.max(1, Math.min(r ? Math.round(r.h * box.scale) : nh, nh - y))
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
      return c.toDataURL('image/png')
    } catch (e: unknown) { toast(errorMessage(e, t('toast.error')), 'error'); return null }
  }

  const capture = async () => {
    if (busy) return
    setBusy(true)
    try {
      const list = await invoke<ScreenSource[]>('screen:sources')
      const next = Array.isArray(list) ? list.filter((s) => s && typeof s.thumbnail === 'string') : []
      setSources(next)
      setSelId((id) => (next.some((s) => s.id === id) ? id : next[0]?.id ?? ''))
    } catch (e: unknown) { toast(errorMessage(e, t('toast.error')), 'error') } finally { setLoading(false); setBusy(false) }
  }
  const captureNow = () => afterDelay(() => { void capture() })

  /** Selects the whole image (empty rect) and crops it immediately. */
  const captureFull = async () => {
    if (busy || !src) return
    setBusy(true)
    try {
      setRect(null)
      const url = cropUrl(null)
      if (!url) { toast(t('screenshot.noSource'), 'error'); return }
      setShot(url)
    } catch (e: unknown) { toast(errorMessage(e, t('toast.error')), 'error') } finally { setBusy(false) }
  }
  const captureFullNow = () => afterDelay(() => { void captureFull() })

  const copy = async () => {
    if (busy || !src) return
    setBusy(true)
    try {
      const url = cropUrl(rect)
      if (!url) { toast(t('screenshot.noSource'), 'error'); return }
      await invoke('clipboard:writeImage', url)
      setShot(url)
      toast(t('screenshot.copied'), 'success')
    } catch (e: unknown) { toast(errorMessage(e, t('toast.error')), 'error') } finally { setBusy(false) }
  }

  const save = async () => {
    if (busy || !src) return
    setBusy(true)
    try {
      const url = cropUrl(rect)
      if (!url) { toast(t('screenshot.noSource'), 'error'); return }
      const out = await invoke<string | null>('dialog:save', { defaultPath: `screenshot-${stamp()}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] })
      if (!out) return
      const b64 = url.split(',')[1]
      if (!b64) { toast(t('toast.error'), 'error'); return }
      await invoke('fs:writeText', out, b64, 'base64')
      setShot(url)
      toast(t('screenshot.saved'), 'success')
    } catch (e: unknown) { toast(errorMessage(e, t('toast.error')), 'error') } finally { setBusy(false) }
  }

  // Pointer capture keeps the drag alive outside the container.
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = fit()
    if (locked || !box) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x0: e.clientX, y0: e.clientY, box }
    setRect(null)
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current, el = containerRef.current
    if (!d || !el) return
    const r = el.getBoundingClientRect()
    const cx = clamp(e.clientX - r.left, d.box.x, d.box.x + d.box.w)
    const cy = clamp(e.clientY - r.top, d.box.y, d.box.y + d.box.h)
    setRect({
      x: Math.min(d.x0 - r.left, cx),
      y: Math.min(d.y0 - r.top, cy),
      w: Math.min(Math.max(Math.abs(cx - (d.x0 - r.left)), MIN_SIDE), d.box.w),
      h: Math.min(Math.max(Math.abs(cy - (d.y0 - r.top)), MIN_SIDE), d.box.h),
    })
  }
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    drag.current = null
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void capture() }, [])
  useEffect(() => () => { if (tick.current) clearInterval(tick.current) }, [])
  // A different screen may have a different resolution: drop the stale selection.
  useEffect(() => { setRect(null) }, [selId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRect(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Live selection size in source pixels (the number the crop will actually produce).
  const box = src ? fit() : null
  const sel = rect && box ? { w: Math.max(1, Math.round(rect.w * box.scale)), h: Math.max(1, Math.round(rect.h * box.scale)) } : null

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('screenshot.title')} icon={<Camera />} subtitle={t('screenshot.subtitle')}>
        {src && (
          <>
            <button className="btn" onClick={captureNow} disabled={locked}><RotateCw size={16} /> {t('screenshot.capture')}</button>
            <button className="btn" onClick={captureFullNow} disabled={locked}><MonitorUp size={16} /> {t('screenshot.captureFull')}</button>
            <button className="btn-primary" onClick={copy} disabled={locked}><Copy size={16} /> {t('screenshot.copy')}</button>
            <button className="btn-primary" onClick={save} disabled={locked}><Save size={16} /> {t('screenshot.save')}</button>
          </>
        )}
      </PageHeader>

      {loading ? <Skeleton className="flex-1 min-h-0" /> : sources.length === 0 ? (
        <div className="card flex-1 min-h-0">
          <Empty icon={<Camera size={40} />} text={t('screenshot.noSource')} action={<button className="btn-primary" onClick={() => { void capture() }}><RotateCw size={16} /> {t('screenshot.capture')}</button>} />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-4 p-4 pt-0">
          <section className="card flex-1 min-h-0 flex flex-col p-3">
            <div
              ref={containerRef}
              role="application"
              aria-label={t('screenshot.selectRegion')}
              tabIndex={0}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              className="relative flex-1 min-h-0 w-full overflow-hidden rounded-xl bg-black/30 touch-none select-none"
            >
              {src && <img ref={imgRef} src={src.thumbnail} alt={src.name} draggable={false} className="absolute inset-0 h-full w-full object-contain" />}
              {rect && (
                <div
                  dir="ltr"
                  className="pointer-events-none absolute border-2 border-accent"
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, boxShadow: '0 0 0 9999px rgb(0 0 0 / .5)' }}
                >
                  <span className="badge absolute -top-7 left-0 bg-accent text-accent-fg font-mono text-[11px] whitespace-nowrap">{sel ? `${sel.w} × ${sel.h}` : ''}</span>
                </div>
              )}
              {!rect && !locked && <span className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-white/80 drop-shadow">{t('screenshot.dragHint')}</span>}
              {countdown !== null && (
                <div className="glass absolute inset-0 grid place-items-center">
                  <div className="flex flex-col items-center gap-2">
                    <span dir="ltr" className="font-mono text-5xl font-semibold tabular-nums text-surface-900">{countdown}</span>
                    <button className="btn-ghost" onClick={cancelDelay}><Loader2 size={14} /> {t('common.cancelAction')}</button>
                  </div>
                </div>
              )}
            </div>
            <p className="mt-2 shrink-0 text-center text-xs text-surface-500">{t('screenshot.hint')}</p>
          </section>

          <aside className="w-80 shrink-0 card overflow-y-auto p-4 space-y-4">
            {sources.length > 1 && (
              <Field label={t('screenshot.chooseScreen')}>
                <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t('screenshot.chooseScreen')}>
                  {sources.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={s.id === selId}
                      title={s.name}
                      onClick={() => setSelId(s.id)}
                      className={cn('flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors', s.id === selId ? 'bg-accent/20 text-accent' : 'bg-surface-200/60 text-surface-700 hover:bg-surface-300')}
                    >
                      <MonitorUp size={14} className="shrink-0" />
                      <span className="truncate" dir="ltr">{s.name}</span>
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <Field label={t('screenshot.delay')}>
              <Segmented value={delay} options={DELAYS.map((d) => ({ value: d, label: d }))} onChange={setDelay} label={t('screenshot.delay')} size="sm" />
            </Field>
            <button className="btn w-full" onClick={() => setRect(null)} disabled={!rect || locked}><SquareDashed size={14} /> {t('screenshot.selectRegion')}</button>
            {countdown !== null && <button className="btn-ghost w-full" onClick={cancelDelay}>{t('common.cancelAction')}</button>}
            <div className="divider" />
            <div className="flex items-center gap-2 text-xs text-surface-500"><CropIcon size={14} className="text-accent" />{t('screenshot.hint')}</div>
            <div className="rounded-xl border border-[color:var(--hairline)] bg-surface-200/40 overflow-hidden">
              {shot ? <img src={shot} alt={t('screenshot.capture')} className="block w-full" /> : <Empty icon={<CropIcon size={32} />} text={t('screenshot.dragHint')} />}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}