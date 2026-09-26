import type { DHApi } from '../../../electron/preload'

declare global {
  interface Window { dh: DHApi }
}

// Resolved lazily so the module can be imported before the bridge exists
// (e.g. the DEV browser preview installs a mock bridge at startup).
const bridge = (): DHApi => window.dh

// Loosely typed on purpose: channels return heterogeneous payloads; callers annotate where needed.
export const invoke = <T = any>(channel: string, ...args: unknown[]): Promise<T> => bridge().invoke<T>(channel, ...args)
export const on = <T = any>(channel: string, cb: (payload: T) => void): (() => void) => bridge().on(channel, cb as (p: unknown) => void)
export const toFileUrl = (p: string): string => bridge().toFileUrl(p)

/** Normalises any thrown value into a human-readable message. */
export const errorMessage = (e: unknown, fallback = 'Error'): string =>
  e instanceof Error ? e.message : typeof e === 'string' && e ? e : fallback
