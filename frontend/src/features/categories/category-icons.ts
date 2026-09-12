import {
  Banknote,
  Car,
  Clapperboard,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Lightbulb,
  Plane,
  Repeat,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Utensils,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Explicit map of the icons the built-in categories use (see
 * features/categories/default-categories.ts) so tree-shaking keeps working —
 * importing lucide's full `icons` object would pull every icon into the
 * bundle. Custom categories fall back to the tag icon.
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  banknote: Banknote,
  car: Car,
  clapperboard: Clapperboard,
  gift: Gift,
  'graduation-cap': GraduationCap,
  'heart-pulse': HeartPulse,
  home: Home,
  lightbulb: Lightbulb,
  plane: Plane,
  repeat: Repeat,
  'shopping-bag': ShoppingBag,
  'shopping-cart': ShoppingCart,
  tag: Tag,
  utensils: Utensils,
}

export function categoryIcon(iconName: string | null | undefined): LucideIcon {
  return (iconName && CATEGORY_ICONS[iconName]) || Tag
}
