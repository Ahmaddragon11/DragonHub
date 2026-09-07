import type { NetPlan, NetDay } from '@shared/types'

// Pure helpers for the Network data-plan feature.
// All sizes in MB unless named otherwise. No I/O, no Date.now — pass `now` in.

const DAY_MS = 86400000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function toDateStr(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Anchor of the current billing cycle as local-midnight ms. Accepts the stored
 *  'YYYY-MM-DD' string (and legacy numeric timestamps) — falls back to today. */
function anchorStart(plan: NetPlan, now: number): number {
  const s: unknown = (plan as { startDate?: unknown }).startDate
  if (typeof s === 'number' && Number.isFinite(s)) return startOfDay(s)
  if (typeof s === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
    if (m) {
      const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
      if (Number.isFinite(t)) return t
    }
  }
  return startOfDay(now)
}

function cleanMB(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

export function cycleBounds(plan: NetPlan, now: number): { start: number; end: number } {
  if (plan.cycle === 'daily') {
    const start = startOfDay(now)
    const e = new Date(start)
    e.setDate(e.getDate() + 1)
    return { start, end: e.getTime() }
  }
  if (plan.cycle === 'monthly') {
    const d = new Date(now)
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    return { start, end }
  }
  if (plan.cycle === 'weekly' || plan.cycle === 'custom') {
    const spanDays = plan.cycle === 'weekly' ? 7 : plan.cycleDays
    if (typeof spanDays !== 'number' || !Number.isFinite(spanDays) || spanDays <= 0) {
      const start = startOfDay(now)
      const e = new Date(start)
      e.setDate(e.getDate() + 1)
      return { start, end: e.getTime() }
    }
    const spanMs = spanDays * DAY_MS
    const anchor = anchorStart(plan, now)
    const idx = Math.floor((now - anchor) / spanMs)
    const start = anchor + idx * spanMs
    return { start, end: start + spanMs }
  }
  const start = startOfDay(now)
  const e = new Date(start)
  e.setDate(e.getDate() + 1)
  return { start, end: e.getTime() }
}

export function dailyAllowanceMB(plan: NetPlan, now: number): number {
  const quota = cleanMB(plan.quotaMB)
  if (quota <= 0) return 0
  if (plan.cycle === 'daily') return round1(quota)
  if (plan.cycle === 'weekly') return round1(quota / 7)
  if (plan.cycle === 'monthly') {
    const d = new Date(now)
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    if (!Number.isFinite(daysInMonth) || daysInMonth <= 0) return 0
    return round1(quota / daysInMonth)
  }
  if (plan.cycle === 'custom') {
    const days = plan.cycleDays
    if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return 0
    return round1(quota / days)
  }
  return 0
}

export function planUsage(
  plan: NetPlan,
  days: NetDay[],
  now: number
): { usedMB: number; quotaMB: number; pct: number; remainingMB: number; daysLeft: number } {
  const { start, end } = cycleBounds(plan, now)
  const startStr = toDateStr(start)
  const endStr = toDateStr(end)
  let usedMB = 0
  for (const d of days) {
    if (!d || typeof d.date !== 'string') continue
    if (d.date < startStr || d.date >= endStr) continue
    usedMB += cleanMB(d.downMB) + cleanMB(d.upMB)
  }
  const quotaMB = cleanMB(plan.quotaMB)
  const pct = quotaMB > 0 ? (usedMB / quotaMB) * 100 : 0
  const remainingMB = Math.max(0, quotaMB - usedMB)
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY_MS))
  return { usedMB, quotaMB, pct, remainingMB, daysLeft }
}

export function effectiveDailyCapMB(plan: NetPlan | null, dailyCapMB: number | null, now: number): number | null {
  if (typeof dailyCapMB === 'number' && Number.isFinite(dailyCapMB)) return dailyCapMB
  if (plan !== null) return dailyAllowanceMB(plan, now)
  return null
}

export function projectDepletion(
  todayTotalMB: number,
  capMB: number | null,
  speedBps: number
): { etaHours: number | null; willExceedToday: boolean } {
  const today = typeof todayTotalMB === 'number' && Number.isFinite(todayTotalMB) ? todayTotalMB : 0
  const hasCap = typeof capMB === 'number' && Number.isFinite(capMB)
  const willExceedToday = hasCap && capMB !== null ? today >= capMB : false
  if (!hasCap || capMB === null) return { etaHours: null, willExceedToday }
  if (typeof speedBps !== 'number' || !Number.isFinite(speedBps) || speedBps <= 0) return { etaHours: null, willExceedToday }
  if (today >= capMB) return { etaHours: null, willExceedToday: true }
  const remainingBytes = (capMB - today) * 1024 * 1024
  const etaHours = remainingBytes / speedBps / 3600
  return { etaHours, willExceedToday: false }
}

export function lastNDays(days: NetDay[], n: number, today: { date: string; downMB: number; upMB: number }): NetDay[] {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return []
  const count = Math.floor(n)
  const byDate = new Map<string, NetDay>()
  for (const d of days) {
    if (!d || typeof d.date !== 'string') continue
    byDate.set(d.date, { ...d })
  }
  byDate.set(today.date, { ...today } as NetDay)
  const merged = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return merged.slice(-count)
}

export function weekTotals(days: NetDay[]): { downMB: number; upMB: number; totalMB: number; avgPerDayMB: number } {
  let downMB = 0
  let upMB = 0
  for (const d of days) {
    if (!d) continue
    downMB += cleanMB(d.downMB)
    upMB += cleanMB(d.upMB)
  }
  const totalMB = downMB + upMB
  const avgPerDayMB = days.length > 0 ? totalMB / days.length : 0
  return { downMB, upMB, totalMB, avgPerDayMB }
}

export function formatMB(mb: number): string {
  if (typeof mb !== 'number' || !Number.isFinite(mb) || mb <= 0) return '0 MB'
  if (mb < 1024) return `${Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}
