import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { BrowserWindow } from 'electron'
import { dataCollections } from './settings'
import {
  DEFAULT_RES_CONFIG,
  DEFAULT_RES_CARD_CONFIG,
  type ResLive,
  type ResConfig,
  type ResCore,
  type ResProcess,
  type ResDiskDrive,
  type ResGpu,
  type ResSourceStatus,
  type ResCardConfig,
} from '../../../src/shared/types'

const execFileP = promisify(execFile)

const RES_CONFIG_KEY = 'resConfig'
const HISTORY_CAP = 300 // 300 samples @2s = 10 minutes of live sparkline data
const MB = 1024 ** 2

export type ResHistoryPoint = { cpu: number; mem: number; downBps: number; upBps: number; at: number }

type NetSpeeds = { downBps: number; upBps: number }
let netSpeedsProvider: () => NetSpeeds = () => ({ downBps: 0, upBps: 0 })
export function setNetSpeedsProvider(fn: () => NetSpeeds): void {
  netSpeedsProvider = fn
}

// ---------- config (tolerant sanitize, same style as netmonitor limits) ----------
function num(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'object') return null
  const n = typeof v === 'string' ? Number(v.trim()) : Number(v)
  return Number.isFinite(n) ? n : null
}

function clampInt(v: unknown, min: number, max: number, fb: number): number {
  const n = num(v)
  return n === null ? fb : Math.round(Math.min(max, Math.max(min, n)))
}

export function getResConfig(): ResConfig {
  let raw: unknown = {}
  try { raw = dataCollections.get<unknown>(RES_CONFIG_KEY, {}) } catch { /* store key rejected — defaults */ }
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_RES_CONFIG
  return {
    enabled: r.enabled === undefined ? d.enabled : r.enabled === true,
    intervalMs: clampInt(r.intervalMs, 1000, 10000, d.intervalMs),
    topN: clampInt(r.topN, 5, 50, d.topN),
    alertCpuPercent: clampInt(r.alertCpuPercent, 10, 100, d.alertCpuPercent),
    alertMemoryPercent: clampInt(r.alertMemoryPercent, 10, 100, d.alertMemoryPercent),
    alertsOn: r.alertsOn === undefined ? d.alertsOn : r.alertsOn === true,
  }
}

export function setResConfig(patch: Partial<ResConfig>): ResConfig {
  const next = { ...getResConfig(), ...(patch && typeof patch === 'object' ? patch : {}) }
  try { dataCollections.set(RES_CONFIG_KEY, next) } catch { /* in-memory only */ }
  // Apply interval change on the next tick.
  if (timer !== null) {
    clearInterval(timer)
    timer = setInterval(() => { void tick() }, next.intervalMs)
  }
  return next
}

// ---------- PowerShell helper (all PS sources degrade gracefully) ----------
let psWorking: boolean | null = null // null = unknown; false = proven broken (non-Windows / missing binary)

/** Absolute System32 tool paths (no PATH-hijack); bare-name fallback for dev hosts. */
function sysBin(name: string): string {
  const abs = `C:\\Windows\\System32\\${name}`
  try {
    if (fs.existsSync(abs)) return abs
  } catch { /* ignore */ }
  try {
    if (process.env.SystemRoot) {
      const cand = path.join(process.env.SystemRoot, 'System32', name)
      if (fs.existsSync(cand)) return cand
    }
  } catch { /* ignore */ }
  return name
}
function powershellBin(): string {
  const abs = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  try {
    if (fs.existsSync(abs)) return abs
  } catch { /* ignore */ }
  try {
    if (process.env.SystemRoot) {
      const cand = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      if (fs.existsSync(cand)) return cand
    }
  } catch { /* ignore */ }
  return 'powershell.exe'
}
/** nvidia-smi: prefer absolute vendor/System32 locations; PATH fallback only
 *  when an absolute candidate (or a which/where hit) proves it exists. */
function nvidiaSmiBin(): string {
  const candidates = [
    'C:\\Windows\\System32\\nvidia-smi.exe',
    'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch { /* ignore */ }
  }
  return 'nvidia-smi'
}

async function ps(command: string, timeoutMs = 10000): Promise<string> {
  if (psWorking === false) throw new Error('PowerShell unavailable')
  const { stdout } = await execFileP(
    powershellBin(),
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true, timeout: timeoutMs, maxBuffer: 6 * 1024 * 1024 },
  )
  psWorking = true
  return stdout
}

function r1(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

// ---------- generic slow-source cache: value + status + background refresh ----------
type SlowSource<T> = {
  value: T | null
  status: ResSourceStatus
  refreshing: boolean
  lastAt: number
  read: () => Promise<T>
  maxAgeMs: number
}

function slowSource<T>(read: () => Promise<T>, maxAgeMs: number): SlowSource<T> {
  return { value: null, status: 'unavailable', refreshing: false, lastAt: 0, read, maxAgeMs }
}

async function refresh<T>(s: SlowSource<T>): Promise<void> {
  if (s.refreshing) return
  if (Date.now() - s.lastAt < s.maxAgeMs) return // value still fresh
  s.refreshing = true
  try {
    s.value = await s.read()
    s.status = 'ok'
    s.lastAt = Date.now()
  } catch {
    // Keep the last known value (may still be useful), mark degraded.
    s.status = s.value !== null ? 'degraded' : 'unavailable'
    s.lastAt = Date.now()
  } finally {
    s.refreshing = false
  }
}

// ---------- CPU sampling (pure JS, always available) ----------
type CoreTimes = { idle: number; total: number }
let prevCoreTimes: CoreTimes[] = []
let cpuTotalPercent = 0
let cores: ResCore[] = []

function cpuTimesSnapshot(): CoreTimes[] {
  return os.cpus().map((c) => {
    const t = c.times
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }
  })
}

function sampleCpu(): void {
  const cur = cpuTimesSnapshot()
  const out: ResCore[] = []
  let sumPercent = 0
  const cpus = os.cpus()
  for (let i = 0; i < cur.length; i++) {
    const p = prevCoreTimes[i]
    const c = cur[i]
    let percent = 0
    if (p && c.total > p.total) {
      const dt = c.total - p.total
      percent = ((dt - (c.idle - p.idle)) / dt) * 100
      if (!Number.isFinite(percent) || percent < 0) percent = 0
    }
    percent = Math.min(100, percent)
    sumPercent += percent
    out.push({ index: i, percent: r1(percent), speedMHz: Math.round(cpus[i]?.speed ?? 0) })
  }
  cores = out
  cpuTotalPercent = cur.length > 0 ? r1(sumPercent / cur.length) : 0
  prevCoreTimes = cur
}

// ---------- slow sources (each degrades gracefully, cached between refreshes) ----------
const temperatureSrc = slowSource<number | null>(async () => {
  const out = await ps('(Get-CimInstance -ClassName MSAcpi_ThermalZoneTemperature | ForEach-Object { "$($_.CurrentTemperature)" })', 8000)
  let best: number | null = null
  for (const line of out.split(/\r?\n/)) {
    const v = num(line.trim())
    if (v === null || v <= 0) continue
    const c = v / 10 - 273.15
    // Plausible die-temperature window: filters reset zones reporting ~0C.
    if (c >= 20 && c <= 120 && (best === null || c > best)) best = r1(c)
  }
  return best
}, 15000)

const pagefileSrc = slowSource<number | null>(async () => {
  const out = await ps('$o = Get-CimInstance Win32_OperatingSystem; "$($o.TotalVirtualMemorySize)|$($o.FreeVirtualMemory)"', 8000)
  const [totalKb, freeKb] = out.trim().split('|').map((x) => num(x))
  if (totalKb === null || freeKb === null || totalKb <= 0) return null
  return r1(((totalKb - freeKb) / totalKb) * 100)
}, 15000)

const diskCapacitySrc = slowSource<ResDiskDrive[]>(async () => {
  const out = await ps("Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { \"$($_.DeviceID)|$($_.VolumeName)|$($_.Size)|$($_.FreeSpace)\" }", 12000)
  const drives: ResDiskDrive[] = []
  for (const line of out.split(/\r?\n/)) {
    const [letter, label, size, free] = line.trim().split('|')
    if (!letter || !/^[A-Za-z]:$/.test(letter)) continue
    const total = num(size) ?? 0
    const freeB = num(free) ?? 0
    if (total <= 0) continue
    drives.push({
      letter: letter.toUpperCase(),
      label: (label ?? '').slice(0, 64),
      totalGB: r1(total / 1024 ** 3),
      freeGB: r1(freeB / 1024 ** 3),
      percentBusy: null,
      readMBs: null,
      writeMBs: null,
    })
  }
  if (drives.length === 0) throw new Error('no logical drives')
  return drives
}, 60000)

const diskActivitySrc = slowSource<Map<string, { busy: number; readMBs: number; writeMBs: number }>>(async () => {
  const out = await ps('Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | ForEach-Object { "$($_.Name)|$($_.PercentDiskTime)|$($_.DiskReadBytesPersec)|$($_.DiskWriteBytesPersec)" }', 10000)
  const map = new Map<string, { busy: number; readMBs: number; writeMBs: number }>()
  for (const line of out.split(/\r?\n/)) {
    const [name, busy, readBps, writeBps] = line.trim().split('|')
    if (!name) continue
    // Names look like "0 C:" — also keep the aggregate "_Total" row.
    const m = /([A-Za-z]):\s*$/.exec(name)
    const entry = {
      busy: Math.min(100, Math.max(0, num(busy) ?? 0)),
      readMBs: r1((num(readBps) ?? 0) / MB),
      writeMBs: r1((num(writeBps) ?? 0) / MB),
    }
    if (m) map.set(m[1].toUpperCase(), entry)
    else if (name.includes('Total')) map.set('total', entry)
  }
  if (map.size === 0) throw new Error('no disk activity counters')
  return map
}, 8000)

let nvidiaSmiBroken = false
const gpuSrc = slowSource<ResGpu | null>(async () => {
  if (nvidiaSmiBroken) throw new Error('nvidia-smi unavailable')
  try {
    const { stdout } = await execFileP(
      nvidiaSmiBin(),
      ['--query-gpu=name,utilization.gpu,memory.total,memory.used,temperature.gpu', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 },
    )
    const line = String(stdout ?? '').trim().split(/\r?\n/)[0] ?? ''
    const [name, util, memTotal, memUsed, temp] = line.split(',').map((x) => x.trim())
    if (!name) throw new Error('nvidia-smi returned nothing')
    return {
      name: name.slice(0, 96),
      percent: num(util),
      memoryTotalMB: num(memTotal),
      memoryUsedMB: num(memUsed),
      temperatureC: num(temp),
    }
  } catch {
    nvidiaSmiBroken = true // never retry inside this session (keeps ticks cheap)
    throw new Error('nvidia-smi unavailable')
  }
}, 5000)

// Generic GPU name fallback (no utilization without vendor tooling).
const gpuNameSrc = slowSource<string | null>(async () => {
  const out = await ps("(Get-CimInstance Win32_VideoController | ForEach-Object { \"$($_.Name)\" })", 8000)
  const line = out.split(/\r?\n/).map((x) => x.trim()).find((x) => x.length > 0)
  if (!line) throw new Error('no gpu name')
  return line.slice(0, 96)
}, 60000)

// ---------- processes (Get-Process, grouped later in renderer) ----------
type ProcRow = { pid: number; name: string; cpuSec: number; wsBytes: number; path: string | null }
const processSrc = slowSource<ProcRow[]>(async () => {
  const out = await ps(
    "Get-Process | ForEach-Object { $cpu = 0; try { $cpu = $_.CPU } catch {}; $ws = 0; try { $ws = $_.WS } catch {}; $p = ''; try { $p = $_.Path } catch {}; \"$($_.Id)|$($_.ProcessName)|$cpu|$ws|$p\" }",
    12000,
  )
  const rows: ProcRow[] = []
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const parts = t.split('|')
    if (parts.length < 5) continue
    const pid = num(parts[0])
    if (pid === null || pid <= 0) continue
    rows.push({
      pid: Math.floor(pid),
      name: (parts[1] || `pid-${pid}`).slice(0, 96),
      cpuSec: Math.max(0, num(parts[2]) ?? 0),
      wsBytes: Math.max(0, num(parts[3]) ?? 0),
      path: (parts[4] || '').slice(0, 1024) || null,
    })
  }
  if (rows.length === 0) throw new Error('no processes')
  return rows
}, 4000)

// Per-PID CPU% derived from cumulative CPU seconds between refreshes.
const prevCpuSec = new Map<number, { sec: number; at: number }>()
let lastProcRows: ProcRow[] = []

function toResProcesses(topN: number): ResProcess[] {
  const now = Date.now()
  const coreCount = Math.max(1, os.cpus().length)
  const out: ResProcess[] = lastProcRows.map((r) => {
    const prev = prevCpuSec.get(r.pid)
    let pct = 0
    if (prev && now > prev.at) {
      const dt = (now - prev.at) / 1000
      const dCpu = Math.max(0, r.cpuSec - prev.sec)
      if (dt > 0) pct = Math.min(100, (dCpu / dt / coreCount) * 100)
    }
    const base = (r.path || '').split(/[\\/]/).pop() || r.name
    return {
      pid: r.pid,
      name: r.name,
      displayName: base.replace(/\.exe$/i, '').slice(0, 64) || r.name,
      cpuPercent: r1(pct),
      cpuCumulativeSec: r1(r.cpuSec),
      memoryMB: r1(r.wsBytes / MB),
      diskReadMBs: null,
      diskWriteMBs: null,
      path: r.path,
    }
  })
  out.sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryMB - a.memoryMB)
  return out.slice(0, Math.min(Math.max(topN, 5), 50))
}

// ---------- snapshot / history / engine ----------
let timer: ReturnType<typeof setInterval> | null = null
let getWinFn: () => BrowserWindow | null = () => null
let getCardFn: () => BrowserWindow | null = () => null
let inFlight = false
let lastSnapshot: ResLive | null = null
const history: ResHistoryPoint[] = []

export function setResWindowProviders(main: () => BrowserWindow | null, card: () => BrowserWindow | null): void {
  getWinFn = main
  getCardFn = card
}

function buildSnapshot(): ResLive {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = Math.max(0, totalMem - freeMem)
  const memPct = totalMem > 0 ? r1((usedMem / totalMem) * 100) : 0
  const speeds = (() => { try { return netSpeedsProvider() } catch { return { downBps: 0, upBps: 0 } } })()

  // Disks: capacity rows merged with activity rows by drive letter.
  let disks: ResDiskDrive[] = []
  let diskStatus: ResSourceStatus = diskCapacitySrc.status
  try {
    const cap = diskCapacitySrc.value ?? []
    const act = diskActivitySrc.value ?? new Map()
    disks = cap.map((d) => {
      const a = act.get(d.letter.replace(':', '').replace(/[^A-Z]/gi, '').toUpperCase())
        ?? act.get(d.letter[0].toUpperCase())
      return { ...d, percentBusy: a?.busy ?? null, readMBs: a?.readMBs ?? null, writeMBs: a?.writeMBs ?? null }
    })
    if (diskActivitySrc.status === 'unavailable' && diskCapacitySrc.status === 'ok') diskStatus = 'degraded'
  } catch { disks = [] }

  // GPU: prefer nvidia-smi full row, else name-only fallback, else null.
  let gpu: ResGpu | null = null
  let gpuStatus: ResSourceStatus = gpuSrc.status
  if (gpuSrc.value) gpu = gpuSrc.value
  else if (gpuNameSrc.value) { gpu = { name: gpuNameSrc.value, percent: null, memoryTotalMB: null, memoryUsedMB: null, temperatureC: null }; gpuStatus = 'degraded' }
  else gpuStatus = 'unavailable'

  const temp = temperatureSrc.value ?? null
  const sources: Record<string, ResSourceStatus> = {
    cpu: cores.length > 0 ? 'ok' : 'degraded',
    temperature: temp !== null ? temperatureSrc.status : 'unavailable',
    memory: 'ok',
    pagefile: pagefileSrc.value !== null ? pagefileSrc.status : (pagefileSrc.status === 'unavailable' ? 'unavailable' : 'degraded'),
    disks: disks.length > 0 ? diskStatus : 'unavailable',
    gpu: gpuStatus,
    network: 'ok',
    processes: lastProcRows.length > 0 ? processSrc.status : 'unavailable',
  }

  return {
    cpuPercent: cpuTotalPercent,
    cores: [...cores],
    temperatureC: temp,
    memoryTotalMB: r1(totalMem / MB),
    memoryUsedMB: r1(usedMem / MB),
    memoryCachedMB: null,
    memoryPercent: memPct,
    pagefilePercent: pagefileSrc.value ?? null,
    disks,
    gpu,
    netDownSpeedBps: Math.max(0, Math.round(speeds.downBps || 0)),
    netUpSpeedBps: Math.max(0, Math.round(speeds.upBps || 0)),
    processesCount: lastProcRows.length,
    sources,
    osUptimeSec: Math.floor(os.uptime()),
    at: Date.now(),
  }
}

async function tick(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const cfg = getResConfig()
    if (!cfg.enabled) return
    sampleCpu()
    await Promise.allSettled([
      refresh(temperatureSrc),
      refresh(pagefileSrc),
      refresh(diskCapacitySrc),
      refresh(diskActivitySrc),
      refresh(gpuSrc),
      refresh(gpuNameSrc),
      refresh(processSrc),
    ])
    if (processSrc.value) {
      const now = Date.now()
      // Keep latest rows; first tick after start yields 0% for all (no baseline yet) — expected.
      lastProcRows = processSrc.value
      for (const r of lastProcRows) {
        if (!prevCpuSec.has(r.pid)) prevCpuSec.set(r.pid, { sec: r.cpuSec, at: now })
      }
      if (prevCpuSec.size > 2000) {
        const alive = new Set(lastProcRows.map((r) => r.pid))
        for (const pid of [...prevCpuSec.keys()]) if (!alive.has(pid)) prevCpuSec.delete(pid)
      }
    }
    const snap = buildSnapshot()
    lastSnapshot = snap
    // Advance CPU baseline markers for next process diff.
    for (const r of lastProcRows) prevCpuSec.set(r.pid, { sec: r.cpuSec, at: snap.at })
    history.push({ cpu: snap.cpuPercent, mem: snap.memoryPercent, downBps: snap.netDownSpeedBps, upBps: snap.netUpSpeedBps, at: snap.at })
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP)
    try { getWinFn()?.webContents.send('res:update', snap) } catch { /* renderer may be hidden */ }
    try { getCardFn()?.webContents.send('res:update', snap) } catch { /* card may be closed */ }
  } catch { /* monitor must never break main */ }
  finally { inFlight = false }
}

export function startResMonitor(
  getWin: () => BrowserWindow | null,
  getCard?: () => BrowserWindow | null,
): void {
  stopResMonitor()
  getWinFn = getWin
  if (getCard) getCardFn = getCard
  prevCoreTimes = cpuTimesSnapshot()
  cores = os.cpus().map((c, i) => ({ index: i, percent: 0, speedMHz: Math.round(c.speed ?? 0) }))
  cpuTotalPercent = 0
  const cfg = getResConfig()
  timer = setInterval(() => { void tick() }, Math.min(Math.max(cfg.intervalMs, 1000), 10000))
  // Perf: the first tick spawns PowerShell/Get-Process (heavy on HDD) — delay it
  // a few seconds so app startup isn't competing for disk/CPU. The Resources
  // page falls back to a local CPU sample until the first tick lands.
  const bootTimer = timer
  setTimeout(() => { if (timer === bootTimer && timer !== null) void tick() }, 4000)
}

export function stopResMonitor(): void {
  if (timer !== null) { clearInterval(timer); timer = null }
}

export function getResSnapshot(): ResLive {
  if (lastSnapshot) return lastSnapshot
  sampleCpu()
  return buildSnapshot()
}

export function getResProcesses(topN?: number): ResProcess[] {
  const n = Math.min(Math.max(Math.floor(Number(topN) || getResConfig().topN), 5), 50)
  return toResProcesses(n)
}

export function getResHistory(): ResHistoryPoint[] {
  return [...history]
}

// ---------- safe process termination (double-confirm in renderer, hard blocks here) ----------
const PROTECTED_NAMES = new Set([
  'system', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'lsaiso',
  'winlogon', 'dwm', 'fontdrvhost', 'memory compression',
  // Shell / task infrastructure: killing these logs the user out or breaks UI.
  'explorer', 'svchost', 'taskhostw', 'taskhost', 'sihost', 'ctfmon', 'dwm',
  // Security stack + common antivirus engines: never terminate from a monitor.
  'msmpeng', 'nissrv', 'windefend', 'securityhealthservice', 'smartscreen',
  'mssense', 'avastsvc', 'avastui', 'avgnt', 'avguard', 'ekrn', 'egui',
  'mcshield', 'mctray', 'bdagent', 'bdservicehost', 'avp', 'kavfs',
  'ccsvchst', 'nortonsecurity', 'sophoshealth', 'sophosui', 'mbamservice',
  'spoolsv',
])

/** Kill rate limit: max 5 terminations per 10s window (mis-click / loop guard). */
const killHits: number[] = []
function checkKillRate() {
  const now = Date.now()
  while (killHits.length && now - killHits[0] > 10_000) killHits.shift()
  if (killHits.length >= 5) throw new Error('Too many process terminations (max 5 per 10s) — wait and retry')
  killHits.push(now)
}

export async function killProcess(pid: number): Promise<{ killed: boolean; pid: number }> {
  const id = Math.floor(Number(pid))
  if (!Number.isFinite(id) || id <= 4) throw new Error('Refusing to terminate a system process')
  if (id === process.pid) throw new Error('Refusing to terminate DragonHub itself')
  checkKillRate()
  const row = lastProcRows.find((r) => r.pid === id)
  const nm = (row?.name || '').toLowerCase().trim()
  // Unknown PID or empty name: refuse (stale/forged IPC PID must never kill blind).
  if (!row || !nm) throw new Error('Refusing to terminate unknown process (not in the recent process list — refresh and retry)')
  if (PROTECTED_NAMES.has(nm)) throw new Error(`Refusing to terminate protected process: ${row?.name}`)
  // Freshness: the list must be <10s old, otherwise the PID may have been reused.
  if (Date.now() - processSrc.lastAt > 10_000) throw new Error('Process list is stale (>10s) — refresh and retry')
  // Liveness: verify the PID still exists before killing (guards PID reuse).
  try {
    process.kill(id, 0)
  } catch {
    throw new Error('Process no longer exists or access denied')
  }
  if (process.platform === 'win32') {
    await execFileP(sysBin('taskkill.exe'), ['/F', '/PID', String(id)], { windowsHide: true, timeout: 10000 })
  } else {
    try { process.kill(id, 'SIGTERM') } catch (e: unknown) { throw new Error(e instanceof Error ? e.message : 'kill failed') }
  }
  return { killed: true, pid: id }
}

// ---------- floating-card config ----------
const CARD_KEY = 'resCardConfig'
export function getResCardConfig(): ResCardConfig {
  try {
    const raw = dataCollections.get<Record<string, unknown>>(CARD_KEY, {}) as Record<string, unknown>
    const d = DEFAULT_RES_CARD_CONFIG
    const clampN = (v: unknown, lo: number, hi: number, fb: number): number => {
      const n = typeof v === 'string' ? Number(v.trim()) : Number(v)
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb
    }
    return {
      size: raw.size === 'small' ? 'small' : 'medium',
      opacity: clampN(raw.opacity, 0.4, 1, d.opacity),
      locked: raw.locked === true,
      x: typeof raw.x === 'number' && Number.isFinite(raw.x) ? Math.round(raw.x) : null,
      y: typeof raw.y === 'number' && Number.isFinite(raw.y) ? Math.round(raw.y) : null,
      showTopProcess: raw.showTopProcess === undefined ? d.showTopProcess : raw.showTopProcess === true,
    }
  } catch {
    return { ...DEFAULT_RES_CARD_CONFIG }
  }
}

export function setResCardConfig(patch: Partial<ResCardConfig>): ResCardConfig {
  const next = { ...getResCardConfig(), ...(patch && typeof patch === 'object' ? patch : {}) }
  try { dataCollections.set(CARD_KEY, next) } catch { /* in-memory only */ }
  return next
}

