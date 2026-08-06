import { toast } from 'sonner'

import { replayCategoryOp } from '@/features/categories/categories-service'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { useDashboardStore } from '@/features/dashboard/dashboard-store'
import { replayExpenseOp } from '@/features/personal-expenses/expenses-service'
import { useExpensesStore } from '@/features/personal-expenses/expenses-store'
import { clearOfflineData } from '@/services/offline/cache'
import { isNetworkError, isOffline } from '@/services/offline/net'
import { listOps, refreshPendingState, removeOp } from '@/services/offline/outbox'
import type { OutboxEntry } from '@/services/offline/outbox'
import { useAuthStore } from '@/stores/auth-store'
import { useNetworkStore } from '@/stores/network-store'
import type { Id } from '@/types'

/** How often to retry a stuck queue while online (e.g. server was down). */
const RETRY_INTERVAL_MS = 20_000

let flushing = false

async function replay(userId: Id, entry: OutboxEntry): Promise<void> {
  if (entry.op.kind === 'category.create') await replayCategoryOp(userId, entry.op)
  else await replayExpenseOp(userId, entry.op)
}

function describeOp(entry: OutboxEntry): string {
  const op = entry.op
  switch (op.kind) {
    case 'expense.create':
      return `add "${op.input.description}"`
    case 'expense.update':
      return `update "${op.input.description}"`
    case 'expense.delete':
      return 'delete an expense'
    case 'category.create':
      return `create the category "${op.name}"`
  }
}

/** Reload whatever is on screen after the server caught up. */
function refreshStores(hadCategoryOps: boolean): void {
  const expenses = useExpensesStore.getState()
  if (expenses.status === 'ready') void expenses.load()
  if (hadCategoryOps) {
    useCategoriesStore.getState().reset()
    void useCategoriesStore.getState().load()
  }
  const dashboard = useDashboardStore.getState()
  if (dashboard.status === 'ready') void dashboard.load()
}

/**
 * Replays queued offline changes in the order they were made. Stops (and
 * retries later) when the network drops again; an op the server rejects
 * outright is dropped with a toast so one bad change can't wedge the queue.
 */
export async function flushOutbox(): Promise<void> {
  const user = useAuthStore.getState().user
  if (!user || isOffline() || flushing) return
  const ops = await listOps(user.id)
  if (ops.length === 0) return

  flushing = true
  useNetworkStore.getState().setSyncing(true)
  let synced = 0
  let hadCategoryOps = false
  try {
    for (const entry of ops) {
      try {
        await replay(user.id, entry)
      } catch (error) {
        if (isNetworkError(error)) break
        toast.error(
          `Couldn't sync one offline change (${describeOp(entry)}) — it was discarded.`,
        )
      }
      if (entry.seq !== undefined) await removeOp(entry.seq)
      synced += 1
      if (entry.op.kind === 'category.create') hadCategoryOps = true
    }
  } finally {
    flushing = false
    useNetworkStore.getState().setSyncing(false)
    await refreshPendingState(user.id)
  }
  if (synced > 0) {
    refreshStores(hadCategoryOps)
    if (synced === ops.length) {
      toast.success(synced === 1 ? 'Offline change synced' : `${synced} offline changes synced`)
    }
  }
}

/** Called from AuthListener; deferred so no work runs inside the auth callback. */
export function onSignedIn(userId: Id): void {
  setTimeout(() => {
    void refreshPendingState(userId).then(() => flushOutbox())
  }, 0)
}

/** Sign-out: drop everything so the next account starts clean. */
export function onSignedOut(): void {
  setTimeout(() => {
    void clearOfflineData()
    void refreshPendingState(null)
  }, 0)
}

/** Wire connectivity events once at app startup; returns a cleanup handle. */
export function initSync(): () => void {
  const handleChange = () => {
    useNetworkStore.getState().setOnline(navigator.onLine)
    if (navigator.onLine) void flushOutbox()
  }
  window.addEventListener('online', handleChange)
  window.addEventListener('offline', handleChange)
  handleChange()

  const retry = window.setInterval(() => {
    const { online, pendingCount, syncing } = useNetworkStore.getState()
    if (online && pendingCount > 0 && !syncing) void flushOutbox()
  }, RETRY_INTERVAL_MS)

  return () => {
    window.removeEventListener('online', handleChange)
    window.removeEventListener('offline', handleChange)
    window.clearInterval(retry)
  }
}
