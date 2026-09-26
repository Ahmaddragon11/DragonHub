/**
 * Undoable deletes for renderer-owned collections (notes / tasks / projects).
 *
 * UX: optimistic removal + "Undo" toast is faster and safer than a blocking
 * confirm dialog. When the user explicitly enabled "Confirm before delete",
 * the native confirm still runs first — Undo is then a second safety net.
 * Restores re-insert at the original index so ordering is preserved.
 */
import i18n from '@/i18n'
import { invoke } from '@/lib/api'
import { useApp } from '@/store'
import type { Note, Project, Task } from '@shared/types'

type Coll = 'notes' | 'tasks' | 'projects'
type Item = Note | Task | Project

const saver = (c: Coll) => {
  const s = useApp.getState()
  return c === 'notes' ? (l: Item[]) => s.saveNotes(l as Note[]) : c === 'tasks' ? (l: Item[]) => s.saveTasks(l as Task[]) : (l: Item[]) => s.saveProjects(l as Project[])
}

export async function deleteWithUndo(coll: Coll, id: string, message?: string): Promise<boolean> {
  const st = useApp.getState()
  if (st.settings.confirmDelete) {
    const ok = await invoke<boolean>('dialog:confirm', i18n.t('common.confirmDelete')).catch(() => false)
    if (!ok) return false
  }
  const list = useApp.getState()[coll] as Item[]
  const index = list.findIndex((x) => x.id === id)
  if (index === -1) return false
  const item = list[index]
  saver(coll)(list.filter((x) => x.id !== id))
  useApp.getState().toast(message ?? i18n.t('toast.deleted'), 'info', {
    action: {
      label: i18n.t('common.undo'),
      run: () => {
        const cur = useApp.getState()[coll] as Item[]
        if (cur.some((x) => x.id === id)) return
        const next = [...cur]
        next.splice(Math.min(index, next.length), 0, item)
        saver(coll)(next)
      },
    },
  })
  return true
}
