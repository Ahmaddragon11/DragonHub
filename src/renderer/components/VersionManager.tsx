import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Archive, ChevronDown, ChevronUp, Download, HardDriveDownload, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useApp } from '@/store'
import { invoke, on, errorMessage } from '@/lib/api'
import { cn, formatBytes } from '@/lib/utils'
import { APP_VERSION } from '@shared/types'
import type { ManagedRelease, VersionProgressEvent } from '@shared/types'

type RelState = 'current' | 'newer' | 'older'

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** Browse every published stable release and install any older build.
 *  Downloads are SHA-256 verified in the main process before install. */
export default function VersionManager() {
  const { t } = useTranslation()
  const { toast } = useApp(useShallow((s) => ({ toast: s.toast })))
  const [releases, setReleases] = useState<ManagedRelease[] | null>(null)
  const [error, setError] = useState('')
  const [busyVersion, setBusyVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState<VersionProgressEvent | null>(null)
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const busyRef = useRef<string | null>(null)
  busyRef.current = busyVersion

  const load = useCallback(async (force = false) => {
    try {
      setError('')
      setReleases(await invoke<ManagedRelease[]>('versions:list', force))
    } catch (e) {
      setError(errorMessage(e, t('toast.error')))
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  // Progress stream for the active download only.
  useEffect(() => {
    const off = on<VersionProgressEvent>('versions:progress', (ev) => {
      if (!ev || ev.version !== busyRef.current) return
      setProgress(ev)
    })
    return off
  }, [])

  const stateOf = (version: string): RelState => {
    const c = compareVersions(version, APP_VERSION)
    if (c === 0) return 'current'
    return c > 0 ? 'newer' : 'older'
  }

  const download = async (rel: ManagedRelease) => {
    if (busyVersion) return
    if (!rel.installerName) { toast(t('about.versions.notFound'), 'error'); return }
    setBusyVersion(rel.version)
    setProgress(null)
    try {
      const res = await invoke<{ status: string }>('versions:download', rel.version)
      if (res?.status === 'downloaded') {
        setDownloaded((d) => ({ ...d, [rel.version]: true }))
        toast(t('about.versions.downloaded'))
      }
    } catch (e) {
      toast(errorMessage(e, t('toast.error')), 'error')
    } finally {
      setBusyVersion(null)
      setProgress(null)
    }
  }

  const cancel = async () => {
    try { await invoke('versions:cancel') } catch { /* already done */ }
  }

  const install = async (rel: ManagedRelease) => {
    try {
      if (!await invoke<boolean>('dialog:confirm', t('about.versions.confirmTitle', { version: rel.version }), t('about.versions.confirmDetail'))) return
      await invoke('versions:install', rel.version)
      toast(t('about.versions.installed'))
    } catch (e) {
      toast(errorMessage(e, t('toast.error')), 'error')
    }
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="versions-heading">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="versions-heading" className="flex items-center gap-2 font-semibold text-accent"><HardDriveDownload size={17} />{t('about.versions.title')}</h3>
          <p className="mt-1 text-xs opacity-60">{t('about.versions.desc')}</p>
        </div>
        <button className="btn-sm btn-soft" onClick={() => void load(true)} disabled={!!busyVersion}>
          <RefreshCw size={13} className={busyVersion ? 'animate-spin' : undefined} />{t('about.versions.refresh')}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-500 mb-3">
          {t('about.versions.error')} — {error}
        </div>
      )}

      {!releases && !error && (
        <div className="space-y-2">
          <div className="shimmer h-16" />
          <div className="shimmer h-16" />
          <p className="text-xs opacity-50 text-center py-2">{t('about.versions.loading')}</p>
        </div>
      )}

      {releases && releases.length === 0 && (
        <p className="rounded-xl bg-surface-100 p-5 text-center text-sm opacity-60">{t('about.versions.empty')}</p>
      )}

      <div className="space-y-2.5">
        {releases?.map((rel) => {
          const state = stateOf(rel.version)
          const isBusy = busyVersion === rel.version
          const isReady = downloaded[rel.version]
          const notesOpen = !!expanded[rel.version]
          return (
            <article key={rel.version} data-state={state} className={cn('rel-row rounded-xl border p-3.5 sm:p-4 transition-colors',
              state === 'current' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[color:var(--hairline)] hover:border-accent/30')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('badge', state === 'current' ? 'bg-emerald-500 text-white' : 'bg-surface-200 text-surface-700')}>v{rel.version}</span>
                {state === 'current' && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500"><ShieldCheck size={11} />{t('about.versions.current')}</span>}
                {state === 'newer' && <span className="text-[11px] font-semibold text-accent">{rel.version === releases[0]?.version ? t('about.versions.latest') : t('about.versions.newer')}</span>}
                {state === 'older' && <span className="text-[11px] opacity-50">{t('about.versions.older')}</span>}
                {rel.hasPortable && <span className="badge bg-surface-200 text-surface-600"><Archive size={10} />{t('about.versions.portable')}</span>}
                <span className="ms-auto flex items-center gap-3 text-[11px] opacity-50 tabular-nums">
                  {rel.publishedAt && <time dateTime={rel.publishedAt}>{new Date(rel.publishedAt).toLocaleDateString()}</time>}
                  {rel.installerSize != null && <span>{formatBytes(rel.installerSize, 1)}</span>}
                </span>
              </div>

              {rel.notes && (
                <div className="mt-2.5">
                  <p className={cn('rel-notes text-[12px] leading-relaxed opacity-70', !notesOpen && 'rel-notes-clamp')}>{rel.notes}</p>
                  <button className="btn-sm btn-ghost opacity-60 -ms-2 mt-0.5" onClick={() => setExpanded((e) => ({ ...e, [rel.version]: !notesOpen }))}
                    aria-expanded={notesOpen}>
                    {notesOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    {notesOpen ? t('about.versions.hideNotes') : t('about.versions.showNotes')}
                  </button>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isReady ? (
                  <button className="btn-sm btn-primary" onClick={() => void install(rel)}>
                    <Download size={13} />{t('about.versions.install')} v{rel.version}
                  </button>
                ) : isBusy ? (
                  <>
                    <button className="btn-sm btn-outline text-rose-500 border-rose-500/40" onClick={() => void cancel()}><X size={12} />{t('about.versions.cancel')}</button>
                    <span className="text-[11px] opacity-60">
                      {progress?.phase === 'verifying' ? t('about.versions.verifying') : t('about.versions.downloading')}
                    </span>
                  </>
                ) : (
                  <button className="btn-sm btn-soft" onClick={() => void download(rel)} disabled={!!busyVersion || !rel.installerName} title={!rel.installerName ? t('about.versions.notFound') : undefined}>
                    <Download size={13} />{t('about.versions.download')}{rel.installerSize != null ? ` · ${formatBytes(rel.installerSize, 1)}` : ''}
                  </button>
                )}
                {state === 'current' && <span className="text-[11px] opacity-50">(v{APP_VERSION})</span>}
              </div>

              {isBusy && (
                <div className="mt-2.5">
                  <div className="update-track">
                    <div className="update-fill" style={{ width: progress?.totalBytes ? `${Math.min(100, ((progress.receivedBytes ?? 0) / progress.totalBytes) * 100)}%` : '100%' }} />
                  </div>
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[10.5px] opacity-50 mt-1 tabular-nums">
                    {progress?.totalBytes
                      ? `${formatBytes(progress.receivedBytes ?? 0, 0)} / ${formatBytes(progress.totalBytes, 0)}${progress.speed ? ` · ${formatBytes(progress.speed)}/s` : ''}`
                      : '…'}
                  </motion.p>
                </div>
              )}
            </article>
          )
        })}
      </div>

      <p className="mt-4 text-[11px] opacity-50 leading-relaxed">
        {t('about.versions.prereleaseNote')}<br />{t('about.versions.cleanupNote')}
      </p>
    </section>
  )
}
