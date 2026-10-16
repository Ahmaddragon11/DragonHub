import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Copy, Droplet, Highlighter, Pen, Pencil, Save, Square, Trash2, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CaptureAction, CaptureOverlayInit } from '@shared/types'

/** Selection rectangle in CSS px, relative to the overlay (== the display). */
type Rect = { x: number; y: number; w: number; h: number }
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type Tool = 'pen' | 'rect' | 'arrow' | 'highlight' | 'blur'
type Pt = { x: number; y: number }
interface DragState { kind: 'new' | 'move' | 'resize'; originX: number; originY: number; startRect: Rect | null; handle: Handle | null }
interface DrawState { tool: Tool; start: Pt; last: Pt }

const MIN = 6
const ACCENT = '#8b5cf6'
const RED = '#ff3b30'
const YELLOW = 'rgba(250, 204, 21, 0.4)'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_POS: Record<Handle, { left: string; top: string; cursor: string }> = {
  nw: { left: '0%', top: '0%', cursor: 'nwse-resize' },
  n: { left: '50%', top: '0%', cursor: 'ns-resize' },
  ne: { left: '100%', top: '0%', cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: '0%', top: '100%', cursor: 'nesw-resize' },
  w: { left: '0%', top: '50%', cursor: 'ew-resize' },
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const pointInRect = (x: number, y: number, r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

/** Stroke an arrow (shaft + filled head) from `from` to `to` on `ctx`. */
function drawArrow(ctx: CanvasRenderingContext2D, from: Pt, to: Pt, scale: number) {
  const head = Math.max(10, (scale / 640) * 16)
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  ctx.strokeStyle = RED
  ctx.fillStyle = RED
  ctx.lineWidth = Math.max(2, (scale / 640) * 2.5)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

/**
 * Full-desktop region-capture overlay (rendered by main.tsx when `?overlay=1`).
 *
 * Main freezes every display, then hands this component a full-resolution PNG
 * plus the display geometry via `capture:overlay:init`. The user drags/adjusts a
 * region (move + 8 resize handles), optionally annotates it (pen / rectangle /
 * arrow / highlight / blur), then Copy/Save commits — either the CSS-px rect
 * (main crops the frozen image) or a pre-composited annotated PNG.
 */
export default function ScreenshotOverlay() {
  const { t, i18n } = useTranslation()
  const [init, setInit] = useState<CaptureOverlayInit | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [mode, setMode] = useState<'select' | 'annotate'>('select')
  const [tool, setTool] = useState<Tool>('pen')
  const [canUndo, setCanUndo] = useState(false)
  const [imgReady, setImgReady] = useState(false)

  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const drawRef = useRef<DrawState | null>(null)
  const historyRef = useRef<ImageData[]>([])
  const rectRef = useRef<Rect | null>(null)
  const modeRef = useRef<'select' | 'annotate'>('select')
  const initRef = useRef<CaptureOverlayInit | null>(null)

  useEffect(() => { rectRef.current = rect }, [rect])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { initRef.current = init }, [init])

  const cancel = useCallback(() => { void window.dh.capture.cancel().catch(() => {}) }, [])

  const commit = useCallback((action: CaptureAction, annotated: boolean) => {
    const geometry = rectRef.current
    if (!geometry || geometry.w < MIN || geometry.h < MIN) return
    const canvas = canvasRef.current
    if (annotated && canvas) {
      const dataUrl = canvas.toDataURL('image/png')
      if (!dataUrl) return
      void window.dh.capture.commit({ action, dataUrl }).catch(() => {})
      return
    }
    void window.dh.capture.commit({ action, rect: { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h } }).catch(() => {})
  }, [])

  const exitAnnotate = useCallback(() => {
    drawRef.current = null
    setMode('select')
  }, [])

  // Handshake: subscribe first, then ask main for the frozen screenshot.
  useEffect(() => {
    const off = window.dh.capture.onInit((payload) => {
      setInit(payload)
      if (payload.lang) {
        document.documentElement.dir = payload.lang === 'ar' ? 'rtl' : 'ltr'
        void i18n.changeLanguage(payload.lang)
      }
    })
    void window.dh.capture.ready().catch(() => {})
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // If main never delivered the screenshot (load issue), don't block the screen.
  useEffect(() => {
    const id = setTimeout(() => { if (!initRef.current) cancel() }, 8000)
    return () => clearTimeout(id)
  }, [cancel])

  // Escape cancels (or leaves annotation mode); Enter copies; right-click cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (modeRef.current === 'annotate') exitAnnotate()
        else cancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        commit('copy', modeRef.current === 'annotate')
      }
    }
    const onCtx = (e: MouseEvent) => {
      e.preventDefault()
      if (modeRef.current === 'annotate') exitAnnotate()
      else cancel()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onCtx)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', onCtx)
    }
  }, [cancel, commit, exitAnnotate])

  // Initialise / reset the annotation canvas whenever annotation mode starts.
  useEffect(() => {
    if (mode !== 'annotate' || !init) return
    const canvas = canvasRef.current
    const img = imgRef.current
    const geometry = rectRef.current
    if (!canvas || !img || !geometry || !img.complete || !img.naturalWidth) return
    const sx = init.imageSize.width / (init.bounds.width || 1)
    const sy = init.imageSize.height / (init.bounds.height || 1)
    const cw = Math.max(1, Math.round(geometry.w * sx))
    const ch = Math.max(1, Math.round(geometry.h * sy))
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cw, ch)
    ctx.drawImage(img, geometry.x * sx, geometry.y * sy, cw, ch, 0, 0, cw, ch)
    historyRef.current = []
    setCanUndo(false)
  }, [mode, init, imgReady])

  const pushHistory = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    // Bound memory: a 4K selection snapshot is ~33 MB, so allow fewer of them.
    const pixels = canvas.width * canvas.height
    const max = pixels > 8_000_000 ? 3 : pixels > 2_000_000 ? 6 : 15
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    while (historyRef.current.length > max) historyRef.current.shift()
    setCanUndo(true)
  }

  const undo = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const hist = historyRef.current
    if (!canvas || !ctx || !hist.length) return
    const snap = hist.pop()
    if (snap) ctx.putImageData(snap, 0, 0)
    setCanUndo(hist.length > 0)
  }

  const clearAnnotations = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const img = imgRef.current
    const geometry = rectRef.current
    if (!canvas || !ctx || !img || !init || !geometry) return
    const sx = init.imageSize.width / (init.bounds.width || 1)
    const sy = init.imageSize.height / (init.bounds.height || 1)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, geometry.x * sx, geometry.y * sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    historyRef.current = []
    setCanUndo(false)
  }

  // ---------- selection: create / move / resize ----------
  const onSurfaceDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!init || mode === 'annotate' || e.button !== 0) return
    if (rect && pointInRect(e.clientX, e.clientY, rect)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const x = clamp(e.clientX, 0, init.bounds.width)
    const y = clamp(e.clientY, 0, init.bounds.height)
    dragRef.current = { kind: 'new', originX: x, originY: y, startRect: null, handle: null }
    setRect({ x, y, w: 0, h: 0 })
  }

  const onSurfaceMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    const b = init?.bounds
    if (!d || !b) return
    const px = clamp(e.clientX, 0, b.width)
    const py = clamp(e.clientY, 0, b.height)
    if (d.kind === 'new') {
      setRect({ x: Math.min(d.originX, px), y: Math.min(d.originY, py), w: Math.abs(px - d.originX), h: Math.abs(py - d.originY) })
      return
    }
    const r = d.startRect
    if (!r) return
    if (d.kind === 'move') {
      const dx = e.clientX - d.originX
      const dy = e.clientY - d.originY
      setRect({ x: clamp(r.x + dx, 0, b.width - r.w), y: clamp(r.y + dy, 0, b.height - r.h), w: r.w, h: r.h })
      return
    }
    // resize
    const right = r.x + r.w
    const bottom = r.y + r.h
    let x = r.x
    let y = r.y
    let w = r.w
    let h = r.h
    if (d.handle?.includes('w')) { x = clamp(px, 0, right - MIN); w = right - x }
    if (d.handle?.includes('e')) { const nr = clamp(px, x + MIN, b.width); w = nr - x }
    if (d.handle?.includes('n')) { y = clamp(py, 0, bottom - MIN); h = bottom - y }
    if (d.handle?.includes('s')) { const nb = clamp(py, y + MIN, b.height); h = nb - y }
    setRect({ x, y, w, h })
  }

  const onSurfaceUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const d = dragRef.current
    dragRef.current = null
    if (d?.kind === 'new') setRect((r) => (r && r.w >= MIN && r.h >= MIN ? r : null))
  }

  const onSelectionDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode === 'annotate' || e.button !== 0 || !rect) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { kind: 'move', originX: e.clientX, originY: e.clientY, startRect: rect, handle: null }
  }

  const onHandleDown = (handle: Handle) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode === 'annotate' || e.button !== 0 || !rect) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { kind: 'resize', originX: e.clientX, originY: e.clientY, startRect: rect, handle }
  }

  // ---------- annotation canvas ----------
  const canvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const r = canvas.getBoundingClientRect()
    const sx = canvas.width / (r.width || 1)
    const sy = canvas.height / (r.height || 1)
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }
  }

  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'annotate' || e.button !== 0) return
    e.stopPropagation()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pushHistory(ctx, canvas)
    const p = canvasPoint(e)
    drawRef.current = { tool, start: p, last: p }
    if (tool === 'pen' || tool === 'highlight') {
      ctx.strokeStyle = tool === 'pen' ? RED : YELLOW
      ctx.lineWidth = tool === 'pen' ? Math.max(2, (canvas.width / 640) * 2.5) : Math.max(10, (canvas.width / 640) * 16)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
    }
  }

  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!d || !canvas || !ctx) return
    const p = canvasPoint(e)
    if (d.tool === 'pen' || d.tool === 'highlight') {
      ctx.strokeStyle = d.tool === 'pen' ? RED : YELLOW
      ctx.lineWidth = d.tool === 'pen' ? Math.max(2, (canvas.width / 640) * 2.5) : Math.max(10, (canvas.width / 640) * 16)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(d.last.x, d.last.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      d.last = p
      return
    }
    const snap = historyRef.current[historyRef.current.length - 1]
    if (snap) ctx.putImageData(snap, 0, 0)
    if (d.tool === 'rect') {
      ctx.strokeStyle = RED
      ctx.lineWidth = Math.max(2, (canvas.width / 640) * 2.5)
      ctx.strokeRect(d.start.x, d.start.y, p.x - d.start.x, p.y - d.start.y)
    } else if (d.tool === 'arrow') {
      drawArrow(ctx, d.start, p, canvas.width)
    } else {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.setLineDash([6, 4])
      ctx.lineWidth = 1
      ctx.strokeRect(d.start.x, d.start.y, p.x - d.start.x, p.y - d.start.y)
      ctx.restore()
    }
  }

  const onCanvasUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawRef.current
    const canvas = canvasRef.current
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d || !canvas) return
    const p = canvasPoint(e)
    if (d.tool === 'blur') applyBlur(d.start, p)
    drawRef.current = null
  }

  const applyBlur = (a: Pt, b: Pt) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const img = imgRef.current
    const geometry = rectRef.current
    if (!canvas || !ctx || !img || !init || !geometry) return
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    const snap = historyRef.current[historyRef.current.length - 1]
    if (snap) ctx.putImageData(snap, 0, 0)
    if (w < 3 || h < 3) return
    const sx = init.imageSize.width / (init.bounds.width || 1)
    const sy = init.imageSize.height / (init.bounds.height || 1)
    const bx = geometry.x * sx
    const by = geometry.y * sy
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.filter = 'blur(8px)'
    ctx.drawImage(img, bx + x, by + y, w, h, x, y, w, h)
    ctx.filter = 'none'
    ctx.restore()
  }

  if (!init) {
    // Transparent while waiting for the frozen screenshot (main cancels on timeout).
    return <div className="h-screen w-screen cursor-crosshair bg-transparent" />
  }

  const scaleX = init.imageSize.width / (init.bounds.width || 1)
  const scaleY = init.imageSize.height / (init.bounds.height || 1)
  const showSelection = !!rect && rect.w >= MIN && rect.h >= MIN
  const pixelW = showSelection ? Math.max(1, Math.round(rect!.w * scaleX)) : 0
  const pixelH = showSelection ? Math.max(1, Math.round(rect!.h * scaleY)) : 0

  const TOOLS: { id: Tool; label: string; icon: React.ReactNode }[] = [
    { id: 'pen', label: t('capture.overlay.pen'), icon: <Pen size={16} /> },
    { id: 'rect', label: t('capture.overlay.rect'), icon: <Square size={16} /> },
    { id: 'arrow', label: t('capture.overlay.arrow'), icon: <ArrowRight size={16} /> },
    { id: 'highlight', label: t('capture.overlay.highlight'), icon: <Highlighter size={16} /> },
    { id: 'blur', label: t('capture.overlay.blur'), icon: <Droplet size={16} /> },
  ]

  const iconBtn = 'inline-flex items-center justify-center h-9 w-9 rounded-lg text-white/90 transition-colors hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white'

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-transparent">
      <img
        ref={imgRef}
        src={init.image}
        alt=""
        draggable={false}
        onLoad={() => setImgReady(true)}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ objectFit: 'fill' }}
      />

      <div
        role="application"
        aria-label={t('capture.overlay.region')}
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerUp={onSurfaceUp}
        onPointerCancel={onSurfaceUp}
        className="absolute inset-0 touch-none"
        style={{ cursor: mode === 'annotate' ? 'default' : 'crosshair' }}
      >
        {!showSelection && <div className="pointer-events-none absolute inset-0 bg-black/45" />}
        {showSelection && (
          <div
            onPointerDown={onSelectionDown}
            className="absolute"
            style={{ left: rect!.x, top: rect!.y, width: rect!.w, height: rect!.h, cursor: mode === 'annotate' ? 'default' : 'move', boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)', outline: `2px solid ${ACCENT}`, outlineOffset: '-1px' }}
          >
            {mode === 'annotate' && (
              <canvas
                ref={canvasRef}
                onPointerDown={onCanvasDown}
                onPointerMove={onCanvasMove}
                onPointerUp={onCanvasUp}
                onPointerCancel={onCanvasUp}
                className="absolute inset-0 h-full w-full touch-none"
                style={{ cursor: 'crosshair' }}
              />
            )}
            {mode === 'select' && HANDLES.map((h) => (
              <div
                key={h}
                onPointerDown={onHandleDown(h)}
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-[#8b5cf6]"
                style={{ left: HANDLE_POS[h].left, top: HANDLE_POS[h].top, cursor: HANDLE_POS[h].cursor }}
              />
            ))}
            {showSelection && (
              <span dir="ltr" className="pointer-events-none absolute -top-7 start-0 rounded-md bg-black/70 px-2 py-0.5 font-mono text-[11px] tabular-nums text-white">
                {pixelW} × {pixelH}
              </span>
            )}
          </div>
        )}
      </div>

      {!showSelection && (
        <p className="pointer-events-none absolute inset-x-0 top-8 text-center text-sm font-medium text-white/90 drop-shadow">
          {t('capture.overlay.dragHint')}
        </p>
      )}

      {showSelection && (
        <div
          className="fixed bottom-6 start-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/15 bg-black/80 p-1.5 shadow-2xl backdrop-blur rtl:translate-x-1/2"
          onPointerDown={(e) => e.stopPropagation()}
          role="toolbar"
          aria-label={t('capture.overlay.toolbar')}
        >
          {mode === 'annotate' && (
            <>
              {TOOLS.map((tl) => (
                <button
                  key={tl.id}
                  type="button"
                  aria-label={tl.label}
                  aria-pressed={tool === tl.id}
                  onClick={() => setTool(tl.id)}
                  className={cn(iconBtn, tool === tl.id && 'bg-white/25')}
                >
                  {tl.icon}
                </button>
              ))}
              <button type="button" aria-label={t('capture.overlay.undo')} onClick={undo} disabled={!canUndo} className={iconBtn}>
                <Undo2 size={16} />
              </button>
              <button type="button" aria-label={t('capture.overlay.clear')} onClick={clearAnnotations} className={iconBtn}>
                <Trash2 size={16} />
              </button>
              <span className="mx-1 h-6 w-px bg-white/20" aria-hidden />
            </>
          )}

          <button type="button" aria-label={t('capture.overlay.copy')} onClick={() => commit('copy', mode === 'annotate')} className={iconBtn}>
            <Copy size={16} />
          </button>
          <button type="button" aria-label={t('capture.overlay.save')} onClick={() => commit('save', mode === 'annotate')} className={iconBtn}>
            <Save size={16} />
          </button>

          {mode === 'select' && (
            <button type="button" aria-label={t('capture.overlay.edit')} onClick={() => setMode('annotate')} className={iconBtn}>
              <Pencil size={16} />
            </button>
          )}

          <button type="button" aria-label={t('capture.overlay.cancel')} onClick={cancel} className={cn(iconBtn, 'hover:bg-rose-500/80')}>
            <X size={16} />
          </button>
        </div>
      )}

      {showSelection && (
        <p className="pointer-events-none absolute inset-x-0 top-6 text-center text-xs font-medium text-white/80 drop-shadow">
          {mode === 'annotate' ? t('capture.overlay.annotateHint') : t('capture.overlay.adjustHint')}
        </p>
      )}
    </div>
  )
}
