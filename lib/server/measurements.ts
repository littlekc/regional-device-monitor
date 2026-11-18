import type { CatalogItem, ConnectionsScope, MonitorProject } from '../contracts.ts'
import { rateMultiplier, trafficRateCandidate } from '../traffic-catalog.ts'
import { isNumeric } from './validation.ts'

export function numericItem(item: CatalogItem): boolean {
  return item.valueType === '0' || item.valueType === '3'
}

export function projectItem(items: ReadonlyMap<string, CatalogItem>, id: string | undefined, hostId: string): CatalogItem | undefined {
  const item = id ? items.get(id) : undefined
  return item?.hostId === hostId ? item : undefined
}

export function projectItemIds(project: MonitorProject): string[] {
  const { statusItemId, valueItemId, metric } = project
  if (metric.kind === 'resources') return [statusItemId, metric.cpuItemId, metric.memoryItemId]
  if (metric.kind === 'traffic') {
    const { uploadItemId, downloadItemId, connectionsItemId } = metric
    return [statusItemId, uploadItemId, downloadItemId, ...(connectionsItemId ? [connectionsItemId] : [])]
  }
  return [statusItemId, ...(valueItemId ? [valueItemId] : [])]
}

function parseNumber(raw: string): number | undefined {
  const text = raw.trim()
  return isNumeric(text) ? Number(text) : undefined
}

export function rateItem(
  item: CatalogItem | undefined, status: CatalogItem | undefined, role: 'upload' | 'download',
): item is CatalogItem {
  return trafficRateCandidate(item, role, status)
}

export function countItem(
  item: CatalogItem | undefined, status: CatalogItem | undefined, scope: ConnectionsScope,
): item is CatalogItem {
  if (!item || !numericItem(item) || item.id === status?.id) return false
  if (scope === 'port' && /^ikuai\.metric\[\s*"?connections"?\s*\]$/i.test(item.key)) return false
  return /^(?:count|counts|connection|connections|个|条|次)?$/i.test(item.units.trim())
}

export function rateSample(item: CatalogItem, raw: string): number | undefined {
  const value = parseNumber(raw)
  const multiplier = rateMultiplier(item.units)
  if (value === undefined || value < 0 || multiplier === undefined) return
  const result = value * multiplier
  return Number.isFinite(result) ? result : undefined
}

export function countSample(raw: string): number | undefined {
  const value = parseNumber(raw)
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function percentSample(raw: string): number | undefined {
  const value = parseNumber(raw)
  return value !== undefined && value >= 0 && value <= 100 ? value : undefined
}

export function scalarSample(project: MonitorProject, item: CatalogItem, raw: string): number | undefined {
  const value = parseNumber(raw)
  if (value === undefined || project.metric.kind === 'none' || project.metric.kind === 'traffic' || project.metric.kind === 'resources') return
  if (project.metric.kind !== 'percent') return value
  const percent = project.metric.capacity !== undefined
    ? (value / project.metric.capacity) * 100
    : item.units.trim() === '%' ? value : undefined
  if (percent === undefined || !Number.isFinite(percent)) return
  if (project.type === 'battery' && (percent < 0 || percent > 100)) return
  return percent
}

export function displayUnit(project: MonitorProject, item?: CatalogItem): string | undefined {
  const { metric } = project
  if (metric.kind === 'traffic') return 'bps'
  if (metric.kind === 'percent') return '%'
  if (metric.kind === 'power') return metric.unit ?? (item?.units.trim() || 'W')
  return 'unit' in metric ? metric.unit ?? item?.units : item?.units
}
