import type { ConnectionsScope, DeviceType, Region, SnapshotDevice, StatusReason } from '@/lib/contracts'

export type DeviceStatus = 'normal' | 'error' | 'offline' | 'unknown'

export const adminTypeLabels: Record<DeviceType, string> = {
  server: '服务器',
  line: '线路',
  router: '网络设备',
  power: '电力设备',
  battery: '电池',
  terminal: '终端',
}

export const statusReasonText: Record<StatusReason, string> = {
  online: '在线',
  offline: '离线',
  active_fault: '告警',
  not_configured: '数据源未配置',
  source_unavailable: '数据源不可用',
  status_missing: '缺少状态采样',
  status_unsupported: '状态监控项不可用',
  status_stale: '状态采样已过期',
  status_interval_unknown: '状态采样周期未知',
  interface_missing: '接口未返回',
  link_check_failed: '链路检测失败',
  status_unmapped: '状态值未映射',
  trigger_unavailable: '告警状态无法确认',
}

export function getDeviceStatus(device: SnapshotDevice): DeviceStatus {
  if (!device.statusAvailable) return 'unknown'
  if (device.hasFault && device.faultAvailable) return 'error'
  if (!device.reachable) return device.allowOffline ? 'offline' : 'error'
  return device.faultAvailable ? 'normal' : 'unknown'
}

export function formatOfflineDuration(offlineSince: number, now: number): string {
  const totalMinutes = Math.floor(Math.max(0, now - offlineSince) / 60_000)
  if (totalMinutes === 0) return '离线不到1分钟'
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `离线${days}天${hours}小时`
  if (hours > 0) return `离线${hours}小时${minutes}分`
  return `离线${minutes}分钟`
}

export function compareOrder(a: { order: number; id: string }, b: { order: number; id: string }): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function sortRegions(regions: Region[]): Region[] {
  return [...regions].sort(compareOrder)
}

export function sortDevices(devices: SnapshotDevice[]): SnapshotDevice[] {
  return [...devices].sort(compareOrder)
}

export function formatSampleTime(clock: number): string {
  return new Date(clock).toLocaleString('zh-CN', { hour12: false })
}

export function rateScale(_bps: number): { unit: string; divisor: number } {
  return { unit: 'Mbps', divisor: 1_000_000 }
}

/** Fixed Mbps, at most four characters. Do not turn an over-range value into a false reading. */
export function formatGaugeRate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return '—'
  const mbps = bps / 1_000_000
  if (mbps < 9.995) return mbps.toFixed(2)
  if (mbps < 99.95) return mbps.toFixed(1)
  const integer = Math.round(mbps)
  return integer <= 9999 ? String(integer) : '超限'
}

export function formatRate(bps: number) {
  const { unit, divisor } = rateScale(bps)
  return { value: String(Number((bps / divisor).toPrecision(4))), unit }
}

export function connectionsLabel(scope?: ConnectionsScope): string {
  return scope === 'port' ? '端口连接数' : scope === 'host' ? '主机连接数' : '连接数'
}
