import { toast } from 'sonner'

/**
 * Placeholder action for features that belong to a later milestone.
 * Remove call sites as each milestone lands.
 */
export function comingSoon(feature: string, milestone: number) {
  toast(`${feature} is on the way`, {
    description: `It ships in Milestone ${milestone} of the build plan.`,
  })
}
