import type { CatalogItem, MonitorProject } from '../contracts.ts'
import type { OfflineCheckpoint } from './database.ts'
import { normalizeStatus } from './validation.ts'
import type { HistoryEntry } from './zabbix.ts'

type Status = 'online' | 'offline' | 'unmapped'
export type StatusMatcher = (raw: string) => Status

export function statusMatcher(project: MonitorProject): StatusMatcher {
  const online = new Set(project.statusMapping.online.map(normalizeStatus))
  const offline = new Set(project.statusMapping.offline.map(normalizeStatus))
  return (raw) => {
    const value = normalizeStatus(raw)
    if (online.has(value)) return 'online'
    if (offline.has(value)) return 'offline'
    return 'unmapped'
  }
}

export function canReuseCheckpoint(checkpoint: OfflineCheckpoint, sampleClock: number, now: number, ttl: number): boolean {
  return !checkpoint.needsBridge && now - checkpoint.observedAt <= ttl * 1000 && sampleClock === checkpoint.lastEvidenceClock
}

export function historyStart(
  item: CatalogItem,
  history: { entries: HistoryEntry[]; truncated: boolean },
  ttl: number,
  match: StatusMatcher,
  checkpoint?: OfflineCheckpoint,
): number | undefined {
  if (history.truncated) return
  const rows = history.entries.slice().sort((a, b) => b.clock - a.clock || b.ns - a.ns)
  const newest = rows[0]
  if (!newest || newest.clock !== item.lastClock || normalizeStatus(newest.value) !== normalizeStatus(item.lastValue)) return
  // Without a new sample, old history cannot bridge a newer observation gap.
  if (checkpoint && item.lastClock <= checkpoint.lastEvidenceClock) return
  let downClock = newest.clock
  for (const row of rows) {
    if (row.clock <= 0 || downClock - row.clock > ttl) return
    const status = match(row.value)
    if (status === 'unmapped') return
    if (status === 'online') return downClock
    if (checkpoint && row.clock === checkpoint.lastEvidenceClock) return checkpoint.offlineSince
    downClock = row.clock
  }
}

export function historyFrom(clock: number, ttl: number): number {
  return Math.max(1, clock - Math.min(86_400, ttl * 120))
}
