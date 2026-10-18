import { useEffect } from 'react'
import { useApp } from '@/store'
import '../styles/backgrounds.css'

export const BG_PRESET_IDS = ['aurora', 'ocean-waves', 'starfield', 'mesh-gradient', 'liquid-blobs', 'neon-grid', 'sunset-flow', 'ember'] as const
export type BgPresetId = typeof BG_PRESET_IDS[number]

const LAYERS: Record<BgPresetId, number> = {
  aurora: 3, 'ocean-waves': 3, starfield: 4, 'mesh-gradient': 4, 'liquid-blobs': 3, 'neon-grid': 3, 'sunset-flow': 3, ember: 4
}

/** Animated background presets (v1.5.0). Styling lives in styles/backgrounds.css
 *  and is driven by html[data-bg-preset]; nothing renders when none is selected. */
export default function BackgroundLayer() {
  const preset = useApp((s) => s.settings.backgroundPreset)
  // Pause preset animations while the window is hidden (Electron keeps firing
  // timers/frames otherwise); class lives on <html> for the CSS to react to.
  useEffect(() => {
    const togglePause = () => document.documentElement.classList.toggle('bgp-paused', document.hidden)
    togglePause()
    document.addEventListener('visibilitychange', togglePause)
    return () => {
      document.removeEventListener('visibilitychange', togglePause)
      document.documentElement.classList.remove('bgp-paused')
    }
  }, [])
  if (!preset || !(LAYERS as Record<string, number>)[preset]) return null
  return (
    <div className="bg-preset" data-preset={preset} aria-hidden="true">
      {Array.from({ length: LAYERS[preset as BgPresetId] }, (_, i) => <span key={i} className={`l${i + 1}`} />)}
    </div>
  )
}
