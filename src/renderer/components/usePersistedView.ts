/**
 * View-mode persistence helper (audit M-07).
 *
 * View modes (board/list, kanban/list, grid/list …) are pure client UI state and
 * belong in `localStorage`, not the main-process data store. `Tasks.tsx` already
 * does this by hand while `Projects.tsx` loses the choice on navigation; this
 * hook extracts the pattern so every page persists consistently.
 *
 * Usage (one line per page):
 *
 *   const [view, setView] = usePersistedView('dh:projectsView', ['board', 'list'] as const, 'board')
 *
 * Guarantees:
 * - The stored value is validated against `options`: a stale/renamed value or
 *   corrupt storage safely falls back instead of rendering an unknown mode.
 * - Reads/writes are guarded so private-mode or quota errors never throw.
 * - Keys live under the app-wide `dh:` namespace (same as `dh:sidebarGroups`,
 *   `dh:tasksView`, `dh-net-tab`), normalised idempotently.
 *
 * Follow-up (pages are outside this change's scope):
 * - Projects.tsx: replace `useState<'board' | 'list'>('board')` with the hook
 *   above so the chosen view survives navigating away and back.
 * - Tasks.tsx: can adopt it to drop its manual `localStorage.getItem/setItem`.
 */
import { useEffect, useState } from 'react'

const NS = 'dh:'

/** Normalise a caller-supplied key into the `dh:` namespace (idempotent). */
const storageKey = (key: string) => (key.startsWith(NS) ? key : NS + key)

/** Read + validate a persisted value; never throws. */
export function readPersisted<T extends string>(key: string, options: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey(key))
    return raw && (options as readonly string[]).includes(raw) ? (raw as T) : fallback
  } catch {
    return fallback
  }
}

/** Persist a value; swallows quota / private-mode errors. */
export function writePersisted(key: string, value: string): void {
  try { localStorage.setItem(storageKey(key), value) } catch { /* ignore quota/private mode */ }
}

/** `useState` for a persisted, string-union view mode (board/list, kanban/list…). */
export function usePersistedView<T extends string>(key: string, options: readonly T[], fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPersisted(key, options, fallback))
  useEffect(() => { writePersisted(key, value) }, [key, value])
  return [value, setValue]
}
