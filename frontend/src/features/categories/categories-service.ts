import type { PostgrestError } from '@supabase/supabase-js'

import { cacheKeys, cachedFetch } from '@/services/offline/cache'
import { isNetworkError, isOffline } from '@/services/offline/net'
import { enqueueOp, listOps } from '@/services/offline/outbox'
import type { OutboxOp } from '@/services/offline/outbox'
import { getSupabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth-store'
import type { Category, Id, Tables } from '@/types'

type CategoryRow = Tables<'categories'>

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    userId: row.user_id,
    createdAt: row.created_at,
  }
}

function requireUserId(): Id {
  const user = useAuthStore.getState().user
  if (!user) throw new Error('You need to be signed in.')
  return user.id
}

function throwFriendly(action: string, error: PostgrestError): never {
  if (error.code === '23505') {
    throw new Error('You already have a category with this name.')
  }
  throw new Error(`Couldn't ${action}. ${error.message}`)
}

async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await getSupabase()
    .from('categories')
    .select('*')
    .order('user_id', { ascending: true, nullsFirst: true })
    .order('name', { ascending: true })
  if (error) throwFriendly('load categories', error)
  return data.map(toCategory)
}

/** Built-in defaults plus the user's own, defaults first, A→Z within each. */
export async function listCategories(): Promise<Category[]> {
  const userId = requireUserId()
  let categories: Category[]
  try {
    categories = await cachedFetch(cacheKeys.categories(userId), fetchCategories)
  } catch (error) {
    // Same distinction as listExpensesForMonth: a failed request is not
    // evidence that the device is offline.
    if (isOffline()) {
      throw new Error('You’re offline and categories aren’t saved on this device yet.')
    }
    if (isNetworkError(error)) {
      throw new Error('Couldn’t reach the server, and categories aren’t saved on this device yet.')
    }
    throw error
  }
  // Categories created offline stay visible across reloads until they sync.
  const pending = await listOps(userId)
  for (const entry of pending) {
    if (entry.op.kind !== 'category.create') continue
    const op = entry.op
    if (categories.some((category) => category.id === op.entityId)) continue
    categories = [
      ...categories,
      { id: op.entityId, name: op.name, icon: op.icon, userId, createdAt: entry.queuedAt },
    ]
  }
  return categories
}

async function insertCategoryRow(userId: Id, id: Id, name: string, icon: string): Promise<Category> {
  const { data, error } = await getSupabase()
    .from('categories')
    .insert({ id, user_id: userId, name, icon })
    .select()
    .single()
  if (error) throw error
  return toCategory(data)
}

export async function createCategory(name: string, icon = 'tag'): Promise<Category> {
  const userId = requireUserId()
  const id = crypto.randomUUID()
  // Attempted regardless of the offline hint — same reasoning as createExpense.
  try {
    return await insertCategoryRow(userId, id, name, icon)
  } catch (error) {
    if (!isNetworkError(error)) throwFriendly('create the category', error as PostgrestError)
  }
  // Mirror the server's case-insensitive uniqueness so the queued create
  // can't collide (and take dependent expenses down with it) on replay.
  const known = await listCategories().catch(() => [] as Category[])
  const clashes = known.some(
    (category) =>
      category.userId === userId && category.name.toLowerCase() === name.toLowerCase(),
  )
  if (clashes) throw new Error('You already have a category with this name.')
  await enqueueOp(userId, { kind: 'category.create', entityId: id, name, icon })
  return { id, name, icon, userId, createdAt: new Date().toISOString() }
}

/** Replay for the sync runner; a category that already synced is a no-op. */
export async function replayCategoryOp(userId: Id, op: OutboxOp): Promise<void> {
  if (op.kind !== 'category.create') return
  try {
    await insertCategoryRow(userId, op.entityId, op.name, op.icon)
  } catch (error) {
    if ((error as PostgrestError).code !== '23505') throw error
  }
}
