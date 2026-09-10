import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Info, Send, Heart, Sparkles, Bug, Wrench, ShieldCheck, Cpu, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/ui'
import { Logo } from '@/components/Shell'
import { invoke } from '@/lib/api'
import { CHANGELOG, DEVELOPER, TELEGRAM_URL, APP_VERSION } from '@shared/types'
import type { VersionInfo } from '@shared/types'

const ICON = { added: <Sparkles size={12} className="text-emerald-400" />, changed: <Wrench size={12} className="text-blue-400" />, fixed: <Bug size={12} className="text-amber-400" />, security: <ShieldCheck size={12} className="text-violet-400" /> }

export default function About() {
  const { t } = useTranslation()
  const [v, setV] = useState<VersionInfo | null>(null)
  useEffect(() => { invoke('app:version').then(setV).catch(() => {}) }, [])

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
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="btn-primary" onClick={() => invoke('app:openTelegram')}>
                <Send size={16} /> {t('about.contact')} <span className="opacity-70 text-xs" dir="ltr">t.me/ahmaddragon</span>
              </motion.button>
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
              <button className="btn mt-4 w-full" onClick={() => invoke('app:openExternal', TELEGRAM_URL)} title={TELEGRAM_URL}><RefreshCw size={14} /> {t('about.checkUpdate')}</button>
              <p className="text-[11px] opacity-50 mt-2">{t('about.updatesNote')}</p>
            </section>
            <section className="card p-5 min-w-0">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-accent"><ShieldCheck size={16} /> {t('about.license')}</h3>
              <p className="text-sm opacity-70 leading-relaxed break-words">{t('about.licenseText')}</p>
              <div className="mt-4 p-3 rounded-xl bg-surface-200 text-xs font-mono break-all" dir="ltr">{t('about.developer')}: <b>{DEVELOPER}</b><br />{t('about.contact')}: {TELEGRAM_URL}<br />DragonHub v{APP_VERSION} (Windows 10/11 x64)</div>
            </section>
          </div>

          <section className="card p-5">
            <h3 className="font-semibold mb-3 text-accent">{t('about.changelog')}</h3>
            {CHANGELOG.map((c) => (
              <div key={c.version} className="mb-4">
                <div className="flex items-center gap-2 mb-2"><span className="badge bg-accent text-white">v{c.version}</span><span className="text-xs opacity-50">{c.date}</span></div>
                <ul className="space-y-1 text-sm">{c.changes.map((ch, i) => <li key={i} className="flex items-start gap-2"><span className="mt-1">{ICON[ch.type]}</span><span>{ch.text}</span></li>)}</ul>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}
