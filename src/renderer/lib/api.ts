import type { DHApi } from '../../../electron/preload'

declare global {
  interface Window { dh: DHApi }
}

export const dh = window.dh
// Loosely typed on purpose: channels return heterogeneous payloads; callers annotate where needed.
export const invoke = <T = any>(channel: string, ...args: unknown[]): Promise<T> => dh.invoke<T>(channel, ...args)
export const on = <T = any>(channel: string, cb: (payload: T) => void): (() => void) => dh.on(channel, cb as (p: unknown) => void)
export const toFileUrl = dh.toFileUrl
