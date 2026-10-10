import { describe, it, expect } from 'vitest'
import { parseQuickAdd, moveTask, nextDue, isOverdue, isDueToday } from './tasks'
import type { Task } from '@shared/types'

const NOW = new Date(2026, 0, 15, 12, 0, 0) // Thu 15 Jan 2026, 12:00 local

function task(overrides: Partial<Task> = {}): Task {
  return { id: 't1', title: 'T', description: '', status: 'todo', priority: 'medium', tags: [], subtasks: [], createdAt: 0, updatedAt: 0, order: 0, ...overrides }
}

describe('parseQuickAdd', () => {
  it('extracts priority, tag and due date/time', () => {
    const r = parseQuickAdd('Pay rent tomorrow 5pm !high #home', NOW)
    expect(r.title).toBe('Pay rent')
    expect(r.priority).toBe('high')
    expect(r.tags).toEqual(['home'])
    expect(r.dueDate).toBeDefined()
    const d = new Date(r.dueDate!)
    expect(d.getDate()).toBe(16)
    expect(d.getHours()).toBe(17) // 5pm
  })

  it('maps numeric + alias priorities', () => {
    expect(parseQuickAdd('x !1', NOW).priority).toBe('low')
    expect(parseQuickAdd('x !4', NOW).priority).toBe('urgent')
    expect(parseQuickAdd('x !med', NOW).priority).toBe('medium')
  })

  it('understands Arabic relative days', () => {
    const r = parseQuickAdd('مكالمة غدا', NOW)
    expect(r.title).toBe('مكالمة')
    expect(r.dueDate).toBeDefined()
    expect(new Date(r.dueDate!).getDate()).toBe(16)
  })

  it('defaults bare date to 18:00', () => {
    const r = parseQuickAdd('Ship today', NOW)
    expect(new Date(r.dueDate!).getHours()).toBe(18)
  })

  it('rolls a passed bare time to tomorrow', () => {
    const r = parseQuickAdd('call at 9am', NOW) // 9am already passed at noon
    const d = new Date(r.dueDate!)
    expect(d.getDate()).toBe(16)
    expect(d.getHours()).toBe(9)
  })

  it('collects multiple tags without duplicates', () => {
    const r = parseQuickAdd('plan #work #work #home', NOW)
    expect(r.tags).toEqual(['work', 'home'])
  })
})

describe('moveTask + recurrence', () => {
  it('completing a recurring task spawns the next occurrence and preserves history', () => {
    const base = task({ id: 'a', recurring: 'daily', dueDate: NOW.getTime() })
    const { list, spawned } = moveTask([base], 'a', 'done')
    expect(list[0].status).toBe('done')
    expect(spawned).toBeDefined()
    expect(spawned!.status).toBe('todo')
    expect(spawned!.id).not.toBe('a')
    expect(spawned!.dueDate).toBe(nextDue(base.dueDate!, 'daily'))
  })

  it('non-recurring completion does not spawn', () => {
    const { list, spawned } = moveTask([task({ id: 'a', dueDate: NOW.getTime() })], 'a', 'done')
    expect(list).toHaveLength(1)
    expect(spawned).toBeUndefined()
  })
})

describe('nextDue month-end safety', () => {
  it('Jan 31 → Feb 28/29', () => {
    const jan31 = new Date(2026, 0, 31, 10, 0, 0).getTime()
    const d = new Date(nextDue(jan31, 'monthly'))
    expect(d.getMonth()).toBe(1) // February
    expect(d.getDate()).toBe(28) // 2026 is not a leap year
  })
})

describe('overdue / due-today', () => {
  it('overdue ignores done tasks', () => {
    expect(isOverdue(task({ status: 'todo', dueDate: NOW.getTime() - 1000 }), NOW.getTime())).toBe(true)
    expect(isOverdue(task({ status: 'done', dueDate: NOW.getTime() - 1000 }), NOW.getTime())).toBe(false)
    expect(isOverdue(task({ status: 'todo' }), NOW.getTime())).toBe(false)
  })
  it('due-today bounds to the local day', () => {
    expect(isDueToday(task({ status: 'todo', dueDate: NOW.getTime() }), NOW)).toBe(true)
    expect(isDueToday(task({ status: 'todo', dueDate: NOW.getTime() + 86400000 }), NOW)).toBe(false)
  })
})
