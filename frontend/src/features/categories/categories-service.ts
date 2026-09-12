import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
  Timestamp,
} from 'firebase/firestore'

import { DEFAULT_CATEGORIES } from '@/features/categories/default-categories'
import { getDb } from '@/services/firebase'
import { friendlyFirestoreMessage, toIso, trackWrite } from '@/services/firestore'
import { useAuthStore } from '@/stores/auth-store'
import type { Category, Id } from '@/types'

function requireUserId(): Id {
  const user = useAuthStore.getState().user
  if (!user) throw new Error('You need to be signed in.')
  return user.id
}

/**
 * `{uid}__{slug}` — the document id carries the uniqueness Postgres enforced
 * with a unique index on (user_id, lower(name)). Firestore has no unique
 * indexes, so encoding the key in the id is what makes a duplicate name
 * impossible rather than merely checked.
 */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function categoryId(userId: Id, name: string): string {
  return `${userId}__${slugify(name)}`
}

/** Built-in defaults plus the user's own, defaults first, A→Z within each. */
export async function listCategories(): Promise<Category[]> {
  const userId = requireUserId()
  try {
    // Served from the persistent cache when offline — no separate fallback.
    const snapshot = await getDocs(
      query(
        collection(getDb(), 'categories'),
        where('ownerId', '==', userId),
        orderBy('name', 'asc'),
      ),
    )
    const own = snapshot.docs.map<Category>((d) => {
      const data = d.data()
      return {
        id: d.id,
        name: data.name as string,
        icon: data.icon as string,
        userId,
        createdAt: toIso(data.createdAt),
      }
    })
    return [...DEFAULT_CATEGORIES, ...own]
  } catch (error) {
    throw new Error(friendlyFirestoreMessage(error, 'Couldn’t load categories.'))
  }
}

export async function createCategory(name: string, icon = 'tag'): Promise<Category> {
  const userId = requireUserId()
  const slug = slugify(name)
  if (!slug) throw new Error('Give the category a name.')

  // Mirror the old unique index as a friendly error before the write, since a
  // rules rejection would only surface later as a toast.
  const known = await listCategories().catch(() => [] as Category[])
  if (known.some((category) => category.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new Error('You already have a category with this name.')
  }

  const id = categoryId(userId, name)
  const createdAt = new Date().toISOString()
  // Not awaited: Firestore applies it locally at once and resolves only on the
  // server ack, which never comes while offline. See services/firestore.ts.
  trackWrite(
    id,
    setDoc(doc(getDb(), 'categories', id), {
      ownerId: userId,
      name: name.trim(),
      slug,
      icon,
      createdAt: Timestamp.now(),
    }),
    'create the category',
  )
  return { id, name: name.trim(), icon, userId, createdAt }
}
