import type { Category } from '@/types'

/**
 * The built-in categories, shipped with the app instead of stored.
 *
 * Postgres held these as rows with `user_id is null`, readable by everyone
 * through RLS and inserted by a seed migration. Firestore has no migrations and
 * a client-only app has no way to seed shared documents, so they live here.
 *
 * The ids are stable slugs and must never change: every expense that has ever
 * been filed under one stores the id in `categoryId`.
 *
 * Icons are Lucide icon names, matching the frontend pickers.
 */
const DEFAULTS: ReadonlyArray<{ id: string; name: string; icon: string }> = [
  { id: 'cat_food', name: 'Food & Drinks', icon: 'utensils' },
  { id: 'cat_groceries', name: 'Groceries', icon: 'shopping-cart' },
  { id: 'cat_transport', name: 'Transport', icon: 'car' },
  { id: 'cat_housing', name: 'Housing & Rent', icon: 'home' },
  { id: 'cat_utilities', name: 'Utilities', icon: 'lightbulb' },
  { id: 'cat_entertainment', name: 'Entertainment', icon: 'clapperboard' },
  { id: 'cat_shopping', name: 'Shopping', icon: 'shopping-bag' },
  { id: 'cat_health', name: 'Health', icon: 'heart-pulse' },
  { id: 'cat_travel', name: 'Travel', icon: 'plane' },
  { id: 'cat_education', name: 'Education', icon: 'graduation-cap' },
  { id: 'cat_subscriptions', name: 'Subscriptions', icon: 'repeat' },
  { id: 'cat_gifts', name: 'Gifts', icon: 'gift' },
  { id: 'cat_salary', name: 'Salary', icon: 'banknote' },
  { id: 'cat_other', name: 'Other', icon: 'tag' },
]

/** `userId: null` is what the rest of the app already reads as "built-in". */
export const DEFAULT_CATEGORIES: readonly Category[] = DEFAULTS.map((c) => ({
  id: c.id,
  name: c.name,
  icon: c.icon,
  userId: null,
  createdAt: '1970-01-01T00:00:00.000Z',
}))

export const DEFAULT_CATEGORY_IDS: ReadonlySet<string> = new Set(DEFAULTS.map((c) => c.id))
