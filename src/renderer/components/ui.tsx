import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Check, Info, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { motion, AnimatePresence } from 'framer-motion'

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="flex items-center gap-3" onClick={() => onChange(!on)}>
      <span className="toggle" data-on={String(on)} aria-hidden="true" />
      {label && <span className="text-sm">{label}</span>}
    </button>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; wide?: boolean }) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prevOverflow }
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] flex items-start sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div role="dialog" aria-modal="true" aria-label={title} className={cn('card my-auto flex flex-col overflow-hidden max-h-[90vh]', wide ? 'w-[min(96vw,1024px)] max-w-4xl' : 'w-[min(96vw,640px)] max-w-xl')} initial={{ scale: 0.92, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 10, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 26 }}>
            {title && (
              <header className="flex items-center justify-between px-5 py-4 border-b border-surface-300/60">
                <h3 className="font-semibold">{title}</h3>
                <button className="btn-icon" aria-label={t('common.close')} onClick={onClose}><X size={18} /></button>
              </header>
            )}
            <div className="p-5 max-h-[90vh] overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  const icons = { success: <Check size={16} />, error: <XCircle size={16} />, info: <Info size={16} />, warning: <AlertTriangle size={16} /> }
  const colors = { success: 'text-emerald-500 bg-emerald-500/10', error: 'text-rose-500 bg-rose-500/10', info: 'text-sky-500 bg-sky-500/10', warning: 'text-amber-500 bg-amber-500/10' }
  return (
    <div className="fixed bottom-4 end-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout role="status" title={t.text} initial={{ opacity: 0, x: rtl ? -40 : 40, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: rtl ? -40 : 40, scale: 0.9 }} className="card flex items-center gap-3 px-4 py-3 text-sm cursor-pointer" onClick={() => dismissToast(t.id)}>
            <span className={cn('rounded-lg p-1.5 shrink-0', colors[t.type])}>{icons[t.type]}</span>
            <span className="flex-1 line-clamp-3 break-words">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function Empty({ icon, text, action }: { icon: React.ReactNode; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[240px] text-center gap-3 text-surface-600 animate-fade-in">
      <div className="p-5 rounded-3xl bg-surface-200/70 text-accent animate-float">{icon}</div>
      <p className="text-sm max-w-xs">{text}</p>
      {action}
    </div>
  )
}

export function PageHeader({ title, icon, children, subtitle }: { title: string; icon: React.ReactNode; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 mb-5 flex-wrap">
      <div className="flex items-center gap-3">
        <span className="p-2.5 rounded-2xl bg-accent/15 text-accent shadow-glow">{icon}</span>
        <div>
          <h1 className="text-xl font-bold leading-tight">{title}</h1>
          {subtitle && <p className="text-xs text-surface-600">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </header>
  )
}

export function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [v, setV] = useState('')
  return (
    <div className="flex flex-wrap gap-1.5 items-center input min-h-[38px] py-1">
      {tags.map((t) => (
        <span key={t} className="badge bg-accent/15 text-accent">#{t}<button type="button" onClick={() => onChange(tags.filter((x) => x !== t))}><X size={11} /></button></span>
      ))}
      <input className="bg-transparent outline-none flex-1 min-w-[80px] text-sm" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ',') && v.trim()) { e.preventDefault(); if (!tags.includes(v.trim())) onChange([...tags, v.trim()]); setV('') } if (e.key === 'Backspace' && !v && tags.length) onChange(tags.slice(0, -1)) }} />
    </div>
  )
}

export function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {colors.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} className={cn('h-6 w-6 rounded-full transition-transform duration-300 hover:scale-110', value === c && 'ring-2 ring-offset-2 ring-offset-surface-100 ring-accent scale-110')} style={{ background: c }} />
      ))}
    </div>
  )
}

export function Progress({ value }: { value: number }) {
  return <div className="progress" dir="ltr"><div style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
}

export function Ring({ value, size = 80, stroke = 8, children }: { value: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clampedValue = Math.min(100, Math.max(0, value))
  const offset = circumference - (clampedValue / 100) * circumference
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeWidth={stroke} fill="none" className="text-surface-200" />
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeWidth={stroke} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="text-accent transition-all duration-500" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center flex-col">{children}</div>
    </div>
  )
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-surface-500">{hint}</span>}
    </label>
  )
}

export function Slider({ value, min, max, step = 1, onChange, suffix }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[rgb(var(--accent))]" />
      <span className="text-xs font-mono w-14 text-end text-surface-700">{value}{suffix}</span>
    </div>
  )
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; icon?: React.ReactNode; onClick?: () => void; danger?: boolean; sep?: boolean }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Don't close when scrolling INSIDE the menu itself (it has overflow-y-auto).
    const s = (e: Event) => { if (ref.current?.contains(e.target as Node)) return; onClose() }
    window.addEventListener('mousedown', h); window.addEventListener('keydown', k); window.addEventListener('resize', s); window.addEventListener('scroll', s, true)
    // Focus first item for keyboard users.
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); window.removeEventListener('resize', s); window.removeEventListener('scroll', s, true) }
  }, [onClose])
  const menuH = Math.min(Math.max(window.innerHeight - 16, 32), items.reduce((a, it) => a + (it.sep ? 9 : 38), 16))
  const menuW = Math.min(320, Math.max(window.innerWidth - 16, 100))
  const left = Math.max(8, Math.min(x, window.innerWidth - menuW - 8)), top = Math.max(8, Math.min(y, window.innerHeight - menuH - 8))
  // Re-clamp after mount: wrapped labels can make the real height larger than the estimate.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`
    if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`
  }, [])
  return (
    <div ref={ref} role="menu" className="fixed z-[95] card p-1.5 min-w-[210px] max-w-[min(320px,calc(100vw-16px))] max-h-[calc(100vh-16px)] overflow-y-auto animate-fade-in" style={{ left, top }}>
      {items.map((it, i) => it.sep ? <div key={i} className="divider my-1" /> : (
        <button key={i} role="menuitem" className={cn('w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-start transition-colors hover:bg-surface-200 min-w-0', it.danger && 'text-rose-500 hover:bg-rose-500/10')} onClick={() => { it.onClick?.(); onClose() }}>
          {it.icon && <span className="text-surface-600 shrink-0">{it.icon}</span>}<span className="min-w-0 flex-1 break-words">{it.label}</span>
        </button>
      ))}
    </div>
  )
}
