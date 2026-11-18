import { isScalarMetric, type CatalogItem, type ConnectionsScope, type ProjectMetric, type TrafficMetric } from '@/lib/contracts'
import { draftResourceMetric } from '@/lib/resource-metric'
import { trafficRateCandidate, type CatalogRateItem, type CatalogStatusItem } from '@/lib/traffic-catalog'

const BPS_PER_MBPS = 1_000_000

export function draftTrafficMetric(metric?: ProjectMetric) {
  const traffic = metric?.kind === 'traffic' ? metric : undefined
  const connectionsScope: ConnectionsScope | '' = traffic?.connectionsScope ?? ''
  return {
    uploadItemId: traffic?.uploadItemId ?? '', downloadItemId: traffic?.downloadItemId ?? '',
    connectionsItemId: traffic?.connectionsItemId ?? '',
    connectionsScope,
    uploadMbps: traffic?.uploadMax === undefined ? '' : String(traffic.uploadMax / BPS_PER_MBPS),
    downloadMbps: traffic?.downloadMax === undefined ? '' : String(traffic.downloadMax / BPS_PER_MBPS),
  }
}

type CandidateItem = Pick<CatalogItem, 'key' | 'units' | 'valueType'>

function numeric({ valueType }: CandidateItem) {
  return valueType === '0' || valueType === '3'
}

export function draftRateIssue(status?: CatalogStatusItem, upload?: CatalogRateItem, download?: CatalogRateItem) {
  const incompatible = []
  if (upload && !trafficRateCandidate(upload, 'upload', status)) incompatible.push('上传')
  if (download && !trafficRateCandidate(download, 'download', status)) incompatible.push('下载')
  if (incompatible.length) return `${incompatible.join('、')}速率监控项与当前绑定不兼容，请重新选择。`
}

export function metricModeChange(current: ProjectMetric['kind'], mode: ProjectMetric['kind']) {
  if (current === mode) return { mode }
  if (isScalarMetric(current) && isScalarMetric(mode)) {
    if (mode === 'percent') return { mode, unit: '', max: '' }
    return { mode, capacity: '' }
  }
  return { mode, valueItemId: '', label: '', unit: '', max: '', capacity: '', ...draftTrafficMetric(), ...draftResourceMetric() }
}

export function trafficCountCandidate(item: CandidateItem, scope: ConnectionsScope) {
  return numeric(item) && /^(?:count|counts|connection|connections|个|条|次)?$/i.test(item.units.trim()) &&
    !(scope === 'port' && /^ikuai\.metric\[\s*"?connections"?\s*\]$/i.test(item.key))
}

export function buildTrafficMetric(draft: ReturnType<typeof draftTrafficMetric>): { metric: TrafficMetric } | { error: string } {
  const { uploadItemId, downloadItemId, connectionsItemId, connectionsScope } = draft
  if (!uploadItemId || !downloadItemId) return { error: '请选择上传和下载监控项。' }
  if (uploadItemId === downloadItemId) return { error: '上传和下载须使用不同监控项。' }
  if (connectionsItemId && !connectionsScope) return { error: '请选择连接数的采集范围。' }
  if (connectionsScope && !connectionsItemId) return { error: '请选择连接数监控项，或将连接数范围设为不绑定。' }
  if (connectionsItemId === uploadItemId || connectionsItemId === downloadItemId) return { error: '连接数须使用独立的监控项。' }
  const uploadMax = draft.uploadMbps.trim() ? Number(draft.uploadMbps) * BPS_PER_MBPS : undefined
  const downloadMax = draft.downloadMbps.trim() ? Number(draft.downloadMbps) * BPS_PER_MBPS : undefined
  for (const limit of [uploadMax, downloadMax]) {
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) return { error: '仪表量程须为正数，也可留空。' }
  }
  const rates = {
    kind: 'traffic', uploadItemId, downloadItemId,
    ...(uploadMax === undefined ? {} : { uploadMax }),
    ...(downloadMax === undefined ? {} : { downloadMax }),
  } as const
  return { metric: connectionsItemId && connectionsScope ? { ...rates, connectionsItemId, connectionsScope } : rates }
}
