import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Search, RefreshCw, Cpu, MemoryStick, HardDrive, MonitorCog, Network, ShieldAlert } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useApp } from '@/store'
import { PageHeader, Ring, Progress, Empty, Toggle, Skeleton } from '@/components/ui'
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

const SR_ONLY: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }

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

function series(hist: ResHistoryPoint[], key: 'cpu' | 'mem'): number[] {
  return hist.map((h) => (Number.isFinite(h[key]) ? h[key] : 0))
}

/** Inline-SVG area chart with a 0..max y axis, grid lines and axis labels. */
function TrendChart({ data, label, stroke, max = 100, h = 132, suffix = '%' }: {
  data: number[]; label: string; stroke: string; max?: number; h?: number; suffix?: string
}) {
  const w = 600
  const top = 8, bottom = 20, left = 34, right = 10
  const iw = Math.max(1, w - left - right)
  const ih = Math.max(1, h - top - bottom)
  const hi = max > 0 ? max : Math.max(1, ...data)
  const x = (i: number) => (data.length <= 1 ? left : left + (i / (data.length - 1)) * iw)
  const y = (v: number) => top + ih - (Math.min(Math.max(v, 0), hi) / hi) * ih
  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const baseY = (top + ih).toFixed(1)
  const area = data.length > 1 ? `${left},${baseY} ${line} ${(left + iw).toFixed(1)},${baseY}` : ''
  const min = data.length ? Math.min(...data) : 0
  const now = data.length ? data[data.length - 1] : 0
  const desc = `${label}: ${min.toFixed(0)}${suffix} / ${now.toFixed(0)}${suffix}`
  return (
    <div className="relative min-w-0" dir="ltr">
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={desc} style={{ direction: 'ltr', display: 'block' }}>
        <title>{desc}</title>
        {[0, 0.5, 1].map((tick) => (
          <g key={tick}>
            <line x1={left} x2={left + iw} y1={y(tick * hi)} y2={y(tick * hi)} stroke="rgb(var(--surface-300))" strokeWidth="1" />
            <text x={left - 6} y={y(tick * hi) + 3} textAnchor="end" fontSize="9" fill="rgb(var(--surface-500))">{Math.round(tick * hi)}</text>
          </g>
        ))}
        {area && <polygon points={area} fill={stroke} fillOpacity="0.12" />}
        {line && <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {data.length > 0 && <circle cx={x(data.length - 1)} cy={y(now)} r="3" fill={stroke} vectorEffect="non-scaling-stroke" />}
      </svg>
      <span style={SR_ONLY}>{desc}</span>
    </div>
  )
}

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

  const killProc = async (p: ResProcess) => {
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
  }

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === -1 ? 1 : -1))
    else { setSortKey(k); setSortDir(k === 'name' ? 1 : -1) }
  }

  const caret = (k: SortKey) => (sortKey === k ? (sortDir === 1 ? '▲' : '▼') : '')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = procs.filter((p) => {
      if (hideSys && SYS_NAMES.has((p.name || '').toLowerCase())) return false
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

  const cpuScale = useMemo(() => Math.max(1, ...procs.map((p) => p.cpuPercent)), [procs])
  const memScale = useMemo(() => Math.max(1, ...procs.map((p) => p.memoryMB)), [procs])
  const cpuSeries = useMemo(() => series(hist, 'cpu'), [hist])
  const memSeries = useMemo(() => series(hist, 'mem'), [hist])
  const netScale = useMemo(() => Math.max(1024, ...hist.flatMap((h) => [h.downBps, h.upBps])), [hist])
  const maxDiskBusy = snap ? snap.disks.reduce((m, d) => Math.max(m, d.percentBusy ?? 0), 0) : 0

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('taskManager.title')} subtitle={t('taskManager.subtitle')} icon={<Activity />}>
        <div className="flex gap-1 p-1 rounded-xl bg-surface-200">
          <button className={cn('btn-ghost text-sm', tab === 'processes' && 'bg-surface-300')} onClick={() => setTab('processes')}>
            <Activity size={14} /> {t('taskManager.processes')}
          </button>
          <button className={cn('btn-ghost text-sm', tab === 'performance' && 'bg-surface-300')} onClick={() => setTab('performance')}>
            {t('taskManager.performance')}
          </button>
        </div>
        <button className="btn-ghost" onClick={() => void refresh()} disabled={busy} title={t('taskManager.refresh')}>
          <RefreshCw size={14} className={cn(busy && 'animate-spin')} /> {t('taskManager.refresh')}
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-4 pb-4">
          {tab === 'processes' ? (
            <section className="card p-4">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <div className="relative w-52 shrink-0">
                  <Search size={13} className="absolute start-2.5 top-2 text-surface-500" />
                  <input className="input ps-8 py-1 text-xs" dir="ltr" placeholder={t('taskManager.searchProcesses')} value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <div className="min-w-[170px]"><Toggle on={hideSys} onChange={setHideSys} label={t('taskManager.hideSystem')} /></div>
                <span className="label ms-auto" dir="ltr">{filtered.length} / {procs.length}</span>
              </div>

              {loading && procs.length === 0 ? (
                <div className="space-y-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}</div>
              ) : filtered.length === 0 ? (
                <Empty
                  icon={<Activity size={40} />}
                  text={t('taskManager.empty')}
                  action={query ? <button className="btn-ghost text-xs" onClick={() => setQuery('')}>{t('common.clear')}</button> : undefined}
                />
              ) : (
                <div className="overflow-x-auto max-w-full">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="text-xs opacity-60">
                        <th className="text-start font-medium py-1.5 pe-3"><button className="inline-flex items-center gap-1" onClick={() => toggleSort('name')}>{t('taskManager.col.name')} {caret('name')}</button></th>
                        <th className="text-start font-medium py-1.5 pe-3"><button className="inline-flex items-center gap-1 font-mono" onClick={() => toggleSort('pid')}>{t('taskManager.col.pid')} {caret('pid')}</button></th>
                        <th className="text-start font-medium py-1.5 pe-3"><button className="inline-flex items-center gap-1" onClick={() => toggleSort('cpu')}>{t('taskManager.col.cpu')} {caret('cpu')}</button></th>
                        <th className="text-start font-medium py-1.5 pe-3"><button className="inline-flex items-center gap-1" onClick={() => toggleSort('mem')}>{t('taskManager.col.mem')} {caret('mem')}</button></th>
                        <th className="text-start font-medium py-1.5 pe-3"><button className="inline-flex items-center gap-1" onClick={() => toggleSort('time')}>{t('taskManager.col.time')} {caret('time')}</button></th>
                        <th className="w-28" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => {
                        const locked = isProtected(p)
                        return (
                          <tr key={p.pid} className="border-t border-surface-300/60">
                            <td className="py-1.5 pe-3 max-w-[220px]">
                              <div className="font-medium truncate" title={p.path || p.name}>{p.displayName}</div>
                              <div className="text-[10px] opacity-50 truncate font-mono" dir="ltr">{p.path || p.name}</div>
                            </td>
                            <td className="py-1.5 pe-3 font-mono" dir="ltr">{p.pid}</td>
                            <td className="py-1.5 pe-3">
                              <div className="flex items-center gap-2 min-w-[120px]">
                                <Progress value={(p.cpuPercent / cpuScale) * 100} />
                                <span className="text-xs font-mono w-12 shrink-0 text-end" dir="ltr">{p.cpuPercent.toFixed(1)}%</span>
                              </div>
                            </td>
                            <td className="py-1.5 pe-3">
                              <div className="flex items-center gap-2 min-w-[120px]">
                                <Progress value={(p.memoryMB / memScale) * 100} tone="success" />
                                <span className="text-xs font-mono w-16 shrink-0 text-end" dir="ltr">{p.memoryMB.toFixed(0)} MB</span>
                              </div>
                            </td>
                            <td className="py-1.5 pe-3 font-mono text-xs opacity-70 whitespace-nowrap" dir="ltr">{formatCpuTime(p.cpuCumulativeSec)}</td>
                            <td className="py-1.5 text-end">
                              <button
                                className="btn-danger btn-sm"
                                disabled={locked || killing === p.pid}
                                title={locked ? t('taskManager.killBlocked') : t('taskManager.killHint')}
                                onClick={() => void killProc(p)}
                              >
                                <ShieldAlert size={13} /> {t('taskManager.endTask')}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <section className="card p-4 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs opacity-60 mb-2"><Cpu size={14} /> {t('taskManager.col.cpu')}</div>
                  <TrendChart data={cpuSeries} label={t('taskManager.col.cpu')} stroke="rgb(var(--accent))" />
                </section>
                <section className="card p-4 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs opacity-60 mb-2"><MemoryStick size={14} /> {t('taskManager.col.mem')}</div>
                  <TrendChart data={memSeries} label={t('taskManager.col.mem')} stroke="#10b981" />
                </section>
              </div>

              {loading && !snap ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)}</div>
              ) : !snap ? (
                <Empty icon={<Activity size={40} />} text={t('taskManager.empty')} action={<button className="btn-ghost text-xs" onClick={() => void refresh()}>{t('taskManager.refresh')}</button>} />
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <div className="card p-4 flex flex-col items-center gap-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs opacity-60"><Cpu size={14} /> {t('taskManager.col.cpu')}</div>
                      <Ring value={snap.cpuPercent} size={92} stroke={10}>
                        <span className="text-lg font-bold font-mono" dir="ltr">{snap.cpuPercent.toFixed(0)}%</span>
                      </Ring>
                      {snap.temperatureC !== null && <span className="badge bg-rose-500/15 text-rose-500" dir="ltr">{snap.temperatureC.toFixed(0)}°C</span>}
                    </div>
                    <div className="card p-4 flex flex-col items-center gap-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs opacity-60"><MemoryStick size={14} /> {t('taskManager.col.mem')}</div>
                      <Ring value={snap.memoryPercent} size={92} stroke={10}>
                        <span className="text-lg font-bold font-mono" dir="ltr">{snap.memoryPercent.toFixed(0)}%</span>
                      </Ring>
                      <span className="text-[11px] font-mono opacity-70 break-words text-center" dir="ltr">
                        {formatBytes(snap.memoryUsedMB * 1024 * 1024)} / {formatBytes(snap.memoryTotalMB * 1024 * 1024)}
                      </span>
                    </div>
                    <div className="card p-4 flex flex-col items-center gap-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs opacity-60"><HardDrive size={14} /> {t('res.disk')}</div>
                      <Ring value={maxDiskBusy} size={92} stroke={10}>
                        <span className="text-lg font-bold font-mono" dir="ltr">{maxDiskBusy.toFixed(0)}%</span>
                      </Ring>
                      <span className="text-[11px] font-mono opacity-70 text-center" dir="ltr">
                        {formatBytes(snap.disks.reduce((n, d) => n + Math.max(0, d.totalGB - d.freeGB) * 1024 ** 3, 0))}
                      </span>
                    </div>
                    <div className="card p-4 flex flex-col items-center gap-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs opacity-60"><Network size={14} /> {t('res.processes')}</div>
                      <Ring value={Math.min(100, snap.processesCount)} size={92} stroke={10}>
                        <span className="text-lg font-bold font-mono" dir="ltr">{snap.processesCount}</span>
                      </Ring>
                      <span className="text-[11px] font-mono opacity-70 text-center" dir="ltr">↑ {formatSpeed(snap.netUpSpeedBps)} ↓ {formatSpeed(snap.netDownSpeedBps)}</span>
                    </div>
                  </div>

                  <section className="card p-4">
                    <h3 className="font-semibold mb-3 text-sm opacity-80">{t('res.perCore')}</h3>
                    <div className="grid grid-cols-2 min-[480px]:grid-cols-4 sm:grid-cols-6 xl:grid-cols-8 gap-2">
                      {snap.cores.map((c) => (
                        <div key={c.index} className="rounded-lg bg-surface-200/60 px-2 py-1.5 min-w-0" title={`Core ${c.index} • ${c.speedMHz}MHz`}>
                          <div className="text-[10px] opacity-60 font-mono" dir="ltr">C{c.index}</div>
                          <div className="flex items-center gap-2 min-w-0">
                            <Progress value={c.percent} />
                            <span className="text-[10px] font-mono w-9 shrink-0 text-end" dir="ltr">{c.percent.toFixed(0)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <section className="card p-4 space-y-3 min-w-0">
                      <h3 className="font-semibold text-sm opacity-80">{t('res.disk')}</h3>
                      {snap.disks.map((d) => {
                        const usedPct = d.totalGB > 0 ? ((d.totalGB - d.freeGB) / d.totalGB) * 100 : 0
                        return (
                          <div key={d.letter} className="min-w-0">
                            <div className="flex items-center justify-between gap-2 text-xs mb-1 min-w-0">
                              <span className="font-bold font-mono shrink-0" dir="ltr">{d.letter}</span>
                              <span className="opacity-60 truncate min-w-0">{d.label}</span>
                              <span className="font-mono shrink-0" dir="ltr">{d.freeGB.toFixed(0)} / {d.totalGB.toFixed(0)} GB</span>
                            </div>
                            <div className="flex items-center gap-2 min-w-0">
                              <Progress value={usedPct} />
                              <span className="text-[11px] font-mono w-14 shrink-0 text-end" dir="ltr">{d.percentBusy !== null ? `${d.percentBusy.toFixed(0)}%` : '—'}</span>
                            </div>
                          </div>
                        )
                      })}
                      {snap.disks.length === 0 && <span className="text-xs opacity-50" dir="ltr">—</span>}
                    </section>

                    <section className="card p-4 space-y-3 min-w-0">
                      <h3 className="font-semibold text-sm opacity-80 flex items-center gap-1.5"><MonitorCog size={14} /> {t('res.gpu')}</h3>
                      {snap.gpu ? (
                        <>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate min-w-0 flex-1" title={snap.gpu.name}>{snap.gpu.name}</span>
                            {snap.gpu.temperatureC !== null && <span className="badge bg-rose-500/15 text-rose-500 shrink-0" dir="ltr">{snap.gpu.temperatureC.toFixed(0)}°C</span>}
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                            <Progress value={snap.gpu.percent ?? 0} />
                            <span className="text-xs font-mono w-12 shrink-0 text-end" dir="ltr">{snap.gpu.percent !== null ? `${snap.gpu.percent.toFixed(0)}%` : '—'}</span>
                          </div>
                          {snap.gpu.memoryUsedMB !== null && (
                            <div className="flex items-center gap-2 min-w-0">
                              <Progress value={snap.gpu.memoryTotalMB ? (snap.gpu.memoryUsedMB / snap.gpu.memoryTotalMB) * 100 : 0} tone="success" />
                              <span className="text-[11px] font-mono w-40 shrink-0 text-end" dir="ltr">
                                {formatBytes(snap.gpu.memoryUsedMB * 1024 * 1024)} / {snap.gpu.memoryTotalMB !== null ? formatBytes(snap.gpu.memoryTotalMB * 1024 * 1024) : '—'}
                              </span>
                            </div>
                          )}
                        </>
                      ) : <span className="text-xs opacity-50" dir="ltr">—</span>}
                      <div className="divider" />
                      <div className="flex items-center gap-2 min-w-0">
                        <Progress value={(snap.netDownSpeedBps / netScale) * 100} />
                        <span className="text-xs font-mono w-24 shrink-0 text-end" dir="ltr">↓ {formatSpeed(snap.netDownSpeedBps)}</span>
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <Progress value={(snap.netUpSpeedBps / netScale) * 100} tone="success" />
                        <span className="text-xs font-mono w-24 shrink-0 text-end" dir="ltr">↑ {formatSpeed(snap.netUpSpeedBps)}</span>
                      </div>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
