import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import type { ExpenseInput } from '@/features/personal-expenses/expenses-service'
import { OUTBOX_STORE, idbRequest } from '@/services/offline/db'
import { enqueueOp, listOps } from '@/services/offline/outbox'
import { useNetworkStore } from '@/stores/network-store'

const USER = 'user-1'
const OTHER_USER = 'user-2'

function expenseInput(overrides: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    description: 'Coffee',
    amountMinor: 450,
    currency: 'USD',
    categoryId: null,
    date: '2026-08-06',
    kind: 'expense',
    notes: null,
    ...overrides,
  }
}

beforeEach(async () => {
  await idbRequest(OUTBOX_STORE, 'readwrite', (store) => store.clear())
  useNetworkStore.getState().setPending(0, new Set())
})

describe('enqueueOp collapsing', () => {
  it('queues independent ops in the order they were made', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput() })
    await enqueueOp(USER, { kind: 'category.create', entityId: 'c1', name: 'Snacks', icon: 'tag' })
    const ops = await listOps(USER)
    expect(ops.map((entry) => entry.op.kind)).toEqual(['expense.create', 'category.create'])
  })

  it('folds an update into a pending create', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput() })
    await enqueueOp(USER, {
      kind: 'expense.update',
      entityId: 'e1',
      input: expenseInput({ description: 'Espresso', amountMinor: 500 }),
    })
    const ops = await listOps(USER)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.op.kind).toBe('expense.create')
    expect(ops[0]!.op).toMatchObject({ input: { description: 'Espresso', amountMinor: 500 } })
  })

  it('folds an update into a pending update', async () => {
    await enqueueOp(USER, { kind: 'expense.update', entityId: 'e1', input: expenseInput() })
    await enqueueOp(USER, {
      kind: 'expense.update',
      entityId: 'e1',
      input: expenseInput({ description: 'Latte' }),
    })
    const ops = await listOps(USER)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.op.kind).toBe('expense.update')
    expect(ops[0]!.op).toMatchObject({ input: { description: 'Latte' } })
  })

  it('cancels a pending create when the entity is deleted offline', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput() })
    await enqueueOp(USER, { kind: 'expense.delete', entityId: 'e1' })
    expect(await listOps(USER)).toHaveLength(0)
  })

  it('cancels a folded create+update pair on delete', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput() })
    await enqueueOp(USER, {
      kind: 'expense.update',
      entityId: 'e1',
      input: expenseInput({ description: 'Espresso' }),
    })
    await enqueueOp(USER, { kind: 'expense.delete', entityId: 'e1' })
    expect(await listOps(USER)).toHaveLength(0)
  })

  it('replaces a pending update with a delete for entities the server knows', async () => {
    await enqueueOp(USER, { kind: 'expense.update', entityId: 'e1', input: expenseInput() })
    await enqueueOp(USER, { kind: 'expense.delete', entityId: 'e1' })
    const ops = await listOps(USER)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.op.kind).toBe('expense.delete')
  })

  it('leaves other entities untouched when collapsing', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput() })
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e2', input: expenseInput() })
    await enqueueOp(USER, { kind: 'expense.delete', entityId: 'e1' })
    const ops = await listOps(USER)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.op.entityId).toBe('e2')
  })

  it('scopes the queue per user', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput() })
    await enqueueOp(OTHER_USER, { kind: 'expense.create', entityId: 'e2', input: expenseInput() })
    // A delete by one user must not collapse another user's ops.
    await enqueueOp(OTHER_USER, { kind: 'expense.delete', entityId: 'e1' })
    expect(await listOps(USER)).toHaveLength(1)
    const otherOps = await listOps(OTHER_USER)
    expect(otherOps.map((entry) => entry.op.kind)).toEqual(['expense.create', 'expense.delete'])
  })
})

describe('pending state mirror', () => {
  it('tracks count and entity ids for badges', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput() })
    await enqueueOp(USER, { kind: 'category.create', entityId: 'c1', name: 'Snacks', icon: 'tag' })
    const { pendingCount, pendingIds } = useNetworkStore.getState()
    expect(pendingCount).toBe(2)
    expect(pendingIds).toEqual(new Set(['e1', 'c1']))
  })

  it('clears when the last op collapses away', async () => {
    await enqueueOp(USER, { kind: 'expense.create', entityId: 'e1', input: expenseInput() })
    await enqueueOp(USER, { kind: 'expense.delete', entityId: 'e1' })
    const { pendingCount, pendingIds } = useNetworkStore.getState()
    expect(pendingCount).toBe(0)
    expect(pendingIds.size).toBe(0)
  })
})
