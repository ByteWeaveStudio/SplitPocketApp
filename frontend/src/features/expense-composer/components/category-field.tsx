import { Check, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { categoryIcon } from '@/features/categories/category-icons'

/** Category picker with inline creation, shared by both composer forms.
 * 'none' rather than '' because Radix Select items can't have empty values. */
export function CategoryField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const { categories, status, load, add } = useCategoriesStore()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  async function createCategory() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const category = await add(trimmed)
      onChange(category.id)
      setCreating(false)
      setName('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t create the category.')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Category</Label>
      {creating ? (
        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder="Category name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void createCategory()
              }
            }}
          />
          <Button type="button" size="icon" aria-label="Create category" onClick={createCategory}>
            <Check className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Cancel new category"
            onClick={() => setCreating(false)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger id={id} className="flex-1">
              <SelectValue placeholder={status === 'loading' ? 'Loading…' : 'Pick a category'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Uncategorized</SelectItem>
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
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="New category"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}
