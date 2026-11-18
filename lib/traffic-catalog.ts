import type { CatalogItem } from './contracts.ts'

export type CatalogRateItem = Pick<CatalogItem, 'id' | 'key' | 'units' | 'valueType'>
export type CatalogStatusItem = Pick<CatalogItem, 'id' | 'key'>

/** Zabbix stores preprocessed samples in the declared unit. Convert that unit only. */
export function rateMultiplier(units: string): number | undefined {
  const prefix = /^([kKMGTPE]?)(.+)$/.exec(units.trim())
  if (!prefix) return
  const [, scale, suffix] = prefix
  const magnitude = scale ? 1000 ** ('KMGTPE'.indexOf(scale.toUpperCase()) + 1) : 1
  if (/^(?:bps|b\/s|bits?\/s)$/.test(suffix)) return magnitude
  if (/^(?:Bps|B\/s|bytes?\/s)$/.test(suffix)) return 8 * magnitude
}

export function trafficRateCandidate<T extends CatalogRateItem>(
  item: T | undefined, role: 'upload' | 'download', status?: CatalogStatusItem,
): item is T {
  if (!item || (item.valueType !== '0' && item.valueType !== '3') || item.id === status?.id || rateMultiplier(item.units) === undefined) return false
  const direction = /^net\.if\.(in|out)\[/.exec(item.key)?.[1]
  if (direction && direction !== (role === 'upload' ? 'out' : 'in')) return false
  const index = /^net\.if\.(?:in\[if(?:HC)?In|out\[if(?:HC)?Out)Octets[.,](\d+)(?:,|\])/.exec(item.key)?.[1]
  const statusIndex = /^net\.if\.status\[ifOperStatus[.,](\d+)(?:,|\])/.exec(status?.key ?? '')?.[1]
  return !index || !statusIndex || index === statusIndex
}
