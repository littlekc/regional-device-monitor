export type DeviceType = 'server' | 'line' | 'router' | 'power' | 'terminal'
export type DeviceStatus = 'normal' | 'error' | 'offline' | 'unknown'

export type MetricKind = 'percent' | 'power' | 'none'

export type DeviceMetric = {
  metricKind: MetricKind
  metricLabel?: string
  metricValue?: number
  metricUnit?: string
  metricMax?: number
}

export type MonitorDevice = {
  id: string
  name: string
  regionId: string
  type: DeviceType
  reachable: boolean
  /** 当前明确故障；失效或陈旧的故障样本须同时设置 faultAvailable=false。 */
  hasFault: boolean
  /** false = 故障样本不可用/已失效；缺省兼容原有固定演示故障。 */
  faultAvailable?: boolean
  allowOffline: boolean
  offlineSince?: number
  faultMessage?: string
  /** false = 状态数据不可用（未知），与 reachable 无关 */
  statusAvailable?: boolean
  hidden?: boolean
  order?: number
  hostId?: string
  statusItemId?: string
  valueItemId?: string
  faultItemId?: string
} & Partial<DeviceMetric>

const metricShowcase: Record<string, number> = {
  'a-server-01': 36,
  'a-router-01': 24,
  'a-line-01': 62,
  'a-power-02': 28.6,
}

function stableHash(value: string): number {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

function pick(id: string, min: number, max: number, decimals = 0): number {
  const factor = 10 ** decimals
  const span = Math.round((max - min) * factor)
  return min + (stableHash(id) % (span + 1)) / factor
}

export function getDemoMetric(id: string, type: DeviceType): DeviceMetric {
  const showcase = metricShowcase[id]
  switch (type) {
    case 'server':
      return { metricKind: 'percent', metricLabel: 'CPU', metricUnit: '%', metricMax: 100, metricValue: showcase ?? pick(id, 18, 72) }
    case 'router':
      return { metricKind: 'percent', metricLabel: '使用率', metricUnit: '%', metricMax: 100, metricValue: showcase ?? pick(id, 15, 55) }
    case 'line':
      return { metricKind: 'percent', metricLabel: '带宽', metricUnit: '%', metricMax: 100, metricValue: showcase ?? pick(id, 20, 80) }
    case 'power':
      return { metricKind: 'power', metricLabel: '功率', metricUnit: 'W', metricMax: 200, metricValue: showcase ?? pick(id, 14, 96, 1) }
    default:
      return { metricKind: 'none' }
  }
}

export function withDemoMetric(device: MonitorDevice): MonitorDevice {
  return device.metricKind ? device : { ...device, ...getDemoMetric(device.id, device.type) }
}

export type Region = {
  id: string
  name: string
  order: number
}

export const defaultRegions: Region[] = [
  { id: 'a', name: 'A区 · 主机房', order: 1 },
  { id: 'b', name: 'B区 · 分机房', order: 2 },
  { id: 'c', name: 'C区 · 办公区', order: 3 },
  { id: 'd', name: 'D区 · 测试区', order: 4 },
]

export function sortRegions(list: Region[]): Region[] {
  return [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
}

export const adminTypeLabels: Record<DeviceType, string> = {
  server: '服务器',
  line: '网络线路',
  router: '爱快设备',
  power: '电源设备',
  terminal: '普通终端',
}

const regionCounts = {
  a: { server: 2, line: 4, router: 1, power: 3, terminal: 13 },
  b: { server: 2, line: 4, router: 1, power: 3, terminal: 12 },
  c: { server: 2, line: 4, router: 1, power: 3, terminal: 12 },
  d: { server: 2, line: 3, router: 1, power: 3, terminal: 13 },
} as const

const typeLabels: Record<DeviceType, string> = {
  server: '服务器',
  line: '线路',
  router: '爱快',
  power: '电源板',
  terminal: '终端',
}

const statusOverrides: Record<string, Partial<MonitorDevice>> = {
  'a-line-03': { reachable: false, allowOffline: false, offlineSince: -18 * 60_000 },
  'a-server-02': { reachable: false, allowOffline: false, offlineSince: -3 * 60 * 60_000 - 26 * 60_000 },
  'a-terminal-12': { reachable: false, allowOffline: true, offlineSince: -2 * 24 * 60 * 60_000 - 5 * 60 * 60_000 },
  'a-terminal-13': { reachable: false, allowOffline: true, offlineSince: -8 * 60_000 },
  'a-power-01': { reachable: true, hasFault: true, faultMessage: '供电异常' },
  'b-line-02': { reachable: false, allowOffline: false, offlineSince: -4 * 60 * 60_000 },
  'b-power-01': { reachable: true, hasFault: true, faultMessage: '供电异常' },
  'b-power-02': { reachable: true },
  'b-terminal-10': { reachable: false, allowOffline: false, statusAvailable: false },
  'b-terminal-11': { reachable: false, allowOffline: true, offlineSince: -1 * 24 * 60 * 60_000 - 2 * 60 * 60_000 },
  'b-terminal-12': { reachable: false, allowOffline: true, offlineSince: -42 * 60_000 },
  'c-line-04': { reachable: false, allowOffline: false, offlineSince: -52 * 60_000 },
  'c-terminal-10': { reachable: false, allowOffline: true, offlineSince: -6 * 60 * 60_000 },
  'c-terminal-11': { reachable: false, allowOffline: true, offlineSince: -3 * 24 * 60 * 60_000 - 4 * 60 * 60_000 },
  'c-terminal-12': { reachable: false, allowOffline: true, offlineSince: -2 * 60 * 60_000 - 15 * 60_000 },
  'd-terminal-10': { reachable: false, allowOffline: true, offlineSince: -2 * 24 * 60 * 60_000 - 5 * 60 * 60_000 },
  'd-terminal-11': { reachable: false, allowOffline: true, offlineSince: -1 * 24 * 60 * 60_000 },
  'd-terminal-12': { reachable: false, allowOffline: true, offlineSince: -5 * 60 * 60_000 },
  'd-terminal-13': { reachable: false, allowOffline: true, offlineSince: -26 * 60_000 },
}

export function createDemoDevices(initializedAt = Date.now()): MonitorDevice[] {
  return (Object.entries(regionCounts) as [keyof typeof regionCounts, typeof regionCounts.a][]).flatMap(([regionId, counts]) =>
    (Object.entries(counts) as [DeviceType, number][]).flatMap(([type, count]) =>
      Array.from({ length: count }, (_, index) => {
        const number = String(index + 1).padStart(2, '0')
        const id = `${regionId}-${type}-${number}`
        const override = statusOverrides[id] ?? {}
        const offlineSince = override.offlineSince !== undefined ? initializedAt + override.offlineSince : undefined
        return {
          id,
          name: `${regionId.toUpperCase()}-${typeLabels[type]}${number}`,
          regionId,
          type,
          reachable: true,
          hasFault: false,
          allowOffline: false,
          ...getDemoMetric(id, type),
          ...override,
          offlineSince,
        }
      }),
    ),
  )
}

/** 未知优先：状态数据不可用时，即使允许离线也不显示灰色。 */
export function getDeviceStatus(device: MonitorDevice): DeviceStatus {
  if (device.statusAvailable === false) return 'unknown'
  if (device.hasFault && device.faultAvailable !== false) return 'error'
  if (!device.reachable) return device.allowOffline ? 'offline' : 'error'
  return 'normal'
}

/** 兼容旧缓存：按原 ID 只补充缺失字段，不覆盖编辑，不重置离线起点。 */
export function migrateCachedDevices(saved: MonitorDevice[]): MonitorDevice[] {
  const seed = new Map(createDemoDevices(0).map((device) => [device.id, device]))
  return saved.map((device) => {
    const original = seed.get(device.id)
    const next = withDemoMetric(device)
    if (original && next.statusAvailable === undefined && original.statusAvailable !== undefined) {
      return { ...next, statusAvailable: original.statusAvailable }
    }
    return next
  })
}

export function formatOfflineDuration(offlineSince: number, now: number): string {
  const totalMinutes = Math.max(1, Math.floor((now - offlineSince) / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `离线${days}天${hours}小时`
  if (hours > 0) return `离线${hours}小时${minutes}分`
  return `离线${minutes}分钟`
}

export function sortDevices(devices: MonitorDevice[]): MonitorDevice[] {
  const priority: Record<DeviceStatus, number> = { error: 0, unknown: 1, offline: 2, normal: 3 }
  return [...devices].sort((a, b) => {
    const statusDiff = priority[getDeviceStatus(a)] - priority[getDeviceStatus(b)]
    if (statusDiff) return statusDiff
    return compareOrder(a, b)
  })
}

export function compareOrder(a: MonitorDevice, b: MonitorDevice): number {
  const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  return orderDiff || a.id.localeCompare(b.id)
}

export function getVisibleDevices(devices: MonitorDevice[]): MonitorDevice[] {
  return devices.filter((device) => !device.hidden)
}
