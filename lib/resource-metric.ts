import type { CatalogItem, ProjectMetric, ResourcesMetric } from './contracts.ts'

type PercentItem = Pick<CatalogItem, 'id' | 'units' | 'valueType'>

export function resourceItemCandidate(item: PercentItem | undefined, statusItemId: string, otherItemId?: string): boolean {
  return !!item && item.id !== statusItemId && item.id !== otherItemId &&
    (item.valueType === '0' || item.valueType === '3') && item.units.trim() === '%'
}

export function draftResourceMetric(metric?: ProjectMetric) {
  return metric?.kind === 'resources'
    ? { cpuItemId: metric.cpuItemId, memoryItemId: metric.memoryItemId }
    : { cpuItemId: '', memoryItemId: '' }
}

export function buildResourceMetric(
  { cpuItemId, memoryItemId }: ReturnType<typeof draftResourceMetric>, statusItemId: string,
): { metric: ResourcesMetric } | { error: string } {
  if (!cpuItemId || !memoryItemId) return { error: '请选择 CPU 和内存的使用率监控项。' }
  if (cpuItemId === memoryItemId) return { error: 'CPU 和内存须使用不同监控项。' }
  if (cpuItemId === statusItemId || memoryItemId === statusItemId) return { error: 'CPU 和内存不能复用状态监控项。' }
  return { metric: { kind: 'resources', cpuItemId, memoryItemId } }
}
