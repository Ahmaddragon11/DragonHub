import { describe, it, expect } from 'vitest'
import { dailyAllowanceMB, planUsage, cycleBounds, projectDepletion, lastNDays, formatMB } from './netplan'
import type { NetPlan, NetDay } from '@shared/types'

const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime() // 15 Jan 2026 noon

describe('dailyAllowanceMB', () => {
  it('splits a weekly quota across 7 days', () => {
    expect(dailyAllowanceMB({ id: 'p', name: '', quotaMB: 700, cycle: 'weekly', cycleDays: 7, startDate: '', active: true }, NOW)).toBe(100)
  })
  it('splits a monthly quota across the month length', () => {
    expect(dailyAllowanceMB({ id: 'p', name: '', quotaMB: 310, cycle: 'monthly', cycleDays: 1, startDate: '', active: true }, NOW)).toBe(10) // 31-day Jan
  })
  it('returns 0 for a zero quota', () => {
    expect(dailyAllowanceMB({ id: 'p', name: '', quotaMB: 0, cycle: 'daily', cycleDays: 1, startDate: '', active: true }, NOW)).toBe(0)
  })
})

describe('planUsage', () => {
  it('sums only days inside the current cycle and computes remaining', () => {
    const plan: NetPlan = { id: 'p', name: '', quotaMB: 1000, cycle: 'monthly', cycleDays: 1, startDate: '', active: true }
    const days: NetDay[] = [
      { date: '2026-01-10', downMB: 300, upMB: 100 }, // in cycle
      { date: '2026-01-14', downMB: 200, upMB: 0 },   // in cycle
      { date: '2025-12-31', downMB: 5000, upMB: 0 },  // out of cycle — ignored
    ]
    const u = planUsage(plan, days, NOW)
    expect(u.usedMB).toBe(600)
    expect(u.remainingMB).toBe(400)
    expect(u.pct).toBe(60)
    expect(u.daysLeft).toBeGreaterThan(0)
  })
})

describe('cycleBounds', () => {
  it('daily cycle is exactly one local day', () => {
    const { start, end } = cycleBounds({ id: 'p', name: '', quotaMB: 1, cycle: 'daily', cycleDays: 1, startDate: '', active: true }, NOW)
    expect(end - start).toBe(86400000)
  })
})

describe('projectDepletion', () => {
  it('estimates hours left at current speed', () => {
    // 5MB used of a 10MB cap → 5MB remaining. Speed = 5MB per hour expressed
    // in bytes/s: (5MB)/3600. So remaining/rate = exactly 1 hour.
    const speedBps = (5 * 1024 * 1024) / 3600
    const r = projectDepletion(5, 10, speedBps)
    expect(r.etaHours).toBeCloseTo(1, 1)
    expect(r.willExceedToday).toBe(false)
  })
  it('flags exceeded when already at/over cap', () => {
    expect(projectDepletion(10, 10, 1000).willExceedToday).toBe(true)
  })
  it('no cap → null eta', () => {
    expect(projectDepletion(5, null, 1000).etaHours).toBeNull()
  })
})

describe('lastNDays', () => {
  it('keeps the newest N merged days including today', () => {
    const days: NetDay[] = [
      { date: '2026-01-13', downMB: 1, upMB: 0 },
      { date: '2026-01-14', downMB: 2, upMB: 0 },
    ]
    const out = lastNDays(days, 3, { date: '2026-01-15', downMB: 3, upMB: 0 })
    expect(out.map((d) => d.date)).toEqual(['2026-01-13', '2026-01-14', '2026-01-15'])
  })
})

describe('formatMB', () => {
  it('formats MB vs GB', () => {
    expect(formatMB(512)).toBe('512 MB')
    expect(formatMB(2048)).toBe('2.0 GB')
    expect(formatMB(0)).toBe('0 MB')
  })
})
