import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import { dataCollections } from './settings'

const execFileP = promisify(execFile)

export type NetLive = {
  downSpeedBps: number
  upSpeedBps: number
  todayDownMB: number
  todayUpMB: number
  blocked: boolean
  needsAdmin: boolean
  date: string
}

type DayEntry = { date: string; downMB: number; upMB: number }

type NetState = {
  baseDown: number
  baseUp: number
  todayDate: string
  todayDownMB: number
  todayUpMB: number
  days: DayEntry[]
  blockedByCap: boolean
}

  type NetHooks = { onCapExceeded: () => void; onNewDay: (date: string, wasCapBlocked: boolean) => void }

/** Tolerantly-shaped limit/plan records (renderer-owned keys; any field may be missing). */
type NetLimits = { dailyCapMB?: unknown; blockOnCap?: unknown; monitoringEnabled?: unknown }
type NetPlan = Record<string, unknown>

const NET_KEY = 'netState'
const LIMITS_KEY = 'netLimits'
const PLAN_KEY = 'netPlan'
const TICK_MS = 2000
const MAX_DAYS = 90
const BYTES_PER_MB = 1024 * 1024

function num(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'object') return null
  const n = typeof v === 'string' ? Number(v.trim()) : Number(v)
  return Number.isFinite(n) ? n : null
}

function r3(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1000) / 1000
}

export function getTodayKey(): string {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function defaultState(): NetState {
  return { baseDown: 0, baseUp: 0, todayDate: getTodayKey(), todayDownMB: 0, todayUpMB: 0, days: [], blockedByCap: false }
}

function sanitizeState(raw: unknown): NetState {
  const d = defaultState()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const numOr = (v: unknown, fb: number): number => {
    const n = num(v)
    return n === null || n < 0 ? fb : n
  }
  const days: DayEntry[] = []
  if (Array.isArray(r.days)) {
    for (const e of r.days) {
      if (!e || typeof e !== 'object') continue
      const de = e as Record<string, unknown>
      if (typeof de.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(de.date)) continue
      days.push({ date: de.date, downMB: numOr(de.downMB, 0), upMB: numOr(de.upMB, 0) })
    }
  }
  const todayDate =
    typeof r.todayDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.todayDate) ? r.todayDate : d.todayDate
  return {
    baseDown: numOr(r.baseDown, 0),
    baseUp: numOr(r.baseUp, 0),
    todayDate,
    todayDownMB: numOr(r.todayDownMB, 0),
    todayUpMB: numOr(r.todayUpMB, 0),
    days: days.slice(-MAX_DAYS),
    blockedByCap: r.blockedByCap === true,
  }
}

function loadState(): NetState {
  try {
    return sanitizeState(dataCollections.get<NetState | null>(NET_KEY, null))
  } catch {
    return defaultState()
  }
}

function persist(): void {
  try {
    const snap: NetState = {
      baseDown: state.baseDown,
      baseUp: state.baseUp,
      todayDate: state.todayDate,
      todayDownMB: r3(state.todayDownMB),
      todayUpMB: r3(state.todayUpMB),
      days: state.days.map((e) => ({ date: e.date, downMB: r3(e.downMB), upMB: r3(e.upMB) })),
      blockedByCap: state.blockedByCap,
    }
    dataCollections.set(NET_KEY, snap)
  } catch { /* store key may reject writes; in-memory state stays authoritative */ }
}

type Counters = { down: bigint; up: bigint }

/** Primary source: `netstat -e` interface statistics (no admin rights needed).
 *  The `Bytes` label is locale-dependent, so lines without any letters are
 *  also accepted positionally (two trailing numbers). */
async function readNetstat(): Promise<Counters> {
  const { stdout } = await execFileP('netstat', ['-e'], { windowsHide: true, timeout: 5000 })
  let down = 0n
  let up = 0n
  let hits = 0
  for (const line of stdout.split(/\r?\n/)) {
    let m = /^\s*Bytes\s+(\d+)\s+(\d+)\s*$/.exec(line)
    if (!m && !/[A-Za-z\u0080-\uFFFF]/.test(line)) m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (!m) continue
    down += BigInt(m[1])
    up += BigInt(m[2])
    hits += 1
  }
  if (!hits) throw new Error('netstat -e returned no usable counters')
  return { down, up }
}

/** Fallback source: per-adapter statistics summed across all adapters. */
async function readNetAdapterStats(): Promise<Counters> {
  const { stdout } = await execFileP(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-NetAdapterStatistics | ForEach-Object { "$($_.ReceivedBytes) $($_.SentBytes)" }'],
    { windowsHide: true, timeout: 8000 },
  )
  let down = 0n
  let up = 0n
  let hits = 0
  for (const line of stdout.split(/\r?\n/)) {
    if (/[A-Za-z\u0080-\uFFFF]/.test(line)) continue
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (!m) continue
    down += BigInt(m[1])
    up += BigInt(m[2])
    hits += 1
  }
  if (!hits) throw new Error('Get-NetAdapterStatistics returned no counters')
  return { down, up }
}

async function readCounters(): Promise<Counters> {
  try {
    return await readNetstat()
  } catch (e1) {
    try {
      return await readNetAdapterStats()
    } catch (e2) {
      const a = e1 instanceof Error ? e1.message : String(e1)
      const b = e2 instanceof Error ? e2.message : String(e2)
      throw new Error(`Network counters unavailable (netstat: ${a}; Get-NetAdapterStatistics: ${b})`)
    }
  }
}

function readKey<T>(key: string): T | null {
  try {
    return dataCollections.get<T | null>(key, null) ?? null
  } catch {
    return null
  }
}

/** Plan-derived daily allowance in MB (daily quota; weekly/7; monthly/calendar-days; custom/cycleDays). */
function planDailyAllowanceMB(plan: NetPlan | null): number | null {
  if (!plan || typeof plan !== 'object') return null
  const quota = num(plan['quotaMB'] ?? plan['quota'] ?? plan['limitMB'] ?? plan['capMB'] ?? plan['totalMB'])
  if (quota === null || quota <= 0) return null
  const period = String(plan['period'] ?? plan['cycle'] ?? plan['frequency'] ?? plan['interval'] ?? 'daily').toLowerCase()
  if (period.includes('week')) return quota / 7
  if (period.includes('month')) {
    const d = new Date()
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    if (!Number.isFinite(daysInMonth) || daysInMonth <= 0) return null
    return quota / daysInMonth
  }
  if (period.includes('custom') || period.includes('cycle')) {
    const cycleDays = num(plan['cycleDays'] ?? plan['days'] ?? plan['periodDays'] ?? plan['cycleLengthDays'])
    if (cycleDays === null || cycleDays <= 0) return null
    return quota / cycleDays
  }
  return quota
}

function effectiveDailyCapMB(limits: NetLimits | null, plan: NetPlan | null): number | null {
  const direct = limits ? num(limits.dailyCapMB) : null
  if (direct !== null) return direct
  return planDailyAllowanceMB(plan)
}

let state: NetState = loadState()
let timer: ReturnType<typeof setInterval> | null = null
let getWinFn: () => BrowserWindow | null = () => null
let hooks: NetHooks = {
  onCapExceeded() { /* set via setNetHooks */ },
  onNewDay() { /* set via setNetHooks */ },
}
let blockedFlagProvider: () => boolean = () => false
let manualBlocked = false
let lastNeedsAdmin = false

/** Mirror of blocks applied through IPC (manual or UI). Kept separate from the
 *  cap flag so midnight restore only ever clears cap-triggered blocks. */
export function setManualBlocked(v: boolean): void {
  manualBlocked = v
}

/** Last admin/elevation outcome, so the UI warning survives the next poll. */
export function setLastNeedsAdmin(v: boolean): void {
  lastNeedsAdmin = v
}

/** Clear a cap-triggered block flag (used when blocking is disabled or the
 *  block attempt failed — keeps the UI honest and allows a later retry). */
export function clearCapBlock(): void {
  if (state.blockedByCap) {
    state.blockedByCap = false
    persist()
  }
}
let prevDown = BigInt(Math.floor(state.baseDown))
let prevUp = BigInt(Math.floor(state.baseUp))
let prevAt = 0
let primed = false
let downSpeedBps = 0
let upSpeedBps = 0

export function setNetHooks(h: { onCapExceeded: () => void; onNewDay: (date: string, wasCapBlocked: boolean) => void }): void {
  hooks = { onCapExceeded: h.onCapExceeded, onNewDay: h.onNewDay }
}

export function setBlockedFlagProvider(fn: () => boolean): void {
  blockedFlagProvider = fn
}

function emit(win: BrowserWindow | null, live: NetLive): void {
  win?.webContents.send('net:update', live)
}

/** Archive the finished day, reset today's counters, and notify. Runs on every tick. */
function rolloverIfNeeded(): void {
  const today = getTodayKey()
  if (state.todayDate === today) return
  // Capture BEFORE clearing: the onNewDay hook needs to know whether a
  // cap-triggered block was active so it can lift it for the fresh day.
  const wasCapBlocked = state.blockedByCap
  const finished: DayEntry = { date: state.todayDate, downMB: r3(state.todayDownMB), upMB: r3(state.todayUpMB) }
  const idx = state.days.findIndex((d) => d.date === finished.date)
  if (idx >= 0) {
    state.days[idx] = {
      date: finished.date,
      downMB: r3(state.days[idx].downMB + finished.downMB),
      upMB: r3(state.days[idx].upMB + finished.upMB),
    }
  } else {
    state.days.push(finished)
  }
  if (state.days.length > MAX_DAYS) state.days = state.days.slice(-MAX_DAYS)
  state.todayDate = today
  state.todayDownMB = 0
  state.todayUpMB = 0
  state.blockedByCap = false
  persist()
  hooks.onNewDay(today, wasCapBlocked)
}

function enforceCap(capMB: number | null, shouldBlock: boolean): void {
  if (capMB === null || capMB <= 0 || state.blockedByCap) return
  if (state.todayDownMB + state.todayUpMB >= capMB) {
    // When auto-block is disabled we only report progress (renderer side) and
    // never latch the blocked flag.
    if (!shouldBlock) return
    state.blockedByCap = true
    persist()
    hooks.onCapExceeded()
  }
}

async function sample(): Promise<void> {
  const now = Date.now()
  const cur = await readCounters()
  if (!primed) {
    // First successful read after start: establish the baseline without
    // attributing pre-start traffic to today.
    prevDown = cur.down
    prevUp = cur.up
    prevAt = now
    primed = true
    state.baseDown = Number(cur.down)
    state.baseUp = Number(cur.up)
    return
  }
  // Counter reset/reboot (new < old): rebase silently, count nothing.
  const dDown = cur.down >= prevDown ? Number(cur.down - prevDown) : 0
  const dUp = cur.up >= prevUp ? Number(cur.up - prevUp) : 0
  const dt = prevAt > 0 ? (now - prevAt) / 1000 : 0
  if (dt > 0) {
    downSpeedBps = dDown / dt
    upSpeedBps = dUp / dt
  } else {
    downSpeedBps = 0
    upSpeedBps = 0
  }
  prevDown = cur.down
  prevUp = cur.up
  prevAt = now
  state.baseDown = Number(cur.down)
  state.baseUp = Number(cur.up)
  state.todayDownMB += dDown / BYTES_PER_MB
  state.todayUpMB += dUp / BYTES_PER_MB
}

// Overlap guard: a slow PowerShell fallback (8s) must never race the 2s tick.
let inFlight = false

async function tick(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    rolloverIfNeeded()
    const limits = readKey<NetLimits>(LIMITS_KEY)
    if (limits && limits.monitoringEnabled === false) {
      downSpeedBps = 0
      upSpeedBps = 0
    } else {
      try {
        await sample()
      } catch { /* keep last known speeds; retry next tick */ }
      enforceCap(effectiveDailyCapMB(limits, readKey<NetPlan>(PLAN_KEY)), limits?.blockOnCap === true)
    }
    persist()
    emit(getWinFn(), getLiveState())
  } catch { /* the monitor must never break the main process */ }
  finally {
    inFlight = false
  }
}

export function startNetMonitor(getWin: () => BrowserWindow | null): void {
  stopNetMonitor()
  state = loadState()
  getWinFn = getWin
  primed = false
  prevDown = BigInt(Math.floor(state.baseDown))
  prevUp = BigInt(Math.floor(state.baseUp))
  prevAt = 0
  downSpeedBps = 0
  upSpeedBps = 0
  timer = setInterval(() => {
    void tick()
  }, TICK_MS)
  void tick()
}

export function stopNetMonitor(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

export function getLiveState(): NetLive {
  let blocked = state.blockedByCap || manualBlocked
  try {
    blocked = blockedFlagProvider() || manualBlocked || state.blockedByCap
  } catch {
    blocked = state.blockedByCap || manualBlocked
  }
  return {
    downSpeedBps,
    upSpeedBps,
    todayDownMB: r3(state.todayDownMB),
    todayUpMB: r3(state.todayUpMB),
    blocked,
    needsAdmin: lastNeedsAdmin,
    date: state.todayDate,
  }
}

/** Oldest → newest, including today as the last element. */
export function getHistory(days: number): { date: string; downMB: number; upMB: number }[] {
  const n = Math.floor(Number(days))
  if (!Number.isFinite(n) || n <= 0) return []
  const today: DayEntry = { date: state.todayDate, downMB: r3(state.todayDownMB), upMB: r3(state.todayUpMB) }
  if (n === 1) return [today]
  const stored = state.days
    .filter((d) => d.date !== state.todayDate)
    .slice(-(n - 1))
    .map((d) => ({ date: d.date, downMB: r3(d.downMB), upMB: r3(d.upMB) }))
  return [...stored, today]
}
