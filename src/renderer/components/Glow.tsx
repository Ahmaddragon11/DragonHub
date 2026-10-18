import React from 'react'
import { cn } from '@/lib/utils'

/**
 * Shared polish primitives.
 *
 * `Glow` wraps a surface in the rotating hairline ring defined in styles/index.css
 * (.glow + data-tone). The direct child receives the ring's inner radius and is
 * lifted above the gradient, so pass a real element — never a fragment.
 *
 * `FlyIcon` is the matching micro-interaction: the glyph lifts on hover and
 * "flies away" on press (pure CSS, honours low-power / reduced-motion).
 */
export type GlowTone =
  | 'accent'
  | 'mono'
  | 'github'
  | 'telegram'
  | 'violet'
  | 'blue'
  | 'cyan'
  | 'emerald'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'red'
  | 'prism'
  | 'ocean'
  | 'candy'
  | 'sunset'
  | 'aurora'
  | 'ember'

type GlowProps = {
  /** Hue family of the ring; pick one per feature so colours read as identity. */
  tone?: GlowTone
  /** Full-width wrapper that stretches the child to fill the row. */
  block?: boolean
  /** Paint an opaque surface behind a transparent child (ghost buttons, plain divs). */
  surface?: boolean
  /** rounded-2xl ring for whole cards instead of the default pill/button radius. */
  card?: boolean
  /** rounded-xs ring for chips and small controls. */
  small?: boolean
  className?: string
  /** Extra classes for the wrapper itself (e.g. `flex-1` in a toolbar row). */
  wrapperClassName?: string
  children: React.ReactNode
}

export function Glow({ tone = 'accent', block, surface, card, small, className, wrapperClassName, children }: GlowProps) {
  return (
    <span
      className={cn('glow', block && 'glow-block', surface && 'glow-surface', card && 'glow-card', small && 'glow-sm', className, wrapperClassName)}
      data-glow-tone={tone}
    >
      {children}
    </span>
  )
}

/**
 * Props for the self variant — the element itself is the ring surface. Use it on
 * cards that already carry their own background/border (and usually hover-lift):
 *   <div className="card card-interactive" {...glowSelf('blue')} />
 *   <div className={cn('card', 'raw')} {...glowSelf('amber', 'glow-paused')} />
 */
export function glowSelf(tone: GlowTone, extraClass?: string, opts?: { paused?: boolean }) {
  return {
    className: cn('glow-self', extraClass, opts?.paused && 'glow-paused'),
    'data-glow-tone': tone,
  } as const
}

type GlowButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: GlowTone
  block?: boolean
  /** Use with .btn-ghost / .btn-outline so the ring does not show through. */
  surface?: boolean
  /** Extra classes for the ring wrapper itself (e.g. `flex-1` in a toolbar row). */
  wrapperClassName?: string
}

export function GlowButton({ tone = 'accent', block, surface, className, wrapperClassName, type = 'button', children, ...rest }: GlowButtonProps) {
  return (
    <Glow tone={tone} block={block} surface={surface} wrapperClassName={wrapperClassName}>
      <button type={type} className={cn('lift', className)} {...rest}>
        {children}
      </button>
    </Glow>
  )
}

/** Wrap the glyph inside a `.fly-host` element to get the hover/press flight. */
export function FlyIcon({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('fly-icon', className)}>{children}</span>
}

/**
 * Liquid-glass button system (v1.5.0) — composes `.btn` with the `.glass-btn`
 * family defined at the bottom of styles/index.css.
 *
 *   <GlassButton variant="liquid" tone="ocean">…</GlassButton>  // animated water fill
 *   <GlassButton variant="prism"  tone="aurora">…</GlassButton> // spinning hairline ring
 *   <GlassButton variant="frost"  className="btn-primary">…</GlassButton> // plain glass
 *
 * Any `.btn` variant/utility can still be passed via `className` (it wins last).
 * Continuously-animating layers are gated by html[data-quality] in CSS:
 *   eco / low-power / anim-off / reduced-motion → static;
 *   balanced → moves only on hover; high → continuous; ultra → continuous +
 *   a subtle hue-shift. The shine sweep + press ripple are pure CSS and follow
 *   the same gates.
 */
export type LiquidVariant = 'liquid' | 'frost' | 'prism'
export type LiquidTone = 'ocean' | 'candy' | 'sunset' | 'prism' | 'aurora' | 'ember'

export function GlassButton({ variant = 'liquid', tone = 'ocean', block, className, wrapperClassName, type = 'button', children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: LiquidVariant
  tone?: LiquidTone
  block?: boolean
  /** Extra classes for the `.glow-block` wrapper (applied to the button itself when `block` is off). */
  wrapperClassName?: string
}) {
  const button = (
    <button type={type} {...rest}
      className={cn('btn glass-btn glass-shine-host', variant === 'liquid' && 'glass-liquid', variant === 'prism' && 'glass-prism', block && 'w-full', !block && wrapperClassName, className)}
      {...(variant === 'liquid' ? { 'data-liquid': tone } : {})}
      {...(variant === 'prism' ? { 'data-prism': tone } : {})}>
      {variant !== 'frost' && <span className="glass-shine" aria-hidden />}
      {children}
    </button>
  )
  if (!block) return button
  return <span className={cn('glow-block', wrapperClassName)}>{button}</span>
}

/**
 * Card edge system (v1.5.0) — wraps a `.card` with a gradient-inch border
 * (`.card-edge-soft`, static + cheap) or the opt-in spinning light edge
 * (`.card-edge-beam`, gated by html[data-quality]: eco/low-power/anim-off →
 * static, balanced → hover-only spin, high → 10s, ultra → 7s). Children are
 * wrapped in `.card-edge-content` so they paint above the beam's inner layer.
 */
export type EdgeVariant = 'soft' | 'beam'

export function EdgeCard({ variant = 'soft', tone = 'violet', className, children, ...rest }: React.HTMLAttributes<HTMLDivElement> & {
  variant?: EdgeVariant
  tone?: GlowTone
}) {
  return (
    <div className={cn('card card-edge', variant === 'soft' ? 'card-edge-soft' : 'card-edge-beam')} data-edge-tone={tone} {...rest}>
      <div className="card-edge-content">{children}</div>
    </div>
  )
}

/** Optional decorative streak for `.fly-host`; purely visual. */
export function FlySpark({ className }: { className?: string }) {
  return <span className={cn('fly-spark', className)} aria-hidden />
}
