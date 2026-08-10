import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExpenseInput } from '@/features/personal-expenses/expenses-service'
import { OUTBOX_STORE, idbRequest } from '@/services/offline/db'
import { enqueueOp, listOps } from '@/services/offline/outbox'
import { useAuthStore } from '@/stores/auth-store'
import { useNetworkStore } from '@/stores/network-store'

// flushOutbox replays through the services and refreshes on-screen stores;
// mock those edges and drive the real outbox + queue semantics underneath.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/features/personal-expenses/expenses-service', () => ({
  replayExpenseOp: vi.fn(async () => {}),
}))
vi.mock('@/features/categories/categories-service', () => ({
  replayCategoryOp: vi.fn(async () => {}),
}))
vi.mock('@/features/personal-expenses/expenses-store', () => ({
  useExpensesStore: { getState: () => ({ status: 'idle', load: vi.fn() }) },
}))
vi.mock('@/features/categories/categories-store', () => ({
  useCategoriesStore: { getState: () => ({ reset: vi.fn(), load: vi.fn() }) },
}))
vi.mock('@/features/dashboard/dashboard-store', () => ({
  useDashboardStore: { getState: () => ({ status: 'idle', load: vi.fn() }) },
}))
vi.mock('@/services/offline/cache', () => ({
  clearOfflineData: vi.fn(async () => {}),
}))

import { toast } from 'sonner'

import { replayCategoryOp } from '@/features/categories/categories-service'
import { replayExpenseOp } from '@/features/personal-expenses/expenses-service'
import { flushOutbox } from '@/services/offline/sync'

const USER = 'user-1'

function expenseInput(description: string): ExpenseInput {
  return {
    description,
    amountMinor: 450,
    currency: 'USD',
    categoryId: null,
    date: '2026-08-06',
    kind: 'expense',
    notes: null,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await idbRequest(OUTBOX_STORE, 'readwrite', (store) => store.clear())
  useNetworkStore.getState().setPending(0, new Set())
  useAuthStore
    .getState()
    .setSession({ id: USER, email: 'tester@example.com', fullName: null, avatarUrl: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('flushOutbox', () => {
  it('replays queued ops in order and empties the queue', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput('One') })
    await enqueueOp(USER, { kind: 'expense.update', entityId: 'e2', input: expenseInput('Two') })

    await flushOutbox()

    const calls = vi.mocked(replayExpenseOp).mock.calls
    expect(calls.map(([, op]) => op.kind)).toEqual(['expense.create', 'expense.update'])
    expect(await listOps(USER)).toHaveLength(0)
    expect(useNetworkStore.getState().pendingCount).toBe(0)
    expect(toast.success).toHaveBeenCalledWith('2 offline changes synced')
  })

  it('routes category ops through the category replayer', async () => {
    await enqueueOp(USER, { kind: 'category.create', entityId: 'c1', name: 'Snacks', icon: 'tag' })

    await flushOutbox()

    expect(replayCategoryOp).toHaveBeenCalledTimes(1)
    expect(replayExpenseOp).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Offline change synced')
  })

  it('drops an op the server rejects so it cannot wedge the queue', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput('Bad') })
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e2', input: expenseInput('Good') })
    vi.mocked(replayExpenseOp).mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint'),
    )

    await flushOutbox()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error).mock.calls[0]![0]).toContain('discarded')
    expect(replayExpenseOp).toHaveBeenCalledTimes(2)
    expect(await listOps(USER)).toHaveLength(0)
  })

  it('stops on a network error and keeps the remaining ops queued', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput('One') })
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e2', input: expenseInput('Two') })
    vi.mocked(replayExpenseOp).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await flushOutbox()

    expect(replayExpenseOp).toHaveBeenCalledTimes(1)
    expect(await listOps(USER)).toHaveLength(2)
    expect(useNetworkStore.getState().pendingCount).toBe(2)
    expect(useNetworkStore.getState().syncing).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still attempts a replay when the browser claims to be offline', async () => {
    // The claim is a hint, not a veto. Skipping the attempt is what strands a
    // queue behind a stuck navigator.onLine: nothing would ever run to
    // discover the flag was wrong.
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput('One') })
    useNetworkStore.getState().setOnline(false)

    await flushOutbox()

    expect(replayExpenseOp).toHaveBeenCalledTimes(1)
    expect(await listOps(USER)).toHaveLength(0)
  })

  it('leaves the queue intact when the replay hits a network error', async () => {
    // The genuinely-offline case: one failed request, nothing lost.
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput('One') })
    useNetworkStore.getState().setOnline(false)
    vi.mocked(replayExpenseOp).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await flushOutbox()

    expect(await listOps(USER)).toHaveLength(1)
  })

  it('does nothing when signed out', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput('One') })
    useAuthStore.getState().clearSession()

    await flushOutbox()

    expect(replayExpenseOp).not.toHaveBeenCalled()
    expect(await listOps(USER)).toHaveLength(1)
  })
})
