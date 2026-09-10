import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge, Cpu, MemoryStick, HardDrive, MonitorCog, Snowflake, Play, Download, Search, Skull, PictureInPicture2, Bell } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Field, Toggle, Slider, Empty, Progress, Ring } from '@/components/ui'
import { invoke, on } from '@/lib/api'
import { formatBytes } from '@/lib/utils'
import type { ResLive, ResProcess, ResConfig } from '@shared/types'

function formatSpeed(bps: number): string {
  if (!isFinite(bps) || bps <= 0) return '0 B/s'
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`
}

function fmtUptime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '—'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function Spark({ data, stroke = 'rgb(var(--accent))', h = 44 }: { data: number[]; stroke?: string; h?: number }) {
  const w = 220
  const max = Math.max(1, ...data)
  const pts = data.map((v, i) => {
    const x = data.length <= 1 ? 0 : (i / (data.length - 1)) * w
    const y = h - 4 - (Math.min(v, max) / max) * (h - 10)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" style={{ direction: 'ltr' }}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const SYS_NAMES = new Set(['system', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'lsaiso', 'winlogon', 'dwm', 'fontdrvhost', 'memory compression', 'idle', 'secure system'])

type SortKey = 'cpu' | 'mem' | 'pid' | 'name'

export default function Resources() {
  const { t } = useTranslation()
  const { toast } = useApp()
  const [snap, setSnap] = useState<ResLive | null>(null)
  const [procs, setProcs] = useState<ResProcess[]>([])
  const [cfg, setCfg] = useState<ResConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [frozen, setFrozen] = useState(false)
  const [compact, setCompact] = useState(false)
  const [hideSys, setHideSys] = useState(true)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('cpu')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [cpuHist, setCpuHist] = useState<number[]>([])
  const [memHist, setMemHist] = useState<number[]>([])
  const [netHist, setNetHist] = useState<number[]>([])
  const frozenRef = useRef(false)
  frozenRef.current = frozen
  const cfgRef = useRef<ResConfig | null>(null)
  cfgRef.current = cfg
  const overRef = useRef({ cpu: 0, mem: 0, firedCpu: false, firedMem: false })

  useEffect(() => {
    let alive = true
    Promise.all([invoke<ResLive>('res:snapshot'), invoke<ResConfig>('res:config:get'), invoke<ResProcess[]>('res:processes', 12)])
      .then(([s, c, p]) => {
        if (!alive) return
        setSnap(s); setCfg(c); setProcs(Array.isArray(p) ? p : [])
      })
      .catch((e: unknown) => { if (alive) toast(e instanceof Error ? e.message : t('toast.error'), 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live snapshot stream (2s tick in main).
  // NOTE: threshold alerts are side-effects — kept OUTSIDE any setState updater
  // (updaters must stay pure; StrictMode may double-invoke them).
  useEffect(() => {
    const off = on<ResLive>('res:update', (s) => {
      if (!s || frozenRef.current) return
      setSnap(s)
      setCpuHist((h) => [...h.slice(-59), s.cpuPercent ?? 0])
      setMemHist((h) => [...h.slice(-59), s.memoryPercent ?? 0])
      setNetHist((h) => [...h.slice(-59), (s.netDownSpeedBps ?? 0) + (s.netUpSpeedBps ?? 0)])
      // Threshold alerts: 30s sustained (15 ticks @2s).
      const cfgNow = cfgRef.current
      const c = overRef.current
      if (!cfgNow?.alertsOn) {
        c.cpu = 0; c.mem = 0; c.firedCpu = false; c.firedMem = false
        return
      }
      const cpuT = cfgNow.alertCpuPercent ?? 90
      const memT = cfgNow.alertMemoryPercent ?? 90
      c.cpu = (s.cpuPercent ?? 0) >= cpuT ? c.cpu + 1 : 0
      c.mem = (s.memoryPercent ?? 0) >= memT ? c.mem + 1 : 0
      if (c.cpu >= 15 && !c.firedCpu) {
        c.firedCpu = true
        toast(t('res.alertFired', { what: 'CPU', v: cpuT }), 'warning')
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('DragonHub', { body: `CPU ≥ ${cpuT}%` }) } catch { /* best-effort */ }
      }
      if (c.cpu === 0) c.firedCpu = false
      if (c.mem >= 15 && !c.firedMem) {
        c.firedMem = true
        toast(t('res.alertFired', { what: 'RAM', v: memT }), 'warning')
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('DragonHub', { body: `RAM ≥ ${memT}%` }) } catch { /* best-effort */ }
      }
      if (c.mem === 0) c.firedMem = false
    })
    return off
  }, [t, toast])

  // Process list refresh (heavier PS call — every 4s, skipped while frozen).
  useEffect(() => {
    const id = setInterval(() => {
      if (frozenRef.current) return
      invoke<ResProcess[]>('res:processes', cfg?.topN ?? 12).then((p) => { if (Array.isArray(p)) setProcs(p) }).catch(() => { /* keep last */ })
    }, 4000)
    return () => clearInterval(id)
  }, [cfg?.topN])

  const patchCfg = async (patch: Partial<ResConfig>) => {
    if (!cfg) return
    const prev = cfg
    setCfg({ ...cfg, ...patch })
    try {
      const next = await invoke<ResConfig>('res:config:set', { ...cfg, ...patch })
      setCfg(next)
    } catch (e: unknown) {
      setCfg(prev)
      toast(e instanceof Error ? e.message : t('toast.error'), 'error')
    }
  }

  const health = useMemo(() => {
    if (!snap) return 0
    const diskBusy = snap.disks.map((d) => d.percentBusy ?? 0).reduce((m, v) => Math.max(m, v), 0)
    const diskUsed = snap.disks.map((d) => (d.totalGB > 0 ? ((d.totalGB - d.freeGB) / d.totalGB) * 100 : 0)).reduce((m, v) => Math.max(m, v), 0)
    const diskPressure = Math.max(diskBusy, diskUsed * 0.5)
    const score = 100 - (snap.cpuPercent * 0.4 + snap.memoryPercent * 0.4 + diskPressure * 0.2)
    return Math.round(Math.min(100, Math.max(0, score)))
  }, [snap])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = procs.filter((p) => {
      if (hideSys && (p.pid <= 4 || SYS_NAMES.has((p.name || '').toLowerCase()))) return false
      if (q && !`${p.displayName} ${p.name} ${p.pid}`.toLowerCase().includes(q)) return false
      return true
    })
    const key = (p: ResProcess): number | string => sortKey === 'cpu' ? p.cpuPercent : sortKey === 'mem' ? p.memoryMB : sortKey === 'pid' ? p.pid : p.displayName.toLowerCase()
    rows = [...rows].sort((a, b) => {
      const va = key(a), vb = key(b)
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : (va as number) - (vb as number)
      return cmp * sortDir
    })
    return rows
  }, [procs, query, hideSys, sortKey, sortDir])

  const topProc = procs.length > 0 ? [...procs].sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryMB - a.memoryMB)[0] : null
  const maxDiskBusy = snap ? snap.disks.map((d) => d.percentBusy ?? 0).reduce((m, v) => Math.max(m, v), 0) : 0

  const killProc = async (p: ResProcess) => {
    if (p.pid <= 4 || SYS_NAMES.has((p.name || '').toLowerCase())) { toast(t('res.killBlocked'), 'error'); return }
    try {
      if (!(await invoke<boolean>('dialog:confirm', t('res.killConfirm1', { name: p.displayName, pid: p.pid })))) return
      if (!(await invoke<boolean>('dialog:confirm', t('res.killConfirm2')))) return
      await invoke('res:killProcess', p.pid)
      toast(t('res.killDone'), 'success')
      invoke<ResProcess[]>('res:processes', cfg?.topN ?? 12).then((r) => { if (Array.isArray(r)) setProcs(r) }).catch(() => {})
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
  }

  const exportReport = async (fmt: 'csv' | 'json') => {
    try {
      const fp = await invoke<string | null>('dialog:save', { defaultPath: `DragonHub-resources-${new Date().toISOString().slice(0, 10)}.${fmt}`, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] })
      if (!fp) return
      const payload = fmt === 'json'
        ? JSON.stringify({ exportedAt: Date.now(), snapshot: snap, processes: filtered }, null, 2)
        : ['pid,name,cpuPercent,memoryMB,cpuCumulativeSec,path', ...filtered.map((p) => `${p.pid},"${p.displayName.replace(/"/g, '""')}",${p.cpuPercent},${p.memoryMB},${p.cpuCumulativeSec},"${(p.path || '').replace(/"/g, '""')}"`)].join('\n')
      await invoke('fs:writeText', fp, payload)
      toast(t('toast.saved'))
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
  }

  const openCard = async () => {
    try {
      await invoke('res:card:show')
      toast(t('res.cardOpened'), 'info')
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
  }

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === -1 ? 1 : -1))
    else { setSortKey(k); setSortDir(k === 'name' ? 1 : -1) }
  }

  if (loading && !snap) {
    return (
      <div className="page-enter h-full flex flex-col">
        <PageHeader icon={<Gauge size={22} />} title={t('res.title')} />
        <div className="flex-1 flex items-center justify-center text-sm opacity-60">{t('common.loading')}</div>
      </div>
    )
  }
  if (!snap) {
    return (
      <div className="page-enter h-full flex flex-col">
        <PageHeader icon={<Gauge size={22} />} title={t('res.title')} />
        <Empty icon={<Gauge size={40} />} text={t('res.noData')} />
      </div>
    )
  }

  const pad = compact ? 'p-3' : 'p-4'
  const srcBadge = (s: string): string => s === 'ok' ? 'bg-emerald-500/15 text-emerald-500' : s === 'degraded' ? 'bg-amber-500/15 text-amber-500' : 'bg-surface-300/60 text-surface-600'

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader icon={<Gauge size={22} />} title={t('res.title')} subtitle={t('res.subtitle')}>
        <button className="btn-ghost" onClick={() => setFrozen((f) => !f)}>{frozen ? <><Play size={14} /> {t('res.unfreeze')}</> : <><Snowflake size={14} /> {t('res.freeze')}</>}</button>
        <button className="btn-ghost" onClick={openCard}><PictureInPicture2 size={14} /> {t('res.openCard')}</button>
        <button className="btn-ghost" onClick={() => void exportReport('csv')}><Download size={14} /> CSV</button>
        <button className="btn-ghost" onClick={() => void exportReport('json')}><Download size={14} /> JSON</button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-4 pb-4">
          {/* 4 main rings + health */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <div className={`card ${pad} flex flex-col items-center gap-1`}>
              <div className="flex items-center gap-1.5 text-xs opacity-60"><Cpu size={14} />{t('res.cpu')}</div>
              <Ring value={snap.cpuPercent} size={92} stroke={10}><span className="text-lg font-bold font-mono" dir="ltr">{snap.cpuPercent.toFixed(0)}%</span></Ring>
              {snap.temperatureC !== null && <span className="badge bg-rose-500/15 text-rose-500" dir="ltr">{snap.temperatureC.toFixed(0)}°C</span>}
              <div className="w-full mt-1"><Spark data={cpuHist} /></div>
            </div>
            <div className={`card ${pad} flex flex-col items-center gap-1`}>
              <div className="flex items-center gap-1.5 text-xs opacity-60"><MemoryStick size={14} />{t('res.ram')}</div>
              <Ring value={snap.memoryPercent} size={92} stroke={10}><span className="text-lg font-bold font-mono" dir="ltr">{snap.memoryPercent.toFixed(0)}%</span></Ring>
              <span className="text-[11px] font-mono opacity-70" dir="ltr">{formatBytes(snap.memoryUsedMB * 1024 * 1024)} / {formatBytes(snap.memoryTotalMB * 1024 * 1024)}</span>
              <div className="w-full mt-1"><Spark data={memHist} stroke="#10b981" /></div>
            </div>
            <div className={`card ${pad} flex flex-col items-center gap-1`}>
              <div className="flex items-center gap-1.5 text-xs opacity-60"><HardDrive size={14} />{t('res.disk')}</div>
              <Ring value={maxDiskBusy} size={92} stroke={10}><span className="text-lg font-bold font-mono" dir="ltr">{maxDiskBusy.toFixed(0)}%</span></Ring>
              <span className="text-[11px] opacity-70">{t('res.activity')}</span>
              <div className="w-full mt-1"><Spark data={netHist} stroke="#06b6d4" /></div>
            </div>
            <div className={`card ${pad} flex flex-col items-center gap-1`}>
              <div className="flex items-center gap-1.5 text-xs opacity-60"><MonitorCog size={14} />{t('res.gpu')}</div>
              {snap.gpu ? (
                <>
                  <Ring value={snap.gpu.percent ?? 0} size={92} stroke={10}><span className="text-lg font-bold font-mono" dir="ltr">{snap.gpu.percent !== null ? `${snap.gpu.percent.toFixed(0)}%` : '—'}</span></Ring>
                  <span className="text-[11px] truncate max-w-full" title={snap.gpu.name}>{snap.gpu.name}</span>
                  {snap.gpu.temperatureC !== null && <span className="badge bg-rose-500/15 text-rose-500" dir="ltr">{snap.gpu.temperatureC.toFixed(0)}°C</span>}
                </>
              ) : <span className="text-xs opacity-50 py-8">{t('res.unavailable')}</span>}
            </div>
            <div className={`card ${pad} flex flex-col items-center gap-1 col-span-2 xl:col-span-1`}>
              <div className="flex items-center gap-1.5 text-xs opacity-60"><Bell size={14} />{t('res.health')}</div>
              <Ring value={health} size={92} stroke={10}><span className="text-xl font-black font-mono" dir="ltr">{health}</span></Ring>
              <span className="text-[11px] opacity-70 font-mono" dir="ltr">↑{formatSpeed(snap.netUpSpeedBps)} ↓{formatSpeed(snap.netDownSpeedBps)}</span>
              <span className="text-[11px] opacity-50">{t('res.uptime')}: {fmtUptime(snap.osUptimeSec)} • {snap.processesCount}</span>
            </div>
          </div>

          {/* per-core heat grid */}
          <section className={`card ${pad}`}>
            <h3 className="font-semibold mb-3 text-sm opacity-80">{t('res.perCore')} ({snap.cores.length} {t('res.cores')})</h3>
            <div className="grid grid-cols-4 sm:grid-cols-6 xl:grid-cols-8 gap-2">
              {snap.cores.map((c) => (
                <div key={c.index} className="rounded-lg bg-surface-200/60 px-2 py-1.5" title={`Core ${c.index} • ${c.speedMHz}MHz`}>
                  <div className="text-[10px] opacity-60 font-mono" dir="ltr">C{c.index}</div>
                  <div className="flex items-center gap-2"><Progress value={c.percent} /><span className="text-[10px] font-mono w-9 text-end" dir="ltr">{c.percent.toFixed(0)}%</span></div>
                </div>
              ))}
            </div>
          </section>

          {/* disks */}
          <section className={`card ${pad}`}>
            <h3 className="font-semibold mb-3 text-sm opacity-80">{t('res.disk')} — {t('res.capacity')} / {t('res.activity')}</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {snap.disks.map((d) => {
                const usedPct = d.totalGB > 0 ? ((d.totalGB - d.freeGB) / d.totalGB) * 100 : 0
                return (
                  <div key={d.letter} className="rounded-xl bg-surface-200/60 p-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-bold font-mono" dir="ltr">{d.letter}</span>
                      <span className="text-xs opacity-60 truncate">{d.label}</span>
                    </div>
                    <div className="flex items-center gap-2"><Progress value={usedPct} /><span className="text-[11px] font-mono w-24 text-end" dir="ltr">{d.freeGB.toFixed(0)} / {d.totalGB.toFixed(0)} GB</span></div>
                    <div className="text-[11px] opacity-60 font-mono" dir="ltr">
                      {t('res.activity')}: {d.percentBusy !== null ? `${d.percentBusy.toFixed(0)}%` : '—'}
                      {d.readMBs !== null && ` • R ${d.readMBs.toFixed(1)} MB/s`}
                      {d.writeMBs !== null && ` • W ${d.writeMBs.toFixed(1)} MB/s`}
                    </div>
                  </div>
                )
              })}
              {snap.disks.length === 0 && <span className="text-xs opacity-50">{t('res.unavailable')}</span>}
            </div>
          </section>

          {/* top apps (Top N only — search & export cover the loaded Top N, not all OS processes) */}
          <section className={`card ${pad}`}>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-sm opacity-80 flex-1">{t('res.topApps')} <span className="badge bg-surface-200 text-surface-700 font-mono" dir="ltr">Top {cfg?.topN ?? 12}</span></h3>
              <div className="flex items-center gap-1.5 rounded-lg bg-surface-200/60 px-2 py-1">
                <Search size={13} className="opacity-50" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('res.searchApps')} title={t('res.topNNote')} className="bg-transparent outline-none text-xs w-36" />
              </div>
              <Toggle on={hideSys} onChange={setHideSys} label={t('res.hideSystem')} />
              <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setCompact((c) => !c)}>{compact ? t('res.comfortable') : t('res.compact')}</button>
            </div>
            <p className="text-[11px] opacity-50 mb-3">{t('res.topNNote')}</p>
            {topProc && (
              <div className="rounded-xl bg-accent/10 border border-accent/20 px-3 py-2 mb-3 text-xs flex items-center gap-2 flex-wrap">
                <span className="opacity-60">{t('res.topProcess')}:</span>
                <span className="font-bold">{topProc.displayName}</span>
                <span className="font-mono opacity-70" dir="ltr">CPU {topProc.cpuPercent.toFixed(1)}% • {topProc.memoryMB.toFixed(0)} MB</span>
              </div>
            )}
            {filtered.length === 0 ? <Empty icon={<Skull size={36} />} text={t('res.noData')} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs opacity-60">
                      <th className="text-start font-medium py-1.5 pe-3"><button onClick={() => toggleSort('name')}>{t('res.name')} {sortKey === 'name' ? (sortDir === 1 ? '▲' : '▼') : ''}</button></th>
                      <th className="text-start font-medium py-1.5 pe-3"><button onClick={() => toggleSort('pid')}>{t('res.pid')} {sortKey === 'pid' ? (sortDir === 1 ? '▲' : '▼') : ''}</button></th>
                      <th className="text-start font-medium py-1.5 pe-3"><button onClick={() => toggleSort('cpu')}>CPU% {sortKey === 'cpu' ? (sortDir === 1 ? '▲' : '▼') : ''}</button></th>
                      <th className="text-start font-medium py-1.5 pe-3"><button onClick={() => toggleSort('mem')}>RAM {sortKey === 'mem' ? (sortDir === 1 ? '▲' : '▼') : ''}</button></th>
                      {!compact && <th className="text-start font-medium py-1.5 pe-3">CPU Σ</th>}
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, cfg?.topN ?? 12).map((p) => (
                      <tr key={p.pid} className="border-t border-surface-300/60">
                        <td className="py-1.5 pe-3 max-w-[220px]"><div className="font-medium truncate" title={p.path || p.name}>{p.displayName}</div>{!compact && <div className="text-[10px] opacity-50 truncate font-mono" dir="ltr">{p.path || p.name}</div>}</td>
                        <td className="py-1.5 pe-3 font-mono" dir="ltr">{p.pid}</td>
                        <td className="py-1.5 pe-3"><div className="flex items-center gap-2 min-w-[110px]"><Progress value={p.cpuPercent} /><span className="text-xs font-mono" dir="ltr">{p.cpuPercent.toFixed(1)}%</span></div></td>
                        <td className="py-1.5 pe-3 font-mono" dir="ltr">{p.memoryMB.toFixed(0)} MB</td>
                        {!compact && <td className="py-1.5 pe-3 font-mono text-xs opacity-70" dir="ltr">{p.cpuCumulativeSec.toFixed(0)}s</td>}
                        <td className="py-1.5 text-end"><button className="btn-ghost !py-1 !px-2 text-xs text-rose-500" onClick={() => void killProc(p)}>{t('res.kill')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* sources + settings */}
          <div className="grid md:grid-cols-2 gap-3">
            <section className={`card ${pad}`}>
              <h3 className="font-semibold mb-3 text-sm opacity-80">{t('res.sources')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(snap.sources).map(([k, v]) => (
                  <span key={k} className={`badge ${srcBadge(v)}`} title={k}>{k}: {t(`res.${v}` as 'res.ok')}</span>
                ))}
              </div>
              <p className="text-[11px] opacity-50 mt-3">{t('res.pagefile')}: {snap.pagefilePercent !== null ? `${snap.pagefilePercent.toFixed(0)}%` : '—'}</p>
            </section>
            <section className={`card ${pad} space-y-3`}>
              <h3 className="font-semibold text-sm opacity-80">{t('res.settings')}</h3>
              {cfg && (
                <>
                  <Field label={t('res.interval')}><Slider value={Math.round(cfg.intervalMs / 1000)} min={1} max={10} step={1} suffix="s" onChange={(v) => void patchCfg({ intervalMs: v * 1000 })} /></Field>
                  <Field label={t('res.topN')}><Slider value={cfg.topN} min={5} max={50} step={1} onChange={(v) => void patchCfg({ topN: v })} /></Field>
                  <Toggle on={cfg.alertsOn} onChange={(v) => void patchCfg({ alertsOn: v })} label={t('res.alerts')} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('res.alertCpu')}><Slider value={cfg.alertCpuPercent} min={10} max={100} step={5} suffix="%" onChange={(v) => void patchCfg({ alertCpuPercent: v })} /></Field>
                    <Field label={t('res.alertMemory')}><Slider value={cfg.alertMemoryPercent} min={10} max={100} step={5} suffix="%" onChange={(v) => void patchCfg({ alertMemoryPercent: v })} /></Field>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
