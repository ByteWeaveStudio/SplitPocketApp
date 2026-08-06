import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { categoryIcon } from '@/features/categories/category-icons'
import { useExpensesStore } from '@/features/personal-expenses/expenses-store'
import type { Category, ExpenseKind } from '@/types'

export function ExpenseFilters({ categories }: { categories: Category[] }) {
  const search = useExpensesStore((state) => state.search)
  const setSearch = useExpensesStore((state) => state.setSearch)
  const categoryFilter = useExpensesStore((state) => state.categoryFilter)
  const setCategoryFilter = useExpensesStore((state) => state.setCategoryFilter)
  const kindFilter = useExpensesStore((state) => state.kindFilter)
  const setKindFilter = useExpensesStore((state) => state.setKindFilter)

  return (
    <div className="flex flex-col gap-2 pb-4 sm:flex-row">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="Search descriptions and notes"
          aria-label="Search expenses"
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="sm:w-44" aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((category) => {
              const Icon = categoryIcon(category.icon)
              return (
                <SelectItem key={category.id} value={category.id}>
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  {category.name}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <Select
          value={kindFilter}
          onValueChange={(value) => setKindFilter(value as ExpenseKind | 'all')}
        >
          <SelectTrigger className="sm:w-36" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="expense">Expenses</SelectItem>
            <SelectItem value="income">Income</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
