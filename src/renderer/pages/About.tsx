import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Info, Send, Github, Heart, Sparkles, Bug, Wrench, ShieldCheck, Cpu, Search, ChevronDown, ChevronUp, History } from 'lucide-react'
import { PageHeader } from '@/components/ui'
import { GlowButton, FlyIcon, FlySpark } from '@/components/Glow'
import { Logo } from '@/components/Shell'
import { UpdateCard } from '@/components/UpdateCard'
import { invoke } from '@/lib/api'
import { CHANGELOG, DEVELOPER, TELEGRAM_URL, GITHUB_URL, APP_VERSION } from '@shared/types'
import type { VersionInfo } from '@shared/types'

const ICON = { added: <Sparkles size={12} className="text-emerald-400" />, changed: <Wrench size={12} className="text-blue-400" />, fixed: <Bug size={12} className="text-amber-400" />, security: <ShieldCheck size={12} className="text-violet-400" /> }
const CHANGE_TYPES = ['all', 'added', 'changed', 'fixed', 'security'] as const
type ChangeFilter = typeof CHANGE_TYPES[number]

export default function About() {
  const { t } = useTranslation()
  const [v, setV] = useState<VersionInfo | null>(null)
  const [changelogQuery, setChangelogQuery] = useState('')
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all')
  const [showAllVersions, setShowAllVersions] = useState(false)
  useEffect(() => { invoke('app:version').then(setV).catch(() => {}) }, [])

  const openExternalWithConfirm = async (url: string, message: string, detail: string) => {
    try {
      if (await invoke<boolean>('dialog:confirm', message, detail)) await invoke('app:openExternal', url)
    } catch { /* user cancelled or the URL was blocked */ }
  }

  const filteredChangelog = useMemo(() => {
    const query = changelogQuery.trim().toLocaleLowerCase()
    return CHANGELOG.map((release) => ({
      ...release,
      changes: release.changes.filter((change) =>
        (changeFilter === 'all' || change.type === changeFilter) &&
        (!query || `${release.version} ${release.date} ${change.text}`.toLocaleLowerCase().includes(query)),
      ),
    })).filter((release) => release.changes.length > 0)
  }, [changelogQuery, changeFilter])
  const isFilteringChangelog = !!changelogQuery.trim() || changeFilter !== 'all'
  const visibleChangelog = isFilteringChangelog || showAllVersions
    ? filteredChangelog
    : filteredChangelog.slice(0, 3)

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('about.title')} icon={<Info />} />
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card p-8 text-center relative overflow-hidden">
            <div className="absolute inset-0 aurora opacity-40 pointer-events-none" />
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }} className="relative mx-auto w-fit mb-4"><Logo size={88} /></motion.div>
            <h1 className="relative text-4xl font-black gradient-text">DragonHub</h1>
            <div className="relative badge mt-2 bg-surface-200 text-surface-700">v{v?.version || APP_VERSION} • {v?.channel || 'stable'}</div>
            <p className="relative text-sm opacity-70 mt-4 max-w-xl mx-auto leading-relaxed">{t('about.desc')}</p>
            <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
              <div className="text-sm"><span className="opacity-50">{t('about.developer')}:</span> <span className="font-bold text-accent">{DEVELOPER}</span></div>
              <GlowButton tone="telegram" className="btn-primary fly-host"
                onClick={() => openExternalWithConfirm(TELEGRAM_URL, t('about.confirmTelegram'), t('about.confirmTelegramDetail', { url: TELEGRAM_URL }))}>
                <FlyIcon><Send size={16} /></FlyIcon> {t('about.contact')} <span className="opacity-70 text-xs" dir="ltr">t.me/ahmaddragon</span><FlySpark />
              </GlowButton>
              <GlowButton tone="github" surface className="btn-ghost fly-host"
                onClick={() => openExternalWithConfirm(GITHUB_URL, t('about.confirmGithub'), t('about.confirmGithubDetail', { url: GITHUB_URL }))}>
                <FlyIcon><Github size={16} /></FlyIcon> {t('about.github')} <span className="opacity-70 text-xs" dir="ltr">github.com/Ahmaddragon11/DragonHub</span><FlySpark />
              </GlowButton>
            </div>
            <div className="relative text-xs opacity-50 mt-4 flex items-center justify-center gap-1">{t('about.techStack')} <Heart size={11} className="text-rose-400 fill-rose-400" /></div>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <section className="card p-5 min-w-0">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-accent"><Cpu size={16} /> {t('about.versionInfo')}</h3>
              <dl className="text-sm space-y-1.5 min-w-0">
                {v && Object.entries({ version: v.version, build: v.build, releaseDate: v.releaseDate, electron: v.electron, chrome: v.chrome, node: v.node, platform: `${v.platform} ${v.arch}` }).map(([k, val]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-surface-300/50 pb-1 min-w-0"><dt className="opacity-50 capitalize shrink-0">{k}</dt><dd className="font-mono text-xs min-w-0 text-end break-all" dir="ltr">{val}</dd></div>
                ))}
              </dl>
              <div className="mt-4">
                <UpdateCard />
              </div>
              <p className="text-[11px] opacity-50 mt-2">{t('about.updatesNote')}</p>
            </section>
            <section className="card p-5 min-w-0">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-accent"><ShieldCheck size={16} /> {t('about.license')}</h3>
              <p className="text-sm opacity-70 leading-relaxed break-words">{t('about.licenseText')}</p>
              <div className="mt-4 p-3 rounded-xl bg-surface-200 text-xs font-mono break-all" dir="ltr">{t('about.developer')}: <b>{DEVELOPER}</b><br />{t('about.contact')}: {TELEGRAM_URL}<br />DragonHub v{APP_VERSION} (Windows 10/11 x64)</div>
            </section>
          </div>

          <section className="card p-5 sm:p-6" aria-labelledby="changelog-heading">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="changelog-heading" className="flex items-center gap-2 font-semibold text-accent"><History size={17} />{t('about.changelog')}</h3>
                <p className="mt-1 text-xs opacity-60">{t('about.changelogDescription')}</p>
              </div>
              <span className="badge bg-surface-200 text-surface-700">{t('about.changelogVersionCount', { count: CHANGELOG.length })}</span>
            </div>

            <label className="relative block">
              <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 opacity-50" />
              <input
                type="search"
                value={changelogQuery}
                onChange={(event) => setChangelogQuery(event.target.value)}
                placeholder={t('about.searchChangelog')}
                aria-label={t('about.searchChangelog')}
                className="input w-full ps-9"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('about.filterChangelog')}>
              {CHANGE_TYPES.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${changeFilter === filter ? 'border-accent bg-accent text-white' : 'border-surface-300 bg-surface-100 hover:bg-surface-200'}`}
                  aria-pressed={changeFilter === filter}
                  onClick={() => setChangeFilter(filter)}
                >
                  {t(`about.changeType.${filter}`)}
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-3" aria-live="polite">
              {visibleChangelog.map((release) => {
                const isLatest = CHANGELOG[0]?.version === release.version
                return (
                  <article
                    key={release.version}
                    className={`rounded-xl border p-4 sm:p-5 ${isLatest ? 'border-accent/30 bg-accent/5' : 'border-surface-300/70 bg-surface-100/40'}`}
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className={`badge ${isLatest ? 'bg-accent text-white' : 'bg-surface-200 text-surface-700'}`}>v{release.version}</span>
                      {isLatest && <span className="text-[11px] font-semibold text-accent">{t('about.latestRelease')}</span>}
                      <time className="ms-auto text-xs opacity-50" dateTime={release.date}>{release.date}</time>
                    </div>
                    <ul className="space-y-2">
                      {release.changes.map((change, changeIndex) => (
                        <li key={`${release.version}-${change.type}-${changeIndex}`} className="flex items-start gap-2.5 text-sm leading-relaxed">
                          <span className="mt-1 shrink-0" aria-hidden="true">{ICON[change.type]}</span>
                          <span className="min-w-0 break-words">{change.text}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                )
              })}
              {visibleChangelog.length === 0 && (
                <p className="rounded-xl bg-surface-100 p-5 text-center text-sm opacity-60">{t('about.noChangelogResults')}</p>
              )}
            </div>

            {!isFilteringChangelog && filteredChangelog.length > 3 && (
              <button
                type="button"
                className="btn mt-4 w-full justify-center"
                aria-expanded={showAllVersions}
                onClick={() => setShowAllVersions((expanded) => !expanded)}
              >
                {showAllVersions ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {t(showAllVersions ? 'about.showFewerVersions' : 'about.showMoreVersions', { count: filteredChangelog.length - 3 })}
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
