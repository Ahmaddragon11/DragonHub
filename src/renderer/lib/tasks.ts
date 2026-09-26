/**
 * Task domain helpers — pure functions shared by Tasks, Dashboard and palette.
 * Keeping recurrence + parsing here avoids logic drift between surfaces.
 */
import type { Task, TaskPriority, TaskStatus } from '@shared/types'
import { uid } from '@/lib/utils'

export const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

export const isOverdue = (k: Task, now = Date.now()) => k.status !== 'done' && !!k.dueDate && k.dueDate < now
export const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
export const endOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x.getTime() }
export const isDueToday = (k: Task, now = new Date()) => k.status !== 'done' && !!k.dueDate && k.dueDate >= startOfDay(now) && k.dueDate <= endOfDay(now)

/** Next occurrence date for a recurring task (month-end safe: Jan 31 → Feb 28). */
export function nextDue(due: number, rule: NonNullable<Task['recurring']>): number {
  const d = new Date(due)
  if (rule === 'daily') d.setDate(d.getDate() + 1)
  else if (rule === 'weekly') d.setDate(d.getDate() + 7)
  else {
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  }
  return d.getTime()
}

/**
 * Moves a task to `status`. Completing a recurring task closes THIS occurrence
 * and spawns the next one as a fresh task, so history is never lost.
 * Returns the new list (or the same list if the id is unknown).
 */
export function moveTask(list: Task[], id: string, status: TaskStatus): { list: Task[]; spawned?: Task } {
  const k = list.find((x) => x.id === id)
  if (!k) return { list }
  const now = Date.now()
  const updated = list.map((x) => (x.id === id ? { ...x, status, updatedAt: now, completedAt: status === 'done' ? now : undefined } : x))
  if (status === 'done' && k.status !== 'done' && k.recurring && k.dueDate) {
    const due = nextDue(k.dueDate, k.recurring)
    const spawned: Task = {
      ...k, id: uid(), status: 'todo', dueDate: due,
      reminderAt: k.reminderAt ? k.reminderAt + (due - k.dueDate) : undefined,
      subtasks: k.subtasks.map((s) => ({ ...s, id: uid(), done: false })),
      createdAt: now, updatedAt: now, completedAt: undefined,
    }
    return { list: updated.concat(spawned), spawned }
  }
  return { list: updated }
}

/* --------------------------------------------------------------------------
 * Smart quick-add:  "Pay rent tomorrow 5pm !high #home"
 *   !low|!med|!medium|!high|!urgent|!1..!4   → priority
 *   #tag                                      → tags
 *   today|tomorrow|tonight|mon..sun|next week|in 3d|in 2w  (+ Arabic basics) → due date
 *   5pm | 17:30 | 9am                          → due time (defaults to 18:00 when only a date is given)
 * ------------------------------------------------------------------------ */
export interface ParsedQuickAdd { title: string; priority?: TaskPriority; tags: string[]; dueDate?: number; tokens: { kind: 'priority' | 'tag' | 'date'; text: string }[] }

const PRIO_MAP: Record<string, TaskPriority> = { low: 'low', l: 'low', '1': 'low', med: 'medium', medium: 'medium', m: 'medium', '2': 'medium', high: 'high', h: 'high', '3': 'high', urgent: 'urgent', u: 'urgent', '4': 'urgent', '!': 'urgent' }
const WEEKDAYS: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  'الأحد': 0, 'الاحد': 0, 'الاثنين': 1, 'الإثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6 }

export function parseQuickAdd(input: string, now = new Date()): ParsedQuickAdd {
  let s = ` ${input} `
  const tokens: ParsedQuickAdd['tokens'] = []
  let priority: TaskPriority | undefined
  const tags: string[] = []
  let day: Date | undefined
  let time: { h: number; m: number } | undefined

  s = s.replace(/\s!(urgent|high|medium|med|low|[1-4hlmu!])(?=\s)/gi, (m, p: string) => { priority = PRIO_MAP[p.toLowerCase()]; tokens.push({ kind: 'priority', text: m.trim() }); return ' ' })
  s = s.replace(/\s#([\p{L}\p{N}_-]{1,32})(?=\s)/gu, (m, tg: string) => { if (!tags.includes(tg)) tags.push(tg); tokens.push({ kind: 'tag', text: m.trim() }); return ' ' })

  const setDay = (d: Date, text: string) => { day = d; tokens.push({ kind: 'date', text: text.trim() }); return ' ' }
  const base = () => new Date(now.getFullYear(), now.getMonth(), now.getDate())
  s = s.replace(/\s(today|tod|اليوم)(?=\s)/i, (m) => setDay(base(), m))
  s = s.replace(/\s(tonight|الليلة)(?=\s)/i, (m) => { time = { h: 20, m: 0 }; return setDay(base(), m) })
  s = s.replace(/\s(tomorrow|tmrw|tmr|غدا|غداً|بكرة|بكره)(?=\s)/i, (m) => { const d = base(); d.setDate(d.getDate() + 1); return setDay(d, m) })
  s = s.replace(/\snext\s+week(?=\s)/i, (m) => { const d = base(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return setDay(d, m) })
  s = s.replace(/\sin\s+(\d{1,3})\s*(d|day|days|w|wk|week|weeks)(?=\s)/i, (m, n: string, u: string) => { const d = base(); d.setDate(d.getDate() + Number(n) * (/^w/i.test(u) ? 7 : 1)); return setDay(d, m) })
  if (!day) {
    s = s.replace(/\s(?:on\s+)?([\p{L}]+)(?=\s)/gu, (m, w: string) => {
      const wd = WEEKDAYS[w.toLowerCase()]
      if (wd === undefined || day) return m
      const d = base(); const diff = (wd - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + diff)
      return setDay(d, m)
    })
  }
  s = s.replace(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (m, h: string, mm: string | undefined, ap: string) => {
    let hh = Number(h) % 12; if (ap.toLowerCase() === 'pm') hh += 12
    time = { h: hh, m: Number(mm || 0) }; tokens.push({ kind: 'date', text: m.trim() }); return ' '
  })
  s = s.replace(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m, h: string, mm: string) => { time = { h: Number(h), m: Number(mm) }; tokens.push({ kind: 'date', text: m.trim() }); return ' ' })

  let dueDate: number | undefined
  if (day || time) {
    const d = day ? new Date(day) : base()
    const t = time ?? { h: 18, m: 0 }
    d.setHours(t.h, t.m, 0, 0)
    // A bare time that already passed today means tomorrow.
    if (!day && d.getTime() < now.getTime()) d.setDate(d.getDate() + 1)
    dueDate = d.getTime()
  }
  const title = s.replace(/\s+/g, ' ').trim()
  return { title, priority, tags, dueDate, tokens }
}
