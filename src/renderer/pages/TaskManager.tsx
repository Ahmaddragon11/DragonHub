import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity, Search, RefreshCw, Cpu, MemoryStick, HardDrive, MonitorCog, Network,
  ShieldAlert, ChevronDown, ChevronRight, List, Layers, AppWindow, X,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useApp } from '@/store'
import { PageHeader, Progress, Empty, Toggle, Skeleton, Segmented } from '@/components/ui'
import { invoke, on, errorMessage } from '@/lib/api'
import { formatBytes, cn } from '@/lib/utils'
import type { ResLive, ResProcess, ResHistoryPoint } from '@shared/types'

const TOP_N = 40
const POLL_PROCS_MS = 3000
const POLL_HIST_MS = 5000

const SYS_NAMES = new Set([
  'system', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'lsaiso',
  'winlogon', 'dwm', 'fontdrvhost', 'memory compression', 'idle', 'secure system',
])

type Tab = 'processes' | 'performance'
type SortKey = 'name' | 'pid' | 'cpu' | 'mem' | 'time'
type GroupMode = 'none' | 'app' | 'type'
type ProgressTone = 'accent' | 'success' | 'danger'

function isProtected(p: ResProcess): boolean {
  return p.pid <= 4 || SYS_NAMES.has((p.name || '').toLowerCase())
}

function formatCpuTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '—'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h ${m}m ${r}s`
  if (m > 0) return `${m}m ${r}s`
  return `${r}s`
}

function formatSpeed(bps: number): string {
  if (!isFinite(bps) || bps <= 0) return '0 B/s'
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`
}

function formatUptime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function series(hist: ResHistoryPoint[], key: 'cpu' | 'mem'): number[] {
  return hist.map((h) => (Number.isFinite(h[key]) ? h[key] : 0))
}

function diskBusy(disks: ResLive['disks']): number {
  return disks.reduce((m, d) => Math.max(m, d.percentBusy ?? 0), 0)
}

/* ======================================================================== *
 *  Charts
 * ======================================================================== */

type TrendSeries = { data: number[]; stroke: string }

/** Inline-SVG multi-series trend with a 0..max y axis, grid lines, axis labels
 *  and a pointer hover readout. Memoised so an unrelated parent re-render does
 *  not redraw the path. */
const TrendChart = React.memo(function TrendChart({ series, max = 100, h = 140, suffix = '%', formatValue, ariaLabel }: {
  series: TrendSeries[]; max?: number; h?: number; suffix?: string; formatValue?: (v: number) => string; ariaLabel: string
}) {
  const w = 600
  const top = 10, bottom = 22, left = 38, right = 12
  const iw = Math.max(1, w - left - right)
  const ih = Math.max(1, h - top - bottom)
  const len = series.reduce((m, s) => Math.max(m, s.data.length), 0)
  const hi = max > 0 ? max : Math.max(1, ...series.flatMap((s) => s.data))
  const fmt = formatValue ?? ((v: number) => `${v.toFixed(0)}${suffix}`)
  const xAt = (i: number) => (len <= 1 ? left : left + (i / (len - 1)) * iw)
  const yAt = (v: number) => top + ih - (Math.min(Math.max(v, 0), hi) / hi) * ih
  const baseY = (top + ih).toFixed(1)
  const [hover, setHover] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const el = ref.current
    if (!el || len < 2) return
    const r = el.getBoundingClientRect()
    const rel = (e.clientX - r.left) / Math.max(1, r.width)
    setHover(Math.max(0, Math.min(len - 1, Math.round(rel * (len - 1)))))
  }
  const hv = hover ?? len - 1
  const desc = ariaLabel
  const tipPct = Math.min(94, Math.max(6, (xAt(hv) / w) * 100))
  return (
    <div className="relative min-w-0" dir="ltr">
      <svg ref={ref} width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
        role="img" aria-label={desc} style={{ direction: 'ltr', display: 'block' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <title>{desc}</title>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line key={`vx${g}`} x1={left + g * iw} x2={left + g * iw} y1={top} y2={top + ih}
            stroke="rgb(var(--surface-300))" strokeWidth="1" strokeDasharray="2 4" opacity="0.5" />
        ))}
        {[0, 0.5, 1].map((tick) => (
          <g key={tick}>
            <line x1={left} x2={left + iw} y1={yAt(tick * hi)} y2={yAt(tick * hi)} stroke="rgb(var(--surface-300))" strokeWidth="1" />
            <text x={left - 6} y={yAt(tick * hi) + 3} textAnchor="end" fontSize="9" fill="rgb(var(--surface-500))">{fmt(tick * hi)}</text>
          </g>
        ))}
        {series.map((s, si) => {
          const line = s.data.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ')
          const area = s.data.length > 1 ? `${left},${baseY} ${line} ${(left + iw).toFixed(1)},${baseY}` : ''
          const last = s.data.length - 1
          return (
            <g key={si}>
              {si === 0 && area && <polygon points={area} fill={s.stroke} fillOpacity="0.12" />}
              {line && <polyline points={line} fill="none" stroke={s.stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
              {hover === null && last >= 0 && <circle cx={xAt(last)} cy={yAt(s.data[last])} r="3" fill={s.stroke} vectorEffect="non-scaling-stroke" />}
            </g>
          )
        })}
        {hover !== null && (
          <g>
            <line x1={xAt(hv)} x2={xAt(hv)} y1={top} y2={top + ih} stroke="rgb(var(--surface-500))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {series.map((s, si) => (s.data[hv] !== undefined
              ? <circle key={si} cx={xAt(hv)} cy={yAt(s.data[hv])} r="3.5" fill={s.stroke} stroke="rgb(var(--surface-100))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              : null))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md bg-surface-900 px-2 py-1 text-[10px] font-mono leading-4 text-surface-50 shadow-e2"
          style={{ left: `${tipPct}%` }}>
          {series.map((s, si) => (<span key={si} className="block" style={{ color: s.stroke }}>{fmt(s.data[hv] ?? 0)}</span>))}
        </div>
      )}
    </div>
  )
})

/* ======================================================================== *
 *  Shared primitives (kept local — this page owns its own small building blocks)
 * ======================================================================== */

function ChartCard({ icon, title, extra, children }: {
  icon: React.ReactNode; title: string; extra?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className="card p-4 min-w-0 flex flex-col gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="grid place-items-center h-7 w-7 shrink-0 rounded-lg bg-accent/12 text-accent [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <h3 className="font-semibold text-sm flex-1 min-w-0 truncate">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  )
}

function SummaryTile({ icon, label, value, sub, meter, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; meter?: number; tone?: ProgressTone
}) {
  return (
    <div className="card px-3 py-2.5 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] opacity-60 min-w-0">
        <span className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2 min-w-0">
        <span className="text-base font-bold font-mono tabular-nums truncate" dir="ltr">{value}</span>
        {sub && <span className="text-[10px] font-mono opacity-55 truncate" dir="ltr">{sub}</span>}
      </div>
      {meter !== undefined ? <div className="mt-1.5"><Progress value={meter} tone={tone} /></div> : <div className="mt-1.5 h-1.5" aria-hidden />}
    </div>
  )
}

const SummaryBar = React.memo(function SummaryBar({ snap }: { snap: ResLive | null }) {
  const { t } = useTranslation()
  if (!snap) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[70px] w-full rounded-2xl" />)}
      </div>
    )
  }
  const busy = diskBusy(snap.disks)
  const usedGB = snap.disks.reduce((n, d) => n + Math.max(0, d.totalGB - d.freeGB), 0)
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
      <SummaryTile icon={<Cpu />} label={t('taskManager.col.cpu')} value={`${snap.cpuPercent.toFixed(0)}%`}
        meter={snap.cpuPercent} tone={snap.cpuPercent >= 90 ? 'danger' : undefined}
        sub={snap.temperatureC !== null ? `${snap.temperatureC.toFixed(0)}°C` : undefined} />
      <SummaryTile icon={<MemoryStick />} label={t('taskManager.col.mem')} value={`${snap.memoryPercent.toFixed(0)}%`}
        meter={snap.memoryPercent} tone={snap.memoryPercent >= 90 ? 'danger' : 'success'}
        sub={`${formatBytes(snap.memoryUsedMB * 1024 * 1024)} / ${formatBytes(snap.memoryTotalMB * 1024 * 1024)}`} />
      <SummaryTile icon={<HardDrive />} label={t('res.disk')} value={`${busy.toFixed(0)}%`}
        meter={busy} tone={busy >= 90 ? 'danger' : undefined}
        sub={`${formatBytes(usedGB * 1024 ** 3)} ${t('taskManager.used')}`} />
      <SummaryTile icon={<Network />} label={t('taskManager.network')} value={`↓ ${formatSpeed(snap.netDownSpeedBps)}`}
        sub={`↑ ${formatSpeed(snap.netUpSpeedBps)}`} />
      <SummaryTile icon={<Activity />} label={t('res.processes')} value={String(snap.processesCount)}
        sub={`${t('res.uptime')} ${formatUptime(snap.osUptimeSec)}`} />
    </div>
  )
})

/* ======================================================================== *
 *  Process table pieces
 * ======================================================================== */

function SortHeader({ k, label, active, dir, onSort }: {
  k: SortKey; label: string; active: boolean; dir: 1 | -1; onSort: (k: SortKey) => void
}) {
  return (
    <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-surface-900">
      {label}
      <span aria-hidden className={cn('text-[9px] transition-opacity', active ? 'opacity-80' : 'opacity-0')}>{dir === 1 ? '▲' : '▼'}</span>
    </button>
  )
}

const ROW_CELL = '[&>td]:border-b [&>td]:border-[color:var(--hairline)]'

const ProcRow = React.memo(function ProcRow({ p, cpuScale, memScale, killing, zebra, onKill, labels }: {
  p: ResProcess; cpuScale: number; memScale: number; killing: boolean; zebra: boolean
  onKill: (p: ResProcess) => void
  labels: { end: string; hint: string; blocked: string; protectedTag: string }
}) {
  const locked = isProtected(p)
  return (
    <tr className={cn('transition-colors hover:bg-surface-200/70', zebra && 'bg-surface-200/25', ROW_CELL)}>
      <td className="px-3 py-2 max-w-[280px]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="font-medium truncate" title={p.path || p.name}>{p.displayName}</div>
            <div className="text-[10px] opacity-50 truncate font-mono" dir="ltr">{p.path || p.name}</div>
          </div>
          {locked && <span className="badge bg-surface-300/70 text-surface-600 shrink-0">{labels.protectedTag}</span>}
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-end" dir="ltr">{p.pid}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="flex-1 min-w-0"><Progress value={(p.cpuPercent / cpuScale) * 100} /></div>
          <span className="text-xs font-mono w-12 shrink-0 text-end tabular-nums" dir="ltr">{p.cpuPercent.toFixed(1)}%</span>
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="flex-1 min-w-0"><Progress value={(p.memoryMB / memScale) * 100} tone="success" /></div>
          <span className="text-xs font-mono w-20 shrink-0 text-end tabular-nums" dir="ltr">{formatBytes(p.memoryMB * 1024 * 1024)}</span>
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs opacity-70 whitespace-nowrap text-end tabular-nums" dir="ltr">{formatCpuTime(p.cpuCumulativeSec)}</td>
      <td className="px-3 py-2 text-end">
        <button
          type="button"
          className="btn-danger btn-sm"
          disabled={locked || killing}
          title={locked ? labels.blocked : labels.hint}
          onClick={() => onKill(p)}
        >
          <ShieldAlert size={13} /> {labels.end}
        </button>
      </td>
    </tr>
  )
})

/* ======================================================================== *
 *  Page
 * ======================================================================== */

export default function TaskManager() {
  const { t } = useTranslation()
  const { toast } = useApp(useShallow((s) => ({ toast: s.toast })))
  const [tab, setTab] = useState<Tab>('processes')
  const [snap, setSnap] = useState<ResLive | null>(null)
  const [procs, setProcs] = useState<ResProcess[]>([])
  const [hist, setHist] = useState<ResHistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [killing, setKilling] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [hideSys, setHideSys] = useState(true)
  const [group, setGroup] = useState<GroupMode>('none')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('cpu')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const aliveRef = useRef(true)

  useEffect(() => () => { aliveRef.current = false }, [])

  const applyProcs = useCallback((v: ResProcess[]) => {
    if (aliveRef.current && Array.isArray(v)) setProcs(v)
  }, [])

  // First paint.
  useEffect(() => {
    let alive = true
    Promise.all([
      invoke<ResLive>('res:snapshot'),
      invoke<ResProcess[]>('res:processes', TOP_N),
      invoke<ResHistoryPoint[]>('res:history'),
    ])
      .then(([s, p, h]) => {
        if (!alive) return
        setSnap(s)
        setProcs(Array.isArray(p) ? p : [])
        setHist(Array.isArray(h) ? h : [])
      })
      .catch((e: unknown) => { if (alive) toast(errorMessage(e, t('toast.error')), 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [t, toast])

  // Live snapshot stream (~2s tick in main).
  useEffect(() => on<ResLive>('res:update', (s) => { if (s) setSnap(s) }), [])

  // Heavier PowerShell-backed process list.
  useEffect(() => {
    const id = setInterval(() => {
      invoke<ResProcess[]>('res:processes', TOP_N).then(applyProcs).catch(() => { /* keep last */ })
    }, POLL_PROCS_MS)
    return () => clearInterval(id)
  }, [applyProcs])

  useEffect(() => {
    const id = setInterval(() => {
      invoke<ResHistoryPoint[]>('res:history').then((h) => { if (aliveRef.current && Array.isArray(h)) setHist(h) }).catch(() => { /* keep last */ })
    }, POLL_HIST_MS)
    return () => clearInterval(id)
  }, [])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const [p, h] = await Promise.all([
        invoke<ResProcess[]>('res:processes', TOP_N),
        invoke<ResHistoryPoint[]>('res:history'),
      ])
      if (!aliveRef.current) return
      if (Array.isArray(p)) setProcs(p)
      if (Array.isArray(h)) setHist(h)
    } catch (e: unknown) {
      if (aliveRef.current) toast(errorMessage(e, t('toast.error')), 'error')
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }, [t, toast])

  const killProc = useCallback(async (p: ResProcess) => {
    if (isProtected(p)) { toast(t('taskManager.killBlocked'), 'error'); return }
    setKilling(p.pid)
    try {
      const ok1 = await invoke<boolean>('dialog:confirm', t('taskManager.killConfirm1', { name: p.displayName, pid: p.pid }), t('taskManager.killHint'))
      if (!ok1) return
      const ok2 = await invoke<boolean>('dialog:confirm', t('taskManager.killConfirm2'))
      if (!ok2) return
      await invoke('res:killProcess', p.pid)
      toast(t('taskManager.killDone'), 'success')
      await refresh()
    } catch (e: unknown) {
      if (aliveRef.current) toast(errorMessage(e, t('toast.error')), 'error')
    } finally {
      if (aliveRef.current) setKilling(null)
    }
  }, [t, toast, refresh])

  const toggleSort = useCallback((k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === -1 ? 1 : -1))
    else { setSortKey(k); setSortDir(k === 'name' ? 1 : -1) }
  }, [sortKey])

  const ariaSort = (k: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === k ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /* ---- Derived data ---- */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = procs.filter((p) => {
      if (hideSys && isProtected(p)) return false
      if (q && !`${p.displayName} ${p.name} ${p.pid}`.toLowerCase().includes(q)) return false
      return true
    })
    const key = (p: ResProcess): number | string => sortKey === 'cpu' ? p.cpuPercent
      : sortKey === 'mem' ? p.memoryMB
      : sortKey === 'pid' ? p.pid
      : sortKey === 'time' ? p.cpuCumulativeSec
      : p.displayName.toLowerCase()
    return [...rows].sort((a, b) => {
      const va = key(a), vb = key(b)
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : (va as number) - (vb as number)
      return cmp * sortDir
    })
  }, [procs, query, hideSys, sortKey, sortDir])

  interface ProcGroup { key: string; title: string; system: boolean; rows: ResProcess[]; cpu: number; mem: number }
  const groups = useMemo<ProcGroup[]>(() => {
    if (group === 'none') return [{ key: 'all', title: '', system: false, rows: filtered, cpu: 0, mem: 0 }]
    const map = new Map<string, ProcGroup>()
    const sysTitle = t('taskManager.system')
    const userTitle = t('taskManager.apps')
    for (const p of filtered) {
      const sys = isProtected(p)
      const key = group === 'app' ? `app:${p.displayName.toLowerCase()}` : (sys ? 'type:sys' : 'type:user')
      let g = map.get(key)
      if (!g) { g = { key, title: group === 'app' ? p.displayName : (sys ? sysTitle : userTitle), system: sys, rows: [], cpu: 0, mem: 0 }; map.set(key, g) }
      g.rows.push(p)
      g.cpu += p.cpuPercent
      g.mem += p.memoryMB
    }
    const list = [...map.values()]
    if (group === 'type') list.sort((a, b) => Number(a.system) - Number(b.system))
    return list
  }, [filtered, group, t])

  const cpuScale = useMemo(() => Math.max(1, ...procs.map((p) => p.cpuPercent)), [procs])
  const memScale = useMemo(() => Math.max(1, ...procs.map((p) => p.memoryMB)), [procs])

  const cpuSeries = useMemo(() => series(hist, 'cpu'), [hist])
  const memSeries = useMemo(() => series(hist, 'mem'), [hist])
  const netDownSeries = useMemo(() => hist.map((h) => (Number.isFinite(h.downBps) ? h.downBps : 0)), [hist])
  const netUpSeries = useMemo(() => hist.map((h) => (Number.isFinite(h.upBps) ? h.upBps : 0)), [hist])
  const netScale = useMemo(() => Math.max(1024, ...netDownSeries, ...netUpSeries), [netDownSeries, netUpSeries])

  const cpuChart = useMemo<TrendSeries[]>(() => [{ data: cpuSeries, stroke: 'rgb(var(--accent))' }], [cpuSeries])
  const memChart = useMemo<TrendSeries[]>(() => [{ data: memSeries, stroke: '#10b981' }], [memSeries])
  const netChart = useMemo<TrendSeries[]>(() => [
    { data: netDownSeries, stroke: 'rgb(var(--accent))' },
    { data: netUpSeries, stroke: '#06b6d4' },
  ], [netDownSeries, netUpSeries])

  const killLabels = useMemo(() => ({
    end: t('taskManager.endTask'),
    hint: t('taskManager.killHint'),
    blocked: t('taskManager.killBlocked'),
    protectedTag: t('taskManager.protected'),
  }), [t])

  const showEmpty = !(loading && procs.length === 0) && filtered.length === 0

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('taskManager.title')} subtitle={t('taskManager.subtitle')} icon={<Activity />}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          label={t('taskManager.title')}
          options={[
            { value: 'processes', label: t('taskManager.processes'), icon: <List size={14} /> },
            { value: 'performance', label: t('taskManager.performance'), icon: <Activity size={14} /> },
          ]}
        />
        <button className="btn-ghost" onClick={() => void refresh()} disabled={busy} title={t('taskManager.refresh')}>
          <RefreshCw size={14} className={cn(busy && 'animate-spin')} /> {t('taskManager.refresh')}
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-4 pb-4">
          <SummaryBar snap={snap} />

          {tab === 'processes' ? (
            <section key="processes" className="card overflow-hidden animate-fade-in">
              <div className="flex items-center gap-2 flex-wrap p-3 border-b border-[color:var(--hairline)]">
                <div className="relative w-full sm:w-64 shrink-0">
                  <Search size={13} className="absolute start-2.5 top-2 text-surface-500" />
                  <input
                    className="input ps-8 pe-7 py-1.5 text-xs"
                    dir="ltr"
                    placeholder={t('taskManager.searchProcesses')}
                    aria-label={t('taskManager.filterHint')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button type="button" className="absolute end-1 top-1 btn-icon p-1" aria-label={t('common.clear')} onClick={() => setQuery('')}>
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="min-w-[168px]"><Toggle on={hideSys} onChange={setHideSys} label={t('taskManager.hideSystem')} /></div>
                <Segmented<GroupMode>
                  value={group}
                  onChange={setGroup}
                  size="sm"
                  label={t('taskManager.groupBy')}
                  options={[
                    { value: 'none', label: t('taskManager.groupNone'), icon: <List size={13} /> },
                    { value: 'app', label: t('taskManager.groupApp'), icon: <Layers size={13} /> },
                    { value: 'type', label: t('taskManager.groupType'), icon: <AppWindow size={13} /> },
                  ]}
                />
                <span className="label ms-auto" dir="ltr">{t('taskManager.showing', { shown: filtered.length, total: procs.length })}</span>
              </div>

              {loading && procs.length === 0 ? (
                <div className="space-y-2 p-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}</div>
              ) : showEmpty ? (
                <div className="p-3">
                  <Empty
                    icon={<Activity size={40} />}
                    text={query ? t('taskManager.noResults') : t('taskManager.noProcesses')}
                    hint={query ? t('taskManager.filterHint') : undefined}
                    action={
                      query ? <button className="btn-ghost text-xs" onClick={() => setQuery('')}>{t('common.clear')}</button>
                        : hideSys && procs.length > 0 ? <button className="btn-ghost text-xs" onClick={() => setHideSys(false)}>{t('taskManager.showSystem')}</button>
                        : <button className="btn-ghost text-xs" onClick={() => void refresh()}>{t('taskManager.refresh')}</button>
                    }
                  />
                </div>
              ) : (
                <div className="overflow-auto max-h-[min(64vh,620px)]">
                  <table className="w-full min-w-[680px] text-sm border-separate border-spacing-0">
                    <thead className="sticky top-0 z-20 bg-surface-100">
                      <tr className="text-[11px] uppercase tracking-wide text-surface-500">
                        <th scope="col" aria-sort={ariaSort('name')} className="text-start font-semibold px-3 py-2 border-b border-[color:var(--hairline)]">
                          <SortHeader k="name" label={t('taskManager.col.name')} active={sortKey === 'name'} dir={sortDir} onSort={toggleSort} />
                        </th>
                        <th scope="col" aria-sort={ariaSort('pid')} className="text-end font-semibold px-3 py-2 border-b border-[color:var(--hairline)]">
                          <SortHeader k="pid" label={t('taskManager.col.pid')} active={sortKey === 'pid'} dir={sortDir} onSort={toggleSort} />
                        </th>
                        <th scope="col" aria-sort={ariaSort('cpu')} className="text-start font-semibold px-3 py-2 border-b border-[color:var(--hairline)]">
                          <SortHeader k="cpu" label={t('taskManager.col.cpu')} active={sortKey === 'cpu'} dir={sortDir} onSort={toggleSort} />
                        </th>
                        <th scope="col" aria-sort={ariaSort('mem')} className="text-start font-semibold px-3 py-2 border-b border-[color:var(--hairline)]">
                          <SortHeader k="mem" label={t('taskManager.col.mem')} active={sortKey === 'mem'} dir={sortDir} onSort={toggleSort} />
                        </th>
                        <th scope="col" aria-sort={ariaSort('time')} className="text-end font-semibold px-3 py-2 border-b border-[color:var(--hairline)]">
                          <SortHeader k="time" label={t('taskManager.col.time')} active={sortKey === 'time'} dir={sortDir} onSort={toggleSort} />
                        </th>
                        <th scope="col" className="w-28 px-3 py-2 border-b border-[color:var(--hairline)]">
                          <span className="sr-only">{t('taskManager.col.actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    {groups.map((g) => {
                      const isCollapsed = group !== 'none' && collapsed.has(g.key)
                      return (
                        <tbody key={g.key}>
                          {group !== 'none' && (
                            <tr className="bg-surface-200/60 [&>td]:border-b [&>td]:border-[color:var(--hairline)]">
                              <td colSpan={6} className="p-0">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(g.key)}
                                  aria-expanded={!isCollapsed}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-start hover:bg-surface-200"
                                >
                                  {isCollapsed
                                    ? <ChevronRight size={14} className="shrink-0 opacity-60 rtl:rotate-180" />
                                    : <ChevronDown size={14} className="shrink-0 opacity-60" />}
                                  <span className="font-semibold text-xs truncate">{g.title}</span>
                                  <span className="badge bg-surface-300/70 text-surface-600 shrink-0" dir="ltr">{g.rows.length}</span>
                                  <span className="ms-auto flex items-center gap-3 text-[11px] font-mono opacity-70 shrink-0" dir="ltr">
                                    <span>CPU {g.cpu.toFixed(1)}%</span>
                                    <span>{formatBytes(g.mem * 1024 * 1024)}</span>
                                  </span>
                                </button>
                              </td>
                            </tr>
                          )}
                          {!isCollapsed && g.rows.map((p, i) => (
                            <ProcRow
                              key={p.pid}
                              p={p}
                              cpuScale={cpuScale}
                              memScale={memScale}
                              killing={killing === p.pid}
                              zebra={i % 2 === 1}
                              onKill={killProc}
                              labels={killLabels}
                            />
                          ))}
                        </tbody>
                      )
                    })}
                  </table>
                </div>
              )}
            </section>
          ) : (
            <div key="performance" className="space-y-4 animate-fade-in">
              {loading && !snap ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56 w-full rounded-2xl" />)}
                </div>
              ) : !snap ? (
                <Empty icon={<Activity size={40} />} text={t('taskManager.noProcesses')} action={<button className="btn-ghost text-xs" onClick={() => void refresh()}>{t('taskManager.refresh')}</button>} />
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <ChartCard
                      icon={<Cpu />}
                      title={t('taskManager.col.cpu')}
                      extra={<span className="text-lg font-bold font-mono tabular-nums shrink-0" dir="ltr">{snap.cpuPercent.toFixed(0)}%</span>}
                    >
                      <TrendChart series={cpuChart} ariaLabel={t('taskManager.col.cpu')} />
                      <div>
                        <div className="section-title mb-2">{t('res.perCore')} ({snap.cores.length})</div>
                        <div className="grid grid-cols-2 min-[480px]:grid-cols-4 gap-1.5">
                          {snap.cores.map((c) => (
                            <div key={c.index} className="rounded-lg bg-surface-200/60 px-2 py-1.5 min-w-0" title={`Core ${c.index} • ${c.speedMHz}MHz`}>
                              <div className="flex items-center justify-between gap-1 text-[10px] opacity-60 font-mono mb-0.5" dir="ltr">
                                <span>C{c.index}</span><span>{c.percent.toFixed(0)}%</span>
                              </div>
                              <Progress value={c.percent} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </ChartCard>

                    <ChartCard
                      icon={<MemoryStick />}
                      title={t('taskManager.col.mem')}
                      extra={<span className="text-lg font-bold font-mono tabular-nums shrink-0" dir="ltr">{snap.memoryPercent.toFixed(0)}%</span>}
                    >
                      <TrendChart series={memChart} ariaLabel={t('taskManager.col.mem')} />
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono opacity-70" dir="ltr">
                        <span>{formatBytes(snap.memoryUsedMB * 1024 * 1024)} / {formatBytes(snap.memoryTotalMB * 1024 * 1024)}</span>
                        {snap.memoryCachedMB !== null && <span>{t('taskManager.cached')} {formatBytes(snap.memoryCachedMB * 1024 * 1024)}</span>}
                        {snap.pagefilePercent !== null && <span>{t('res.pagefile')} {snap.pagefilePercent.toFixed(0)}%</span>}
                      </div>
                    </ChartCard>
                  </div>

                  <ChartCard
                    icon={<Network />}
                    title={t('taskManager.network')}
                    extra={
                      <div className="flex items-center gap-3 text-[11px] font-mono shrink-0" dir="ltr">
                        <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-2 w-2 rounded-full bg-accent" />{t('taskManager.down')} {formatSpeed(snap.netDownSpeedBps)}</span>
                        <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#06b6d4]" />{t('taskManager.up')} {formatSpeed(snap.netUpSpeedBps)}</span>
                      </div>
                    }
                  >
                    <TrendChart series={netChart} max={netScale} suffix="" formatValue={formatSpeed} ariaLabel={t('taskManager.network')} />
                  </ChartCard>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <section className="card p-4 min-w-0">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="grid place-items-center h-7 w-7 shrink-0 rounded-lg bg-accent/12 text-accent [&>svg]:h-4 [&>svg]:w-4"><HardDrive /></span>
                        <h3 className="font-semibold text-sm flex-1 min-w-0 truncate">{t('res.disk')}</h3>
                      </div>
                      <div className="space-y-3">
                        {snap.disks.map((d) => {
                          const usedPct = d.totalGB > 0 ? ((d.totalGB - d.freeGB) / d.totalGB) * 100 : 0
                          return (
                            <div key={d.letter} className="min-w-0">
                              <div className="flex items-center justify-between gap-2 text-xs mb-1 min-w-0">
                                <span className="font-bold font-mono shrink-0" dir="ltr">{d.letter}</span>
                                <span className="opacity-60 truncate min-w-0">{d.label}</span>
                                <span className="font-mono shrink-0 tabular-nums" dir="ltr">{formatBytes(d.freeGB * 1024 ** 3)} / {formatBytes(d.totalGB * 1024 ** 3)}</span>
                              </div>
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="flex-1 min-w-0"><Progress value={usedPct} tone={usedPct >= 90 ? 'danger' : undefined} /></div>
                                <span className="text-[11px] font-mono w-10 shrink-0 text-end tabular-nums" dir="ltr">{usedPct.toFixed(0)}%</span>
                              </div>
                              <div className="text-[10px] font-mono opacity-60 mt-1 truncate" dir="ltr">
                                {t('res.activity')}: {d.percentBusy !== null ? `${d.percentBusy.toFixed(0)}%` : '—'}
                                {d.readMBs !== null ? ` • ${t('taskManager.read')} ${d.readMBs.toFixed(1)} MB/s` : ''}
                                {d.writeMBs !== null ? ` • ${t('taskManager.write')} ${d.writeMBs.toFixed(1)} MB/s` : ''}
                              </div>
                            </div>
                          )
                        })}
                        {snap.disks.length === 0 && <span className="text-xs opacity-50" dir="ltr">—</span>}
                      </div>
                    </section>

                    <section className="card p-4 min-w-0 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="grid place-items-center h-7 w-7 shrink-0 rounded-lg bg-accent/12 text-accent [&>svg]:h-4 [&>svg]:w-4"><MonitorCog /></span>
                        <h3 className="font-semibold text-sm flex-1 min-w-0 truncate">{t('res.gpu')}</h3>
                        {snap.gpu && snap.gpu.temperatureC !== null && (
                          <span className="badge bg-rose-500/15 text-rose-500 shrink-0" dir="ltr">{snap.gpu.temperatureC.toFixed(0)}°C</span>
                        )}
                      </div>
                      {snap.gpu ? (
                        <>
                          <div className="text-xs opacity-60 truncate" title={snap.gpu.name}>{snap.gpu.name}</div>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex-1 min-w-0"><Progress value={snap.gpu.percent ?? 0} /></div>
                            <span className="text-xs font-mono w-12 shrink-0 text-end tabular-nums" dir="ltr">{snap.gpu.percent !== null ? `${snap.gpu.percent.toFixed(0)}%` : '—'}</span>
                          </div>
                          {snap.gpu.memoryUsedMB !== null && (
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="flex-1 min-w-0"><Progress value={snap.gpu.memoryTotalMB ? (snap.gpu.memoryUsedMB / snap.gpu.memoryTotalMB) * 100 : 0} tone="success" /></div>
                              <span className="text-[11px] font-mono w-36 shrink-0 text-end tabular-nums" dir="ltr">
                                {formatBytes(snap.gpu.memoryUsedMB * 1024 * 1024)} / {snap.gpu.memoryTotalMB !== null ? formatBytes(snap.gpu.memoryTotalMB * 1024 * 1024) : '—'}
                              </span>
                            </div>
                          )}
                        </>
                      ) : <span className="text-xs opacity-50">{t('res.unavailable')}</span>}
                    </section>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
