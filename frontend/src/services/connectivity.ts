import { useNetworkStore } from '@/stores/network-store'

/**
 * Mirrors browser connectivity into the network store.
 *
 * This is all that survives of the old services/offline layer: Firestore's
 * persistent cache now serves reads offline and replays writes on reconnect by
 * itself, so there is no queue to flush and nothing to retry on a timer. The
 * flag exists only so the UI can say "you're offline" — never to decide
 * whether to attempt a write.
 */
export function initConnectivity(): () => void {
  const handleChange = () => {
    useNetworkStore.getState().setOnline(navigator.onLine)
  }
  window.addEventListener('online', handleChange)
  window.addEventListener('offline', handleChange)
  handleChange()

  return () => {
    window.removeEventListener('online', handleChange)
    window.removeEventListener('offline', handleChange)
  }
}
