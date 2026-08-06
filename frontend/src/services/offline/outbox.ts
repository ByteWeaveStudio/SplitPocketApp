import type { ExpenseInput } from '@/features/personal-expenses/expenses-service'
import { OUTBOX_STORE, idbRequest } from '@/services/offline/db'
import { useNetworkStore } from '@/stores/network-store'
import type { Id } from '@/types'

/**
 * Queued mutations made while offline, replayed in order on reconnect.
 * Creates carry client-generated UUIDs, so replaying one that already
 * reached the server is a harmless duplicate-key no-op.
 */
export type OutboxOp =
  | { kind: 'expense.create'; entityId: Id; input: ExpenseInput }
  | { kind: 'expense.update'; entityId: Id; input: ExpenseInput }
  | { kind: 'expense.delete'; entityId: Id }
  | { kind: 'category.create'; entityId: Id; name: string; icon: string }

export interface OutboxEntry {
  /** Auto-incremented by IndexedDB — replay order. Absent until stored. */
  seq?: number
  userId: Id
  /** When the change was made, used as createdAt for synthesized rows. */
  queuedAt: string
  op: OutboxOp
}

async function allEntries(): Promise<OutboxEntry[]> {
  try {
    const entries = await idbRequest(OUTBOX_STORE, 'readonly', (store) => store.getAll())
    return (entries ?? []) as OutboxEntry[]
  } catch {
    return []
  }
}

/** This user's queued ops in the order they were made. */
export async function listOps(userId: Id): Promise<OutboxEntry[]> {
  return (await allEntries()).filter((entry) => entry.userId === userId)
}

export async function removeOp(seq: number): Promise<void> {
  await idbRequest(OUTBOX_STORE, 'readwrite', (store) => store.delete(seq))
}

async function putEntry(entry: OutboxEntry): Promise<void> {
  await idbRequest(OUTBOX_STORE, 'readwrite', (store) => store.put(entry))
}

/**
 * Queues an op, collapsing redundant history for the same entity:
 * - an update folds into a pending create/update instead of stacking;
 * - a delete drops pending ops, and is itself skipped when the entity
 *   was created offline (the server never saw it).
 */
export async function enqueueOp(userId: Id, op: OutboxOp): Promise<void> {
  const pending = await listOps(userId)
  const forEntity = (entry: OutboxEntry) =>
    'entityId' in entry.op && entry.op.entityId === op.entityId

  if (op.kind === 'expense.update') {
    const existing = pending.find(
      (entry) =>
        forEntity(entry) && (entry.op.kind === 'expense.create' || entry.op.kind === 'expense.update'),
    )
    if (existing?.seq !== undefined) {
      await putEntry({ ...existing, op: { ...existing.op, input: op.input } as OutboxOp })
      await refreshPendingState(userId)
      return
    }
  }

  if (op.kind === 'expense.delete') {
    const related = pending.filter(forEntity)
    const createdOffline = related.some((entry) => entry.op.kind === 'expense.create')
    for (const entry of related) {
      if (entry.seq !== undefined) await removeOp(entry.seq)
    }
    if (createdOffline) {
      await refreshPendingState(userId)
      return
    }
  }

  await putEntry({ userId, queuedAt: new Date().toISOString(), op })
  await refreshPendingState(userId)
}

/** Mirrors the queue into the network store for banners and row badges. */
export async function refreshPendingState(userId: Id | null): Promise<void> {
  if (!userId) {
    useNetworkStore.getState().setPending(0, new Set())
    return
  }
  const pending = await listOps(userId)
  const ids = new Set(pending.map((entry) => entry.op.entityId))
  useNetworkStore.getState().setPending(pending.length, ids)
}
