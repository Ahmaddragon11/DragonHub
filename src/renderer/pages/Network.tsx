import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wifi, ArrowDown, ArrowUp, Download, Upload, ShieldAlert, AlertTriangle, Radar, Ban, Gauge, FileDown, Signal } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Field, Toggle, Slider, Empty, Progress } from '@/components/ui'
import { invoke, on } from '@/lib/api'
import { uid } from '@/lib/utils'
import { dailyAllowanceMB, planUsage, effectiveDailyCapMB, lastNDays, formatMB, projectDepletion, weekTotals } from '@/lib/netplan'
import type { NetPlan, NetLimits, NetLive, NetDay, NetConfig, NetCycle } from '@shared/types'

type PlanCycle = NetCycle
type Tab = 'overview' | 'plan' | 'limits' | 'history' | 'tools'

interface ConnInfo { ssid: string | null; signalPct: number | null; radioType: string | null; adapter: string | null; state: string | null }
interface Conn { proto: string; local: string; remote: string; state: string; pid: number; process: string }

const CYCLES: PlanCycle[] = ['daily', 'weekly', 'monthly', 'custom']
const TABS: Tab[] = ['overview', 'plan', 'limits', 'history', 'tools']

function formatSpeed(bps: number): string {
  if (!isFinite(bps) || bps <= 0) return '0 B/s'
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDay(iso: string, lang: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface-200/70 ${className}`} />
}

function Bars({ rows }: { rows: NetDay[] }) {
  const max = rows.reduce((m, d) => Math.max(m, (d.downMB ?? 0) + (d.upMB ?? 0)), 0)
  const W = 560, H = 140, gap = 6
  const bw = rows.length > 0 ? (W - gap * (rows.length - 1)) / rows.length : 0
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" style={{ direction: 'ltr' }}>
      {rows.map((d, i) => {
        const tot = (d.downMB ?? 0) + (d.upMB ?? 0)
        const h = max > 0 ? Math.max(2, (tot / max) * (H - 20)) : 2
        return <rect key={d.date} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={3} fill="rgb(var(--accent))" opacity={0.75} />
      })}
    </svg>
  )
}

const trimNum = (n: number): string => String(Math.round(n * 100) / 100)

export default function Network() {
  const { t, i18n } = useTranslation()
  const { toast } = useApp()
  const [tab, setTab] = useState<Tab>(() => {
    try { const v = localStorage.getItem('dh-net-tab'); return TABS.includes(v as Tab) ? (v as Tab) : 'overview' } catch { return 'overview' }
  })
  const [live, setLive] = useState<NetLive | null>(null)
  const [history, setHistory] = useState<NetDay[]>([])
  const [plan, setPlan] = useState<NetPlan | null>(null)
  const [limits, setLimits] = useState<NetLimits | null>(null)
  const [loading, setLoading] = useState(true)
  const [capGB, setCapGB] = useState<string | null>(null)
  const [pName, setPName] = useState('')
  const [pQuotaGB, setPQuotaGB] = useState('')
  const [pCycle, setPCycle] = useState<PlanCycle>('monthly')
  const [pCycleDays, setPCycleDays] = useState(30)
  const [pStart, setPStart] = useState(() => isoDay(new Date()))
  // v2 states
  const [connInfo, setConnInfo] = useState<ConnInfo | null>(null)
  const [conns, setConns] = useState<Conn[]>([])
  const [exePath, setExePath] = useState('')
  const [appBlocked, setAppBlocked] = useState<boolean | null>(null)
  const [speedRunning, setSpeedRunning] = useState(false)
  const [speedResult, setSpeedResult] = useState<{ mbps: number; bytes: number; ms: number } | null>(null)

  const switchTab = (v: Tab) => {
    setTab(v)
    try { localStorage.setItem('dh-net-tab', v) } catch { /* ignore */ }
  }

  const fillForm = (p: NetPlan | null) => {
    setPName(p?.name ?? '')
    setPQuotaGB(p ? trimNum(p.quotaMB / 1024) : '')
    setPCycle(p?.cycle ?? 'monthly')
    setPCycleDays(p && p.cycleDays > 0 ? p.cycleDays : 30)
    setPStart(p?.startDate || isoDay(new Date()))
  }

  const applyConfig = (cfg: NetConfig) => {
    setPlan(cfg.plan)
    setLimits(cfg.limits)
    fillForm(cfg.plan)
    setCapGB(null)
  }

  const loadAll = async () => {
    const cfg = await invoke<NetConfig>('net:getConfig')
    applyConfig(cfg)
    setHistory(await invoke<NetDay[]>('net:history', 30))
    try { setConnInfo(await invoke<ConnInfo>('net:connInfo')) } catch { setConnInfo(null) }
    try { setConns(await invoke<Conn[]>('net:connections')) } catch { setConns([]) }
  }

  useEffect(() => {
    let alive = true
    loadAll()
      .catch((e: unknown) => { if (alive) toast(e instanceof Error ? e.message : t('toast.error'), 'error') })
      .finally(() => { if (alive) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const l = await invoke<NetLive>('net:live')
        if (alive) setLive(l)
      } catch { /* main side unreachable — keep last values */ }
    }
    pull()
    const id = setInterval(pull, 2000)
    const off = on<NetLive>('net:update', (l) => { if (l) setLive(l) })
    return () => { alive = false; clearInterval(id); off() }
  }, [])

  // Radar auto-refresh while the tools tab is open.
  useEffect(() => {
    if (tab !== 'tools') return
    const id = setInterval(() => {
      invoke<Conn[]>('net:connections').then((c) => setConns(Array.isArray(c) ? c : [])).catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [tab])

  const toggleBlock = async () => {
    const to = !live?.blocked
    try {
      if (to && !(await invoke<boolean>('dialog:confirm', t('net.confirmBlock')))) return
      const r = await invoke<{ blocked: boolean; needsAdmin: boolean }>('net:setBlocked', to)
      setLive((l) => (l ? { ...l, blocked: r.blocked, needsAdmin: r.needsAdmin } : l))
      toast(t(r.blocked ? 'net.blocked' : 'net.unblocked'), r.blocked ? 'warning' : 'success')
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
  }

  const patchLimits = async (patch: Partial<NetLimits>) => {
    if (!limits) return
    const prev = limits
    setLimits({ ...limits, ...patch })
    try {
      const cfg = await invoke<NetConfig>('net:setLimits', { ...limits, ...patch })
      setLimits(cfg.limits)
    } catch (e: unknown) {
      setLimits(prev)
      toast(e instanceof Error ? e.message : t('toast.error'), 'error')
    }
  }

  const capSliderGB = limits?.dailyCapMB == null ? 0 : limits.dailyCapMB / 1024
  const capInput = capGB ?? (limits?.dailyCapMB == null ? '' : trimNum(limits.dailyCapMB / 1024))
  const commitCap = () => {
    if (capGB == null || !limits) return
    const n = parseFloat(capGB)
    const next = !isFinite(n) || n <= 0 ? null : Math.round(n * 1024)
    setCapGB(null)
    if (next !== limits.dailyCapMB) void patchLimits({ dailyCapMB: next })
  }

  const quotaNum = parseFloat(pQuotaGB)
  const canSave = pName.trim().length > 0 && isFinite(quotaNum) && quotaNum > 0

  const savePlan = async () => {
    if (!canSave) return
    const next: NetPlan = {
      id: plan?.id ?? uid(),
      name: pName.trim(),
      quotaMB: Math.round(quotaNum * 1024),
      cycle: pCycle,
      cycleDays: pCycle === 'daily' ? 1 : pCycle === 'weekly' ? 7 : pCycle === 'monthly' ? 30 : Math.max(1, Math.floor(pCycleDays) || 1),
      startDate: pStart || isoDay(new Date()),
      active: true,
    }
    try {
      const cfg = await invoke<NetConfig>('net:setPlan', next)
      applyConfig(cfg)
      setHistory(await invoke<NetDay[]>('net:history', 30))
      toast(t('toast.saved'))
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
  }

  const clearPlan = async () => {
    try {
      const cfg = await invoke<NetConfig>('net:setPlan', null)
      applyConfig(cfg)
      toast(t('toast.deleted'))
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
  }

  const todayTotal = (live?.todayDownMB ?? 0) + (live?.todayUpMB ?? 0)
  const allowance = plan ? dailyAllowanceMB(plan, Date.now()) : null
  const effRaw = limits ? effectiveDailyCapMB(plan, limits.dailyCapMB, Date.now()) : null
  const effCap = typeof effRaw === 'number' && isFinite(effRaw) && effRaw > 0 ? effRaw : null
  const allowanceNum = typeof allowance === 'number' && isFinite(allowance) && allowance > 0 ? allowance : null
  const target = effCap ?? allowanceNum
  const pct = target ? Math.min(100, (todayTotal / target) * 100) : 0
  const remaining = target != null ? Math.max(0, target - todayTotal) : null
  const usage = plan ? planUsage(plan, history, Date.now()) : null
  const usedMB = Number(usage?.usedMB ?? 0) || 0
  const daysLeft = Number(usage?.daysLeft ?? 0) || 0
  const quotaPct = plan && plan.quotaMB > 0 ? Math.min(100, (usedMB / plan.quotaMB) * 100) : 0
  const rows = useMemo(() => lastNDays(history, 14, {
    date: live?.date ?? isoDay(new Date()),
    downMB: live?.todayDownMB ?? 0,
    upMB: live?.todayUpMB ?? 0,
  }), [history, live])
  const rows30 = useMemo(() => lastNDays(history, 30, {
    date: live?.date ?? isoDay(new Date()),
    downMB: live?.todayDownMB ?? 0,
    upMB: live?.todayUpMB ?? 0,
  }), [history, live])
  const maxDay = rows.reduce((m, d) => Math.max(m, (d.downMB ?? 0) + (d.upMB ?? 0)), 0)
  const totals = useMemo(() => weekTotals(rows), [rows])
  const best = rows.reduce((m, d) => Math.max(m, (d.downMB ?? 0) + (d.upMB ?? 0)), 0)
  const worst = rows.length > 0 ? rows.reduce((m, d) => Math.min(m, (d.downMB ?? 0) + (d.upMB ?? 0)), Infinity) : 0
  const depletion = projectDepletion(todayTotal, target, live?.downSpeedBps ?? 0)

  const pickExe = async () => {
    try {
      const files = await invoke<string[]>('dialog:openFile', { filters: [{ name: 'Executables', extensions: ['exe'] }] })
      const f = Array.isArray(files) ? files[0] : null
      if (!f) return
      setExePath(f)
      const st = await invoke<{ blocked: boolean }>('net:appBlockedCheck', f)
      setAppBlocked(!!st.blocked)
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
  }

  const toggleAppBlock = async () => {
    if (!/^[A-Za-z]:[\\/].*\.exe$/i.test(exePath.trim())) { toast(t('net.invalidExe'), 'error'); return }
    const to = !appBlocked
    try {
      if (to && !(await invoke<boolean>('dialog:confirm', t('net.confirmBlock')))) return
      const r = await invoke<{ blocked: boolean; needsAdmin: boolean }>('net:appBlocked', exePath.trim(), to)
      setAppBlocked(r.blocked)
      if (r.needsAdmin) toast(t('net.needsAdmin'), 'warning')
      else toast(t(r.blocked ? 'net.blocked' : 'net.unblocked'), r.blocked ? 'warning' : 'success')
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
  }

  const runSpeedTest = async () => {
    try {
      if (!(await invoke<boolean>('dialog:confirm', `${t('net.speedTest')}: ${t('net.speedTestDesc')}`))) return
      setSpeedRunning(true)
      setSpeedResult(null)
      const r = await invoke<{ mbps: number; bytes: number; ms: number }>('net:speedTest')
      setSpeedResult(r)
      toast(t('net.speedTestResult', { s: `${r.mbps} Mbps` }), 'success')
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
    finally { setSpeedRunning(false) }
  }

  const exportCsv = async () => {
    try {
      const fp = await invoke<string | null>('dialog:save', { defaultPath: `DragonHub-net-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] })
      if (!fp) return
      const csv = ['date,downMB,upMB,totalMB', ...rows30.map((d) => `${d.date},${d.downMB ?? 0},${d.upMB ?? 0},${(d.downMB ?? 0) + (d.upMB ?? 0)}`)].join('\n')
      await invoke('fs:writeText', fp, csv)
      toast(t('toast.saved'))
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
  }

  const showSkeleton = loading && !limits && !live

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader
        icon={<Wifi size={22} />}
        title={t('net.title')}
        subtitle={live ? (live.blocked ? t('net.blocked') : t('net.unblocked')) : undefined}
      >
        {limits && <Toggle on={limits.monitoringEnabled} onChange={(v) => void patchLimits({ monitoringEnabled: v })} label={t('net.monitoring')} />}
        <button className={live?.blocked ? 'btn-primary' : 'btn-danger'} onClick={toggleBlock}>
          {live?.blocked ? t('net.unblock') : t('net.blockNow')}
        </button>
      </PageHeader>

      {/* tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {TABS.map((v) => (
          <button key={v} onClick={() => switchTab(v)} className={`px-3.5 py-1.5 rounded-xl text-sm transition-all ${tab === v ? 'bg-accent text-accent-fg shadow-glow' : 'bg-surface-200/60 hover:bg-surface-200'}`}>
            {t(`net.tab${v[0].toUpperCase()}${v.slice(1)}` as 'net.tabOverview')}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-4 pb-4">
          {live?.blocked && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 px-4 py-3 text-sm flex items-center gap-2">
              <ShieldAlert size={16} /> {t('net.blocked')}
            </div>
          )}
          {live?.needsAdmin && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500 px-4 py-3 text-sm flex items-center gap-2">
              <AlertTriangle size={16} /> {t('net.needsAdmin')}
            </div>
          )}
          {target !== null && pct >= 80 && (
            <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${pct >= 90 ? 'border-rose-500/30 bg-rose-500/10 text-rose-500' : 'border-amber-500/30 bg-amber-500/10 text-amber-500'}`}>
              <AlertTriangle size={16} /> {t('net.alert80')} — {pct.toFixed(0)}%
            </div>
          )}

          {showSkeleton ? (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
              <Skeleton className="h-40 col-span-2 xl:col-span-4" />
            </div>
          ) : (
            <>
              {tab === 'overview' && (
                <>
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                    <div className="card p-4">
                      <div className="flex items-center gap-2 text-xs opacity-60 mb-1"><ArrowDown size={14} />{t('net.down')}</div>
                      <div className="text-2xl font-bold font-mono tabular-nums" dir="ltr">{formatSpeed(live?.downSpeedBps ?? 0)}</div>
                      <div className="text-[11px] opacity-50 mt-1">{t('net.live')}</div>
                    </div>
                    <div className="card p-4">
                      <div className="flex items-center gap-2 text-xs opacity-60 mb-1"><ArrowUp size={14} />{t('net.up')}</div>
                      <div className="text-2xl font-bold font-mono tabular-nums" dir="ltr">{formatSpeed(live?.upSpeedBps ?? 0)}</div>
                      <div className="text-[11px] opacity-50 mt-1">{t('net.live')}</div>
                    </div>
                    <div className="card p-4">
                      <div className="flex items-center gap-2 text-xs opacity-60 mb-1"><Download size={14} />{t('net.today')} • {t('net.down')}</div>
                      <div className="text-2xl font-bold font-mono tabular-nums" dir="ltr">{formatMB(live?.todayDownMB ?? 0)}</div>
                      <div className="text-[11px] opacity-50 mt-1">{t('net.today')}</div>
                    </div>
                    <div className="card p-4">
                      <div className="flex items-center gap-2 text-xs opacity-60 mb-1"><Upload size={14} />{t('net.today')} • {t('net.up')}</div>
                      <div className="text-2xl font-bold font-mono tabular-nums" dir="ltr">{formatMB(live?.todayUpMB ?? 0)}</div>
                      <div className="text-[11px] opacity-50 mt-1">{t('net.today')}</div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-3">
                    <section className="card p-5">
                      <h3 className="font-semibold mb-3 flex items-center gap-2 text-accent text-sm"><Signal size={15} />{t('net.connInfo')}</h3>
                      {connInfo && (connInfo.ssid || connInfo.adapter || connInfo.state) ? (
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><div className="text-[11px] opacity-60">{t('net.ssid')}</div><div className="font-semibold" dir="ltr">{connInfo.ssid ?? '—'}</div></div>
                          <div><div className="text-[11px] opacity-60">{t('net.signal')}</div><div className="font-mono" dir="ltr">{connInfo.signalPct !== null ? `${connInfo.signalPct}%` : '—'}</div></div>
                          <div><div className="text-[11px] opacity-60">{t('net.radio')}</div><div dir="ltr">{connInfo.radioType ?? '—'}</div></div>
                          <div><div className="text-[11px] opacity-60">{t('net.connState')}</div><div>{connInfo.state ?? '—'}</div></div>
                        </div>
                      ) : <div className="text-xs opacity-50">{t('net.unavailable')}</div>}
                    </section>
                    <section className="card p-5">
                      <h3 className="font-semibold mb-3 flex items-center gap-2 text-accent text-sm"><Gauge size={15} />{t('net.depletion')}</h3>
                      {target !== null ? (
                        depletion.willExceedToday
                          ? <p className="text-sm text-rose-500">{t('net.depletionExceeded')}</p>
                          : depletion.etaHours !== null
                            ? <p className="text-sm">{t('net.depletionEta', { h: depletion.etaHours.toFixed(1) })}</p>
                            : <p className="text-sm opacity-70">{t('net.depletionOk')}</p>
                      ) : <p className="text-sm opacity-50">{t('net.noData')}</p>}
                      <div className="flex items-center gap-3 mt-3"><Progress value={pct} /><span className="text-xs font-mono w-12 text-end" dir="ltr">{pct.toFixed(0)}%</span></div>
                      <div className="text-xs opacity-60 mt-2">{t('net.used')}: <span className="font-mono" dir="ltr">{formatMB(todayTotal)}</span> / {target !== null ? formatMB(target) : '—'}</div>
                    </section>
                  </div>
                </>
              )}

              {tab === 'plan' && (
                <section className="card p-5">
                  <h3 className="font-semibold mb-4 flex items-center gap-2 text-accent">{t('net.plan')}</h3>
                  {plan && (
                    <div className="rounded-xl bg-surface-200/60 p-4 mb-4 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="font-semibold">{plan.name}</div>
                        <span className="badge bg-accent/15 text-accent">{t(`net.${plan.cycle}`)}</span>
                      </div>
                      <div className="flex items-center gap-3"><Progress value={quotaPct} /><span className="text-xs font-mono w-12 text-end" dir="ltr">{quotaPct.toFixed(0)}%</span></div>
                      <div className="flex gap-x-6 gap-y-1 text-xs flex-wrap">
                        <span>{t('net.used')}: <span className="font-mono" dir="ltr">{formatMB(usedMB)} / {formatMB(plan.quotaMB)}</span></span>
                        <span>{t('net.allowance')}: <span className="font-mono" dir="ltr">{formatMB(allowanceNum ?? 0)}</span> {t('net.perDay')}</span>
                        <span>{t('net.daysLeft')}: <span className="font-mono" dir="ltr">{daysLeft}</span></span>
                      </div>
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label={t('net.planName')}><input className="input" value={pName} onChange={(e) => setPName(e.target.value)} /></Field>
                    <Field label={t('net.quotaGB')}><input type="number" min={0} step={0.5} dir="ltr" className="input font-mono" value={pQuotaGB} onChange={(e) => setPQuotaGB(e.target.value)} /></Field>
                    <Field label={t('net.cycle')}>
                      <select className="select" value={pCycle} onChange={(e) => setPCycle(e.target.value as PlanCycle)}>
                        {CYCLES.map((c) => <option key={c} value={c}>{t(`net.${c}`)}</option>)}
                      </select>
                    </Field>
                    {pCycle === 'custom'
                      ? <Field label={t('net.cycleDays')}><input type="number" min={1} step={1} dir="ltr" className="input font-mono" value={pCycleDays} onChange={(e) => setPCycleDays(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></Field>
                      : <Field label={t('net.startDate')}><input type="date" dir="ltr" className="input font-mono" value={pStart} onChange={(e) => setPStart(e.target.value)} /></Field>}
                  </div>
                  {pCycle === 'custom' && (
                    <div className="mt-3"><Field label={t('net.startDate')}><input type="date" dir="ltr" className="input font-mono" value={pStart} onChange={(e) => setPStart(e.target.value)} /></Field></div>
                  )}
                  <div className="flex justify-end gap-2 mt-4">
                    {plan && <button className="btn-ghost" onClick={() => void clearPlan()}>{t('net.clearPlan')}</button>}
                    <button className="btn-primary" disabled={!canSave} onClick={() => void savePlan()}>{t('net.savePlan')}</button>
                  </div>
                </section>
              )}

              {tab === 'limits' && (
                <section className="card p-5">
                  <h3 className="font-semibold mb-4 flex items-center gap-2 text-accent">{t('net.limit')}</h3>
                  {limits ? (
                    <div className="space-y-4">
                      <div className="flex items-end justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-[11px] opacity-60">{t('net.dailyCap')}</div>
                          <div className="text-2xl font-bold font-mono tabular-nums" dir="ltr">{target != null ? formatMB(target) : '—'}</div>
                        </div>
                        <div className="text-end text-xs space-y-1">
                          <div>{t('net.used')}: <span className="font-mono" dir="ltr">{formatMB(todayTotal)}</span></div>
                          <div>{t('net.remaining')}: <span className="font-mono" dir="ltr">{remaining != null ? formatMB(remaining) : '—'}</span></div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3"><Progress value={pct} /><span className="text-xs font-mono w-12 text-end" dir="ltr">{pct.toFixed(0)}%</span></div>
                      <Toggle on={limits.blockOnCap} onChange={(v) => void patchLimits({ blockOnCap: v })} label={t('net.blockOnCap')} />
                      <Field label={t('net.dailyCap')}>
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <Slider value={capSliderGB} min={0} max={100} step={1} suffix=" GB" onChange={(v) => void patchLimits({ dailyCapMB: v <= 0 ? null : Math.round(v * 1024) })} />
                          </div>
                          <input
                            type="number" min={0} step={0.5} dir="ltr" className="input w-28 font-mono"
                            value={capInput} onChange={(e) => setCapGB(e.target.value)} onBlur={commitCap}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          />
                        </div>
                      </Field>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <Toggle on={limits.restoreAtMidnight} onChange={(v) => void patchLimits({ restoreAtMidnight: v })} label={t('net.restoreMidnight')} />
                        <Toggle on={limits.restoreOnQuit} onChange={(v) => void patchLimits({ restoreOnQuit: v })} label={t('net.restoreQuit')} />
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm opacity-60">{t('common.loading')}</div>
                  )}
                </section>
              )}

              {tab === 'history' && (
                <section className="card p-5">
                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                    <h3 className="font-semibold flex items-center gap-2 text-accent flex-1">{t('net.history')}</h3>
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => void exportCsv()}><FileDown size={14} /> {t('net.exportCsv')}</button>
                  </div>
                  {history.length === 0 ? (
                    <Empty icon={<Wifi size={40} />} text={t('net.noData')} />
                  ) : (
                    <>
                      <Bars rows={rows} />
                      <div className="flex gap-x-6 gap-y-1 text-xs mt-3 flex-wrap">
                        <span>{t('net.avgDay')}: <span className="font-mono" dir="ltr">{formatMB(totals.avgPerDayMB)}</span></span>
                        <span>{t('net.bestDay')}: <span className="font-mono" dir="ltr">{formatMB(best)}</span></span>
                        <span>{t('net.worstDay')}: <span className="font-mono" dir="ltr">{formatMB(worst === Infinity ? 0 : worst)}</span></span>
                      </div>
                      <div className="overflow-x-auto mt-4">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs opacity-60">
                              <th className="text-start font-medium py-2 pe-3">{t('net.date')}</th>
                              <th className="text-start font-medium py-2 pe-3">{t('net.down')}</th>
                              <th className="text-start font-medium py-2 pe-3">{t('net.up')}</th>
                              <th className="text-start font-medium py-2 pe-3">{t('net.total')}</th>
                              <th className="w-32" />
                            </tr>
                          </thead>
                          <tbody>
                            {[...rows].reverse().map((d) => {
                              const tot = (d.downMB ?? 0) + (d.upMB ?? 0)
                              return (
                                <tr key={d.date} className="border-t border-surface-300/60">
                                  <td className="py-2 pe-3 whitespace-nowrap">{fmtDay(d.date, i18n.language)}</td>
                                  <td className="py-2 pe-3 font-mono tabular-nums" dir="ltr">{formatMB(d.downMB ?? 0)}</td>
                                  <td className="py-2 pe-3 font-mono tabular-nums" dir="ltr">{formatMB(d.upMB ?? 0)}</td>
                                  <td className="py-2 pe-3 font-mono tabular-nums" dir="ltr">{formatMB(tot)}</td>
                                  <td className="py-2 w-32"><Progress value={maxDay > 0 ? (tot / maxDay) * 100 : 0} /></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  <p className="text-[11px] opacity-50 mt-3">{t('net.footnote')}</p>
                </section>
              )}

              {tab === 'tools' && (
                <div className="space-y-4">
                  <section className="card p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold flex items-center gap-2 text-accent text-sm flex-1"><Radar size={15} />{t('net.radar')}</h3>
                      <button className="btn-ghost !py-1.5 text-xs" onClick={() => { invoke<Conn[]>('net:connections').then((c) => setConns(Array.isArray(c) ? c : [])).catch(() => {}) }}>{t('common.refresh')}</button>
                    </div>
                    <p className="text-[11px] opacity-50 mb-3">{t('net.radarDesc')}</p>
                    {conns.length === 0 ? (
                      <div className="text-xs opacity-50">{t('net.noConns')}</div>
                    ) : (
                      <div className="overflow-x-auto max-h-72 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-surface-100">
                            <tr className="opacity-60">
                              <th className="text-start font-medium py-1.5 pe-3">{t('net.process')}</th>
                              <th className="text-start font-medium py-1.5 pe-3">{t('net.remote')}</th>
                              <th className="text-start font-medium py-1.5 pe-3">{t('net.local')}</th>
                              <th className="text-start font-medium py-1.5 pe-3">PID</th>
                              <th className="text-start font-medium py-1.5 pe-3">State</th>
                            </tr>
                          </thead>
                          <tbody>
                            {conns.map((c, i) => (
                              <tr key={`${c.pid}-${c.local}-${c.remote}-${i}`} className="border-t border-surface-300/60">
                                <td className="py-1.5 pe-3 font-medium">{c.process || '—'}</td>
                                <td className="py-1.5 pe-3 font-mono" dir="ltr">{c.remote}</td>
                                <td className="py-1.5 pe-3 font-mono opacity-70" dir="ltr">{c.local}</td>
                                <td className="py-1.5 pe-3 font-mono" dir="ltr">{c.pid}</td>
                                <td className="py-1.5 pe-3 opacity-70">{c.state}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="card p-5">
                    <h3 className="font-semibold mb-1 flex items-center gap-2 text-accent text-sm"><Ban size={15} />{t('net.appBlock')}</h3>
                    <p className="text-[11px] opacity-50 mb-3">{t('net.appBlockDesc')}</p>
                    <div className="flex gap-2 flex-wrap">
                      <input className="input flex-1 min-w-[220px] font-mono" dir="ltr" value={exePath} onChange={(e) => setExePath(e.target.value)} placeholder="C:\Program Files\App\app.exe" />
                      <button className="btn-ghost" onClick={() => void pickExe()}>{t('net.pickExe')}</button>
                      <button className={appBlocked ? 'btn-primary' : 'btn-danger'} disabled={!exePath.trim()} onClick={() => void toggleAppBlock()}>
                        {appBlocked ? t('net.unblockApp') : t('net.blockApp')}
                      </button>
                    </div>
                    {appBlocked !== null && <p className="text-xs mt-2 opacity-70">{appBlocked ? t('net.blocked') : t('net.unblocked')}</p>}
                  </section>

                  <section className="card p-5">
                    <h3 className="font-semibold mb-1 text-accent text-sm">{t('net.speedTest')}</h3>
                    <p className="text-[11px] text-amber-500 mb-3">⚠ {t('net.speedTestDesc')}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button className="btn-primary" disabled={speedRunning} onClick={() => void runSpeedTest()}>
                        {speedRunning ? t('net.speedTestRunning') : t('net.speedTestRun')}
                      </button>
                      {speedResult && <span className="text-sm font-mono" dir="ltr">{speedResult.mbps} Mbps • {(speedResult.bytes / 1024 / 1024).toFixed(1)} MB • {(speedResult.ms / 1000).toFixed(1)}s</span>}
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
