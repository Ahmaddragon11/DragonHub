import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { CheckCircle2, ChevronDown, ChevronUp, Clock, Download, Gauge, Info, RefreshCw, Rocket, X } from 'lucide-react'
import { useApp } from '@/store'
import { invoke } from '@/lib/api'
import { cn, formatBytes, formatDuration } from '@/lib/utils'
import { spring, useMotionPrefs } from '@/lib/motion'
import { Logo } from '@/components/Shell'
import { APP_VERSION } from '@shared/types'

type PendingAction = 'check' | 'cancel' | 'install' | null

interface CheckResult { status: 'unsupported' | 'up-to-date' | 'available' | 'cancelled'; version?: string }

/** Single stat tile (downloaded / speed / ETA). */
function Stat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-200/60 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-surface-500">
        <span className="shrink-0 text-accent/80" aria-hidden>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-[13px] font-semibold tabular-nums" dir="ltr">{value}</div>
      {sub && <div className="truncate text-[10px] text-surface-500" dir="ltr">{sub}</div>}
    </div>
  )
}

/**
 * Global update card — a floating, dismissible overlay (mounted once in App) that
 * doubles as the inline update panel on the About page. The rotating gradient
 * border is pure CSS (see `.update-card` in styles/index.css); React state only
 * changes on real progress events, never per frame.
 */
export function UpdateCard({ floating = false, className }: { floating?: boolean; className?: string }) {
  const { t } = useTranslation()
  const { reduced } = useMotionPrefs()
  const {
    updateProgress, updateAvailableVersion, updateReady, updateCardDismissedVersion, page,
    setUpdateProgress, setUpdateAvailableVersion, setUpdateReady, dismissUpdateCard, toast,
  } = useApp(useShallow((s) => ({
    updateProgress: s.updateProgress,
    updateAvailableVersion: s.updateAvailableVersion,
    updateReady: s.updateReady,
    updateCardDismissedVersion: s.updateCardDismissedVersion,
    page: s.page,
    setUpdateProgress: s.setUpdateProgress,
    setUpdateAvailableVersion: s.setUpdateAvailableVersion,
    setUpdateReady: s.setUpdateReady,
    dismissUpdateCard: s.dismissUpdateCard,
    toast: s.toast,
  })))
  const [collapsed, setCollapsed] = useState(false)
  const [pending, setPending] = useState<PendingAction>(null)

  const phase = updateProgress?.phase ?? null
  const isChecking = phase === 'checking'
  const isDownloading = phase === 'downloading'
  const isActive = isChecking || isDownloading
  const received = updateProgress?.receivedBytes ?? 0
  const total = updateProgress?.totalBytes
  const speed = updateProgress?.speed
  const eta = updateProgress?.eta
  const percent = total && total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null
  const indeterminate = isDownloading && percent === null
  const etaText = eta != null && Number.isFinite(eta) && eta > 0 ? formatDuration(eta) : t('updatecard.stats.unknown')
  const speedText = speed != null && Number.isFinite(speed) && speed > 0 ? `${formatBytes(speed)}/s` : t('updatecard.stats.unknown')

  const dismissed = !!updateCardDismissedVersion && updateCardDismissedVersion === updateAvailableVersion
  // The floating card hides itself when dismissed (for that version) or while the
  // About page already shows the inline copy. Active work is always visible.
  const visible = floating
    ? !dismissed && page !== 'about' && (isActive || !!updateAvailableVersion)
    : true

  const statusText = isChecking
    ? t('updatecard.status.checking')
    : isDownloading
      ? t('updatecard.status.downloading')
      : updateAvailableVersion
        ? t(updateReady ? 'updatecard.status.ready' : 'updatecard.status.available', { version: updateAvailableVersion })
        : t('updatecard.status.idle')

  const StatusIcon = isChecking ? RefreshCw : isDownloading ? Download : updateAvailableVersion ? (updateReady ? CheckCircle2 : Download) : Info

  const runCheck = async () => {
    setPending('check')
    setUpdateReady(false)
    setUpdateProgress({ phase: 'checking' })
    try {
      const result = await invoke<CheckResult>('app:checkForUpdates')
      setUpdateProgress(null)
      if (result.status === 'up-to-date') {
        setUpdateAvailableVersion(null)
        toast(t('updatecard.messages.upToDate'), 'success')
      } else if (result.status === 'unsupported') {
        toast(t('updatecard.messages.unsupported'), 'info')
      } else if (result.status === 'cancelled') {
        toast(t('updatecard.messages.cancelled'), 'info')
      } else if (result.status === 'available' && result.version) {
        setUpdateAvailableVersion(result.version)
        setUpdateReady(true)
      }
    } catch (error) {
      setUpdateProgress(null)
      toast(error instanceof Error ? error.message : t('updatecard.messages.error'), 'error')
    } finally {
      setPending(null)
    }
  }

  const cancel = async () => {
    setPending('cancel')
    try {
      const cancelled = await invoke<boolean>('app:cancelUpdateDownload')
      if (!cancelled) toast(t('updatecard.messages.cancelUnavailable'), 'info')
    } catch (error) {
      toast(error instanceof Error ? error.message : t('updatecard.messages.error'), 'error')
    } finally {
      setPending(null)
    }
  }

  const install = async () => {
    setPending('install')
    try {
      await invoke('app:installUpdate')
    } catch (error) {
      setPending(null)
      toast(error instanceof Error ? error.message : t('updatecard.messages.error'), 'error')
    }
  }

  const later = () => {
    dismissUpdateCard(updateAvailableVersion)
    toast(t('updatecard.messages.later'), 'info')
  }

  const motionProps = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : { initial: { opacity: 0, y: 14, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 10, scale: 0.97 }, transition: spring.soft }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={floating ? 'update-card-floating' : 'update-card-inline'}
          role="region"
          aria-label={t('updatecard.a11y.region')}
          className={cn('update-card', floating && 'update-card-floating', className)}
          {...motionProps}
        >
          <div className="update-card-content p-4">
            <div className="flex items-center gap-3">
              <Logo size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[13px] font-semibold tracking-tight">{t('updatecard.title')}</h2>
                  <span className={cn('badge shrink-0', updateAvailableVersion ? 'bg-accent/12 text-accent' : 'bg-surface-200 text-surface-600')} dir="ltr">
                    v{updateAvailableVersion || APP_VERSION}
                  </span>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-surface-500">
                  <StatusIcon size={13} className={cn('shrink-0', isChecking ? 'animate-spin text-accent' : 'text-accent')} aria-hidden />
                  <span className="truncate">{statusText}</span>
                </p>
              </div>
              {isActive && (
                <button
                  type="button"
                  className="btn-icon shrink-0 p-1"
                  aria-label={t(collapsed ? 'updatecard.a11y.expand' : 'updatecard.a11y.collapse')}
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsed((c) => !c)}
                >
                  {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
              )}
              {!isActive && floating && (
                <button type="button" className="btn-icon shrink-0 p-1" aria-label={t('updatecard.a11y.close')} onClick={later}>
                  <X size={16} />
                </button>
              )}
            </div>

            {isActive && (
              <div className="mt-3.5 space-y-2" aria-live="polite">
                <div className="flex items-end justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-surface-500">{statusText}</span>
                  {percent !== null && <span className="text-xl font-bold leading-none tabular-nums text-accent" dir="ltr">{percent}%</span>}
                </div>
                <div
                  className="update-track"
                  role="progressbar"
                  aria-label={t('updatecard.a11y.progress')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent ?? undefined}
                >
                  <div
                    className={cn('update-fill', indeterminate && 'update-fill-indeterminate')}
                    style={indeterminate ? undefined : { width: `${percent ?? 0}%` }}
                  />
                </div>
                {!collapsed && isDownloading && (
                  <div className="grid grid-cols-3 gap-2 pt-0.5">
                    <Stat icon={<Download size={12} />} label={t('updatecard.stats.downloaded')} value={formatBytes(received)} sub={total ? `/ ${formatBytes(total)}` : undefined} />
                    <Stat icon={<Gauge size={12} />} label={t('updatecard.stats.speed')} value={speedText} />
                    <Stat icon={<Clock size={12} />} label={t('updatecard.stats.eta')} value={etaText} />
                  </div>
                )}
              </div>
            )}

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {isActive && (
                <button type="button" className="btn" onClick={cancel} disabled={pending === 'cancel'}>
                  <X size={14} /> {pending === 'cancel' ? t('updatecard.actions.cancelling') : t('updatecard.actions.cancel')}
                </button>
              )}

              {!isActive && updateAvailableVersion && updateReady && (
                <>
                  <button type="button" className="btn-primary flex-1 justify-center" onClick={install} disabled={pending === 'install'}>
                    <Rocket size={15} /> {pending === 'install' ? t('updatecard.actions.installing') : t('updatecard.actions.installNow')}
                  </button>
                  <button type="button" className="btn" onClick={later}>{t('updatecard.actions.later')}</button>
                  <button type="button" className="btn-ghost" onClick={runCheck} disabled={pending === 'check'}>
                    <RefreshCw size={14} /> {t('updatecard.actions.checkAgain')}
                  </button>
                  <p className="w-full text-[10.5px] leading-relaxed text-surface-500">{t('updatecard.actions.installHint')}</p>
                </>
              )}

              {!isActive && updateAvailableVersion && !updateReady && (
                <>
                  <button type="button" className="btn-primary flex-1 justify-center" onClick={runCheck} disabled={pending === 'check'}>
                    <Download size={15} /> {t('updatecard.actions.download')}
                  </button>
                  <button type="button" className="btn" onClick={later}>{t('updatecard.actions.later')}</button>
                </>
              )}

              {!isActive && !updateAvailableVersion && (
                <button type="button" className="btn w-full justify-center" onClick={runCheck} disabled={pending === 'check'}>
                  <RefreshCw size={14} className={pending === 'check' ? 'animate-spin' : ''} /> {t('updatecard.actions.check')}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default UpdateCard
