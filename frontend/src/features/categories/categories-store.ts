import { create } from 'zustand'

import { createCategory, listCategories } from '@/features/categories/categories-service'
import type { Category } from '@/types'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface CategoriesState {
  categories: Category[]
  status: LoadStatus
  /** Loads once; later calls are no-ops unless the first attempt failed. */
  load: () => Promise<void>
  add: (name: string) => Promise<Category>
  reset: () => void
}

export const useCategoriesStore = create<CategoriesState>()((set, get) => ({
  categories: [],
  status: 'idle',

  load: async () => {
    const { status } = get()
    if (status === 'loading' || status === 'ready') return
    set({ status: 'loading' })
    try {
      set({ categories: await listCategories(), status: 'ready' })
    } catch {
      set({ status: 'error' })
    }
  },

  add: async (name) => {
    const category = await createCategory(name)
    set((state) => ({
      categories: [...state.categories, category].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    return category
  },

  reset: () => set({ categories: [], status: 'idle' }),
}))
