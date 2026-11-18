import { DEFAULT_SETTINGS, type MonitorSnapshot } from '@/lib/contracts'
import { requestJson } from '@/lib/monitor-client'

export type SnapshotPath = '/api/snapshot' | '/api/admin/snapshot'
export type SnapshotState = { snapshot?: MonitorSnapshot; clockOffset: number; failed: boolean }

export function startSnapshotPolling(
  path: SnapshotPath,
  onUpdate: (state: SnapshotState) => void,
  visibility: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>,
) {
  let state: SnapshotState = { clockOffset: 0, failed: false }
  let active: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let refreshQueued = false

  async function poll() {
    if (stopped || active) return
    clearTimeout(timer)
    const request = new AbortController()
    const startedAt = Date.now()
    active = request
    const timeout = setTimeout(
      () => request.abort(new DOMException('Snapshot request timed out', 'TimeoutError')),
      10_000,
    )
    try {
      const snapshot = await requestJson<MonitorSnapshot>(path, { signal: request.signal })
      if (stopped) return
      state = { snapshot, clockOffset: snapshot.serverTime - Date.now(), failed: false }
      onUpdate(state)
    } catch {
      if (stopped) return
      const previous = state.snapshot
      state = {
        ...state,
        failed: true,
        snapshot: previous && {
          ...previous,
          devices: previous.devices.map((device) => ({
            ...device, statusAvailable: false, reachable: false, hasFault: false, faultAvailable: false,
            statusReason: 'source_unavailable', metricValue: undefined, offlineSince: undefined, alarmSince: undefined,
            uploadValue: undefined, downloadValue: undefined, connections: undefined,
            cpuValue: undefined, memoryValue: undefined, cpuClock: undefined, memoryClock: undefined,
            wanIps: undefined, wanIpClock: undefined,
          })),
        },
      }
      onUpdate(state)
    } finally {
      clearTimeout(timeout)
      active = undefined
      if (!stopped) {
        if (refreshQueued) {
          refreshQueued = false
          void poll()
        } else {
          const interval = (state.snapshot?.settings.refreshSeconds ?? DEFAULT_SETTINGS.refreshSeconds) * 1000
          timer = setTimeout(poll, state.failed ? interval : Math.max(50, interval - (Date.now() - startedAt)))
        }
      }
    }
  }

  function onVisibilityChange() {
    if (visibility.visibilityState === 'visible') void poll()
  }
  visibility.addEventListener('visibilitychange', onVisibilityChange)
  void poll()

  return {
    refresh() {
      if (stopped) return
      if (active) refreshQueued = true
      else void poll()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      visibility.removeEventListener('visibilitychange', onVisibilityChange)
      active?.abort()
    },
  }
}
