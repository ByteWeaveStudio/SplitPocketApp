import { CloudOff, RefreshCw } from 'lucide-react'

import { useNetworkStore } from '@/stores/network-store'

/**
 * Slim status strip under the header: offline, or online with queued
 * changes still syncing. Hidden the rest of the time.
 */
export function ConnectivityBanner() {
  const online = useNetworkStore((state) => state.online)
  const syncing = useNetworkStore((state) => state.syncing)
  const pendingCount = useNetworkStore((state) => state.pendingCount)

  if (online && pendingCount === 0) return null

  const label = online
    ? syncing
      ? `Syncing ${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'}…`
      : `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} waiting to sync`
    : 'You’re offline — changes you make will sync when you’re back.'

  return (
    <p
      role="status"
      className="flex items-center justify-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-700 dark:text-amber-400"
    >
      {online ? (
        <RefreshCw className={syncing ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden />
      ) : (
        <CloudOff className="size-3.5" aria-hidden />
      )}
      {label}
    </p>
  )
}
