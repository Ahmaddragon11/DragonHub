/**
 * Motion system — single source of truth for easing, springs and durations.
 *
 * Principles
 * - Motion communicates cause → response → state; it never blocks input.
 * - Enter = ease-out / spring (fast start, soft landing). Exit = quicker than enter.
 * - Only transform + opacity are animated (compositor-friendly).
 * - All durations scale with the user's `animationSpeed`, and collapse to 0 when
 *   animations are off or the OS requests reduced motion (see useMotionPrefs).
 */
import type { Transition, Variants } from 'framer-motion'
import { useApp } from '@/store'

export const ease = {
  out: [0.22, 1, 0.36, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
  in: [0.55, 0, 1, 0.45] as const,
}

export const spring = {
  /** Snappy UI response (menus, pills, toggles). */
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 } as Transition,
  /** Surfaces entering (dialogs, palette). */
  soft: { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 } as Transition,
  /** Layout re-flow (lists re-ordering, shared elements). */
  layout: { type: 'spring', stiffness: 460, damping: 40 } as Transition,
}

export const dur = { xs: 0.11, sm: 0.17, md: 0.26, lg: 0.38 }

/** Reads animation prefs once per render; cheap selector (primitive values). */
export function useMotionPrefs() {
  const mode = useApp((s) => s.settings.animations)
  const speed = useApp((s) => s.settings.animationSpeed)
  const osReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const off = mode === 'off'
  const reduced = off || mode === 'reduced' || !!osReduced
  const k = 1 / Math.min(2, Math.max(0.5, Number(speed) || 1))
  return { off, reduced, full: !reduced, k }
}

/** Route transition: subtle lift + fade; exit is shorter than enter. */
export const pageVariants = (reduced: boolean, k: number): Variants => reduced
  ? { initial: { opacity: 1 }, enter: { opacity: 1, transition: { duration: 0 } }, exit: { opacity: 1, transition: { duration: 0 } } }
  : {
      initial: { opacity: 0, y: 10, scale: 0.995 },
      enter: { opacity: 1, y: 0, scale: 1, transition: { duration: dur.md * k, ease: ease.out } },
      exit: { opacity: 0, y: -4, transition: { duration: dur.xs * k, ease: ease.in } },
    }

/** Dashboard sections enter in reading order; never stagger individual list rows. */
export const revealSequence = (reduced: boolean, k: number): Variants => ({
  initial: {},
  enter: { transition: { staggerChildren: reduced ? 0 : 0.055 * k, delayChildren: reduced ? 0 : 0.04 * k } },
})

export const revealItem = (reduced: boolean, k: number): Variants => reduced
  ? { initial: { opacity: 1 }, enter: { opacity: 1, transition: { duration: 0 } } }
  : { initial: { opacity: 0, y: 12 }, enter: { opacity: 1, y: 0, transition: { duration: dur.md * k, ease: ease.out } } }

/** Dialog surface: scale-from-0.96 with spring; backdrop fades independently. */
export const dialogVariants = (reduced: boolean): Variants => reduced
  ? { initial: { opacity: 0 }, enter: { opacity: 1 }, exit: { opacity: 0 } }
  : {
      initial: { opacity: 0, scale: 0.96, y: 8 },
      enter: { opacity: 1, scale: 1, y: 0, transition: spring.soft },
      exit: { opacity: 0, scale: 0.98, y: 4, transition: { duration: dur.xs, ease: ease.in } },
    }
