import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Check, Info, AlertTriangle, XCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { dialogVariants, spring, useMotionPrefs } from '@/lib/motion'

/* ------------------------------------------------------------------ Toggle */
export function Toggle({ on, onChange, label, description, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; description?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      className="group flex w-full items-center justify-between gap-4 text-start disabled:opacity-50" onClick={() => onChange(!on)}>
      {label && (
        <span className="min-w-0">
          <span className="block text-sm text-surface-900">{label}</span>
          {description && <span className="block text-xs text-surface-500 mt-0.5">{description}</span>}
        </span>
      )}
      <span className="toggle" data-on={String(on)} aria-hidden="true" />
    </button>
  )
}

/* --------------------------------------------------------------- Segmented */
/** Segmented control with a shared-element sliding indicator. */
export function Segmented<T extends string>({ value, options, onChange, size = 'md', label, className }: {
  value: T; options: { value: T; label: React.ReactNode; icon?: React.ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; label?: string; className?: string
}) {
  const id = useId()
  const { reduced } = useMotionPrefs()
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex items-center gap-0.5 p-0.5 rounded-[10px] bg-surface-200/80 max-w-full flex-wrap', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} title={o.title} aria-label={o.title}
            onClick={() => onChange(o.value)}
            className={cn('relative inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150',
              size === 'sm' ? 'px-2 py-1 text-[11.5px]' : 'px-3 py-1.5 text-[13px]',
              active ? 'text-surface-900' : 'text-surface-600 hover:text-surface-900')}>
            {active && (
              <motion.span layoutId={reduced ? undefined : `seg-${id}`} transition={spring.snappy}
                className="absolute inset-0 rounded-lg bg-surface-100 shadow-e1 ring-1 ring-black/5 dark:ring-white/5" />
            )}
            {o.icon && <span className="relative z-10 flex">{o.icon}</span>}
            {o.label !== '' && <span className="relative z-10">{o.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------- Kbd */
export function Kbd({ keys, className }: { keys: string | string[]; className?: string }) {
  const list = Array.isArray(keys) ? keys : keys.split('+')
  return <span className={cn('inline-flex items-center gap-0.5', className)} dir="ltr">{list.map((k, i) => <kbd key={i} className="kbd">{k.trim()}</kbd>)}</span>
}

/* ---------------------------------------------------------------- Tooltip */
/** Lightweight tooltip: one fixed node, positioned on hover/focus after a short
 *  intent delay. No portal library, no layout thrash (reads rect once). */
export function Tooltip({ label, shortcut, children, side = 'bottom' }: { label: string; shortcut?: string; children: React.ReactElement; side?: 'top' | 'bottom' | 'right' | 'left' }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const tipRef = useRef<HTMLDivElement>(null)
  const open = (el: HTMLElement) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect()
      const x = side === 'right' ? r.right + 8 : side === 'left' ? r.left - 8 : r.left + r.width / 2
      const y = side === 'top' ? r.top - 8 : side === 'bottom' ? r.bottom + 8 : r.top + r.height / 2
      setPos({ x, y }); requestAnimationFrame(() => setShow(true))
    }, 380)
  }
  const close = () => { clearTimeout(timer.current); setShow(false); setPos(null) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!el || !pos) return
    const r = el.getBoundingClientRect()
    let left = side === 'right' ? pos.x : side === 'left' ? pos.x - r.width : pos.x - r.width / 2
    let top = side === 'top' ? pos.y - r.height : side === 'bottom' ? pos.y : pos.y - r.height / 2
    left = Math.max(6, Math.min(left, window.innerWidth - r.width - 6))
    top = Math.max(6, Math.min(top, window.innerHeight - r.height - 6))
    el.style.left = `${left}px`; el.style.top = `${top}px`
  }, [pos, side])
  const child = React.Children.only(children)
  return (
    <>
      {React.cloneElement(child, {
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { child.props.onMouseEnter?.(e); open(e.currentTarget) },
        onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { child.props.onMouseLeave?.(e); close() },
        onFocus: (e: React.FocusEvent<HTMLElement>) => { child.props.onFocus?.(e); if (e.currentTarget.matches(':focus-visible')) open(e.currentTarget) },
        onBlur: (e: React.FocusEvent<HTMLElement>) => { child.props.onBlur?.(e); close() },
        onMouseDown: (e: React.MouseEvent<HTMLElement>) => { child.props.onMouseDown?.(e); close() },
      })}
      {pos && (
        <div ref={tipRef} role="tooltip" className="dh-tooltip" data-show={show} style={{ left: -9999, top: -9999 }}>
          <span>{label}</span>{shortcut && <Kbd keys={shortcut} />}
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------ Focus trap */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
/** Traps Tab inside `ref`, restores focus to the opener on unmount. */
export function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const opener = document.activeElement as HTMLElement | null
    const el = ref.current
    // Focus the first field (or the surface itself) unless something inside already has focus (autoFocus).
    const raf = requestAnimationFrame(() => {
      if (!el || el.contains(document.activeElement)) return
      const first = el.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), textarea, select') || el
      first.focus({ preventScroll: true })
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null)
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [active, ref])
}

/* ------------------------------------------------------------------ Modal */
export function Modal({ open, onClose, title, description, children, wide, footer }: { open: boolean; onClose: () => void; title?: string; description?: string; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  const { t } = useTranslation()
  const { reduced } = useMotionPrefs()
  const surface = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusTrap(surface, open)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  const v = dialogVariants(reduced)
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.18 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <div aria-hidden className="fixed inset-0 bg-black/45 backdrop-blur-[2px] -z-10" />
          <motion.div ref={surface} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}
            variants={v} initial="initial" animate="enter" exit="exit"
            className={cn('surface-raised my-auto flex flex-col overflow-hidden max-h-[min(90vh,900px)] outline-none', wide ? 'w-[min(96vw,1024px)] max-w-4xl' : 'w-[min(96vw,560px)]')}>
            {title && (
              <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-[color:var(--hairline)] shrink-0">
                <div className="min-w-0">
                  <h3 id={titleId} className="text-[15px] font-semibold tracking-tight">{title}</h3>
                  {description && <p className="text-xs text-surface-500 mt-0.5">{description}</p>}
                </div>
                <button className="btn-icon -me-1.5 -mt-0.5" aria-label={t('common.close')} onClick={onClose}><X size={17} /></button>
              </header>
            )}
            <div className="p-5 overflow-y-auto min-h-0">{children}</div>
            {footer && <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[color:var(--hairline)] bg-surface-200/30 shrink-0">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ----------------------------------------------------------------- Toasts */
const TOAST_ICON = { success: <Check size={14} strokeWidth={2.5} />, error: <XCircle size={14} />, info: <Info size={14} />, warning: <AlertTriangle size={14} /> }
const TOAST_TONE = { success: 'text-emerald-500 bg-emerald-500/12', error: 'text-rose-500 bg-rose-500/12', info: 'text-sky-500 bg-sky-500/12', warning: 'text-amber-500 bg-amber-500/12' }

export function Toasts() {
  const { toasts, dismissToast } = useApp(useShallow((s) => ({ toasts: s.toasts, dismissToast: s.dismissToast })))
  const rtl = useApp((s) => s.settings.language === 'ar')
  const { reduced } = useMotionPrefs()
  const { t } = useTranslation()
  const dx = reduced ? 0 : rtl ? -24 : 24
  return (
    <div className="fixed bottom-4 end-4 z-[100] flex flex-col items-end gap-2 w-[340px] max-w-[calc(100vw-2rem)] pointer-events-none" aria-live="polite" aria-relevant="additions">
      <AnimatePresence initial={false}>
        {toasts.map((x) => (
          <motion.div key={x.id} layout={!reduced} role={x.type === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, x: dx, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1, transition: spring.soft }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
            className="pointer-events-auto surface-raised relative w-full overflow-hidden flex items-center gap-3 ps-3 pe-2 py-2.5 text-sm">
            <span className={cn('grid place-items-center h-6 w-6 rounded-full shrink-0', TOAST_TONE[x.type])}>{TOAST_ICON[x.type]}</span>
            <span className="flex-1 min-w-0 line-clamp-3 break-words text-surface-900">{x.text}</span>
            {x.action && (
              <button className="btn-sm btn-soft text-accent font-semibold shrink-0" onClick={() => { x.action!.run(); dismissToast(x.id) }}>{x.action.label}</button>
            )}
            <button className="btn-icon p-1 shrink-0" aria-label={t('common.close')} onClick={() => dismissToast(x.id)}><X size={14} /></button>
            {!reduced && (
              <motion.span aria-hidden className={cn('absolute bottom-0 start-0 h-[2px] origin-left rtl:origin-right', x.type === 'error' ? 'bg-rose-500/60' : 'bg-accent/50')}
                initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: x.duration / 1000, ease: 'linear' }} style={{ width: '100%' }} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ Empty */
export function Empty({ icon, text, hint, action }: { icon: React.ReactNode; text: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[240px] text-center gap-3 px-6 animate-fade-in">
      <div className="relative grid place-items-center h-16 w-16 rounded-2xl bg-surface-200/70 text-surface-500">
        <span aria-hidden className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-[color:var(--hairline)]" />
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-surface-800">{text}</p>
        {hint && <p className="text-xs text-surface-500 mt-1 max-w-xs">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------- PageHeader */
export function PageHeader({ title, icon, children, subtitle }: { title: string; icon: React.ReactNode; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="page-header flex items-center justify-between gap-x-4 gap-y-3 mb-5 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/20 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold tracking-tight leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs text-surface-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </header>
  )
}

/* --------------------------------------------------------------- TagInput */
export function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [v, setV] = useState('')
  const { t } = useTranslation()
  const commit = () => { const x = v.trim().replace(/^#/, ''); if (x && !tags.includes(x)) onChange([...tags, x]); setV('') }
  return (
    <div className="flex flex-wrap gap-1.5 items-center input min-h-[38px] py-1">
      <AnimatePresence initial={false}>
        {tags.map((tg) => (
          <motion.span key={tg} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={spring.snappy}
            className="badge bg-accent/12 text-accent">#{tg}
            <button type="button" className="rounded-full hover:bg-accent/20 p-0.5 -me-1" aria-label={`${t('common.delete')} ${tg}`} onClick={() => onChange(tags.filter((x) => x !== tg))}><X size={10} /></button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input className="bg-transparent outline-none flex-1 min-w-[80px] text-sm" value={v} placeholder={placeholder} aria-label={placeholder || t('common.tags')} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ',') && v.trim()) { e.preventDefault(); commit() } if (e.key === 'Backspace' && !v && tags.length) onChange(tags.slice(0, -1)) }} />
    </div>
  )
}

/* ------------------------------------------------------------ ColorPicker */
export function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label={t('common.color')}>
      {colors.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} onClick={() => onChange(c)}
          className={cn('relative h-5 w-5 rounded-full transition-transform duration-150 hover:scale-110 active:scale-95', value === c && 'scale-110')} style={{ background: c }}>
          {value === c && <motion.span layoutId="color-ring" transition={spring.snappy} className="absolute -inset-[3px] rounded-full ring-2" style={{ ['--tw-ring-color' as any]: c }} />}
        </button>
      ))}
    </div>
  )
}

/* --------------------------------------------------------- Progress / Ring */
export function Progress({ value, tone }: { value: number; tone?: 'accent' | 'success' | 'danger' }) {
  const v = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
  return (
    <div className="progress" dir="ltr" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn(tone === 'success' && '!bg-emerald-500', tone === 'danger' && '!bg-rose-500')} style={{ width: `${v}%` }} />
    </div>
  )
}

export function Ring({ value, size = 80, stroke = 8, children }: { value: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clampedValue = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
  const offset = circumference - (clampedValue / 100) * circumference
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeWidth={stroke} fill="none" className="text-surface-200" />
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeWidth={stroke} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="text-accent" style={{ transition: 'stroke-dashoffset var(--dur-4) var(--ease-out)' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center flex-col">{children}</div>
    </div>
  )
}

/* ---------------------------------------------------------- Field / Slider */
export function Field({ label, children, hint, className, error }: { label: string; children: React.ReactNode; hint?: string; className?: string; error?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="block text-[11px] text-rose-500" role="alert">{error}</span> : hint && <span className="block text-[11px] text-surface-500">{hint}</span>}
    </label>
  )
}

export function Slider({ value, min, max, step = 1, onChange, suffix, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[rgb(var(--accent))] cursor-pointer" />
      <span className="text-xs font-mono tabular-nums w-14 text-end text-surface-600">{value}{suffix}</span>
    </div>
  )
}

/* ------------------------------------------------------------ ContextMenu */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; icon?: React.ReactNode; onClick?: () => void; danger?: boolean; sep?: boolean; shortcut?: string }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const focusItem = useCallback((dir: 1 | -1 | 0) => {
    const list = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])
    if (!list.length) return
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    const next = dir === 0 ? 0 : (i + dir + list.length) % list.length
    list[next]?.focus()
  }, [])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(-1) }
      else if (e.key === 'Tab') { e.preventDefault(); focusItem(e.shiftKey ? -1 : 1) }
    }
    // Don't close when scrolling INSIDE the menu itself (it has overflow-y-auto).
    const s = (e: Event) => { if (ref.current?.contains(e.target as Node)) return; onClose() }
    window.addEventListener('mousedown', h); window.addEventListener('keydown', k, true); window.addEventListener('resize', s); window.addEventListener('scroll', s, true)
    focusItem(0)
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k, true); window.removeEventListener('resize', s); window.removeEventListener('scroll', s, true) }
  }, [onClose, focusItem])
  const menuH = Math.min(Math.max(window.innerHeight - 16, 32), items.reduce((a, it) => a + (it.sep ? 9 : 34), 12))
  const menuW = Math.min(300, Math.max(window.innerWidth - 16, 100))
  const left = Math.max(8, Math.min(x, window.innerWidth - menuW - 8)), top = Math.max(8, Math.min(y, window.innerHeight - menuH - 8))
  // Re-clamp after mount: wrapped labels can make the real height larger than the estimate.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`
    if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`
  }, [])
  return (
    <motion.div ref={ref} role="menu" initial={{ opacity: 0, scale: 0.97, y: -3 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
      className="fixed z-[95] surface-raised p-1 min-w-[200px] max-w-[min(300px,calc(100vw-16px))] max-h-[calc(100vh-16px)] overflow-y-auto origin-top-left rtl:origin-top-right" style={{ left, top }}>
      {items.map((it, i) => it.sep ? <div key={i} className="divider my-1" role="separator" /> : (
        <button key={i} role="menuitem" className={cn('w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-start transition-colors duration-100 hover:bg-surface-200 focus:bg-surface-200 focus-visible:outline-none min-w-0', it.danger && 'text-rose-500 hover:bg-rose-500/10 focus:bg-rose-500/10')} onClick={() => { it.onClick?.(); onClose() }}>
          {it.icon && <span className={cn('shrink-0 [&>svg]:h-[15px] [&>svg]:w-[15px]', it.danger ? 'text-rose-500' : 'text-surface-500')}>{it.icon}</span>}
          <span className="min-w-0 flex-1 break-words">{it.label}</span>
          {it.shortcut && <span className="text-[10.5px] text-surface-500 font-mono" dir="ltr">{it.shortcut}</span>}
        </button>
      ))}
    </motion.div>
  )
}

/* --------------------------------------------------------------- Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('shimmer', className)} />
}
