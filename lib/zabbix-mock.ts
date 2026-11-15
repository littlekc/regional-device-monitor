import type { DeviceType, MetricKind, MonitorDevice } from '@/lib/monitor-data'

/** 测试数据：模拟 Zabbix 主机与监控项，不连接任何真实服务。 */

export type MockHost = { id: string; name: string; ip: string }

type StatusSample = { state: 'up' } | { state: 'down'; downForMinutes?: number } | { state: 'unavailable' }

export type MockItem =
  | { id: string; hostId: string; role: 'status'; name: string; key: string; updatedAgoSec: number; sample: StatusSample }
  | { id: string; hostId: string; role: 'percent' | 'power'; name: string; key: string; label: string; updatedAgoSec: number; value: number | null }
  | { id: string; hostId: string; role: 'fault'; name: string; key: string; updatedAgoSec: number; active: boolean; message: string }

export const mockHosts: MockHost[] = [
  { id: 'h-term-01', name: '前台终端-01', ip: '10.20.3.21' },
  { id: 'h-term-02', name: '会议室终端-02', ip: '10.20.3.45' },
  { id: 'h-term-03', name: '仓库终端-03', ip: '10.20.3.88' },
  { id: 'h-srv-web', name: 'Web 服务器-01', ip: '10.10.1.11' },
  { id: 'h-srv-db', name: '数据库服务器-02', ip: '10.10.1.12' },
  { id: 'h-ikuai-a', name: '爱快 A · 出口路由', ip: '10.0.0.1' },
  { id: 'h-pdu-01', name: '电源板 PDU-01', ip: '10.30.0.5' },
  { id: 'h-pdu-02', name: '电源板 PDU-02', ip: '10.30.0.6' },
]

export const mockItems: MockItem[] = [
  { id: 'i-term01-ping', hostId: 'h-term-01', role: 'status', name: 'ICMP 在线检查', key: 'icmpping', updatedAgoSec: 12, sample: { state: 'up' } },
  { id: 'i-term02-ping', hostId: 'h-term-02', role: 'status', name: 'ICMP 在线检查', key: 'icmpping', updatedAgoSec: 18, sample: { state: 'down', downForMinutes: 35 } },
  { id: 'i-term03-ping', hostId: 'h-term-03', role: 'status', name: 'ICMP 在线检查', key: 'icmpping', updatedAgoSec: 640, sample: { state: 'unavailable' } },

  { id: 'i-web-agent', hostId: 'h-srv-web', role: 'status', name: 'Agent 可用性', key: 'agent.ping', updatedAgoSec: 8, sample: { state: 'up' } },
  { id: 'i-web-ping', hostId: 'h-srv-web', role: 'status', name: 'ICMP 在线检查', key: 'icmpping', updatedAgoSec: 9, sample: { state: 'up' } },
  { id: 'i-web-cpu', hostId: 'h-srv-web', role: 'percent', name: 'CPU 使用率', label: 'CPU', key: 'system.cpu.util', updatedAgoSec: 8, value: 1 },
  { id: 'i-web-mem', hostId: 'h-srv-web', role: 'percent', name: '内存使用率', label: '内存', key: 'vm.memory.utilization', updatedAgoSec: 8, value: 61 },
  { id: 'i-web-disk', hostId: 'h-srv-web', role: 'percent', name: '磁盘使用率 /data', label: '磁盘', key: 'vfs.fs.pused[/data]', updatedAgoSec: 900, value: null },

  { id: 'i-db-agent', hostId: 'h-srv-db', role: 'status', name: 'Agent 可用性', key: 'agent.ping', updatedAgoSec: 6, sample: { state: 'up' } },
  { id: 'i-db-cpu', hostId: 'h-srv-db', role: 'percent', name: 'CPU 使用率', label: 'CPU', key: 'system.cpu.util', updatedAgoSec: 6, value: 100 },

  { id: 'i-ikuai-ping', hostId: 'h-ikuai-a', role: 'status', name: '设备在线检查', key: 'icmpping', updatedAgoSec: 5, sample: { state: 'up' } },
  { id: 'i-ikuai-wan1', hostId: 'h-ikuai-a', role: 'status', name: 'WAN1 链路状态', key: 'net.if.status[wan1]', updatedAgoSec: 5, sample: { state: 'up' } },
  { id: 'i-ikuai-wan2', hostId: 'h-ikuai-a', role: 'status', name: 'WAN2 链路状态', key: 'net.if.status[wan2]', updatedAgoSec: 5, sample: { state: 'down' } },
  { id: 'i-ikuai-cpu', hostId: 'h-ikuai-a', role: 'percent', name: 'CPU 使用率', label: '使用率', key: 'system.cpu.util', updatedAgoSec: 5, value: 18 },
  { id: 'i-ikuai-wan1-bw', hostId: 'h-ikuai-a', role: 'percent', name: 'WAN1 带宽利用率', label: '带宽', key: 'net.if.util[wan1]', updatedAgoSec: 5, value: 47 },
  { id: 'i-ikuai-wan2-bw', hostId: 'h-ikuai-a', role: 'percent', name: 'WAN2 带宽利用率', label: '带宽', key: 'net.if.util[wan2]', updatedAgoSec: 5, value: null },

  { id: 'i-pdu01-ping', hostId: 'h-pdu-01', role: 'status', name: '电源板在线检查', key: 'icmpping', updatedAgoSec: 10, sample: { state: 'up' } },
  { id: 'i-pdu01-power', hostId: 'h-pdu-01', role: 'power', name: '总输出功率', label: '功率', key: 'pdu.power.total', updatedAgoSec: 10, value: 0 },
  { id: 'i-pdu01-fault', hostId: 'h-pdu-01', role: 'fault', name: '供电故障告警', key: 'pdu.supply.fault', updatedAgoSec: 10, active: false, message: '供电异常' },
  { id: 'i-pdu02-ping', hostId: 'h-pdu-02', role: 'status', name: '电源板在线检查', key: 'icmpping', updatedAgoSec: 11, sample: { state: 'up' } },
  { id: 'i-pdu02-power', hostId: 'h-pdu-02', role: 'power', name: '总输出功率', label: '功率', key: 'pdu.power.total', updatedAgoSec: 11, value: 126.4 },
  { id: 'i-pdu02-fault', hostId: 'h-pdu-02', role: 'fault', name: '供电故障告警', key: 'pdu.supply.fault', updatedAgoSec: 11, active: true, message: '供电异常' },
]

export function getHost(id?: string) {
  return mockHosts.find((host) => host.id === id)
}

export function getItem(id?: string) {
  return mockItems.find((item) => item.id === id)
}

export function getHostItems(hostId: string | undefined, role: MockItem['role']) {
  return mockItems.filter((item) => item.hostId === hostId && item.role === role)
}

export function describeItemSample(item: MockItem): string {
  switch (item.role) {
    case 'status':
      if (item.sample.state === 'up') return '在线'
      if (item.sample.state === 'down') return '离线'
      return '数据不可用'
    case 'fault':
      return item.active ? `触发：${item.message}` : '未触发'
    default:
      return item.value === null ? '无数据' : `${item.value}${item.role === 'power' ? ' W' : '%'}`
  }
}

export function formatUpdatedAgo(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒前`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  return `${Math.floor(seconds / 3600)} 小时前`
}

export type DisplayMode = 'status' | 'percent' | 'power'

export const KEEP_CURRENT = '__keep'

export type ProjectDraft = {
  name: string
  regionId: string
  type: DeviceType
  hostId: string
  statusItemId: string
  mode: DisplayMode
  valueItemId: string
  powerMax: string
  allowOffline: boolean
  faultItemId: string
  order: string
}

export function draftFromDevice(device?: MonitorDevice, fallbackRegionId = ''): ProjectDraft {
  const kind: MetricKind = device?.metricKind ?? 'none'
  const mode: DisplayMode = kind === 'none' ? 'status' : kind
  return {
    name: device?.name ?? '',
    regionId: device?.regionId ?? fallbackRegionId,
    type: device?.type ?? 'terminal',
    hostId: device?.hostId ?? '',
    statusItemId: device?.statusItemId ?? '',
    mode,
    valueItemId: device?.valueItemId ?? (device && mode !== 'status' ? KEEP_CURRENT : ''),
    powerMax: String(device?.metricKind === 'power' ? device.metricMax ?? 200 : 200),
    allowOffline: device?.allowOffline ?? false,
    faultItemId: device?.faultItemId ?? '',
    order: device?.order !== undefined ? String(device.order) : '',
  }
}

/**
 * 将表单草稿解析为大屏项目。未改动的状态绑定会保留原有在线状态与离线起点，
 * 避免编辑名称等字段时重置离线时长。
 */
export function resolveDraft(draft: ProjectDraft, id: string, now: number, existing?: MonitorDevice): MonitorDevice {
  const base: MonitorDevice = {
    id,
    name: draft.name.trim() || '未命名项目',
    regionId: draft.regionId,
    type: draft.type,
    allowOffline: draft.allowOffline,
    reachable: existing?.reachable ?? true,
    hasFault: existing?.hasFault ?? false,
    faultAvailable: existing?.faultAvailable,
    offlineSince: existing?.offlineSince,
    faultMessage: existing?.faultMessage,
    statusAvailable: existing?.statusAvailable,
    hidden: existing?.hidden ?? false,
    hostId: draft.hostId || undefined,
    statusItemId: draft.statusItemId || undefined,
    faultItemId: draft.faultItemId || undefined,
    order: draft.order.trim() === '' ? undefined : Number(draft.order),
  }

  const statusItem = getItem(draft.statusItemId)
  const statusChanged = draft.statusItemId !== (existing?.statusItemId ?? '')
  if (statusItem?.role === 'status' && (statusChanged || !existing)) {
    const sample = statusItem.sample
    base.statusAvailable = sample.state !== 'unavailable'
    base.reachable = sample.state === 'up'
    base.offlineSince = sample.state === 'down' && sample.downForMinutes ? now - sample.downForMinutes * 60_000 : undefined
  } else if (!statusItem && draft.hostId === '' && !existing) {
    base.statusAvailable = false
  }

  if (draft.hostId) {
    const faultItem = getItem(draft.faultItemId)
    base.faultAvailable = faultItem?.role === 'fault'
    base.hasFault = faultItem?.role === 'fault' ? faultItem.active : false
    base.faultMessage = faultItem?.role === 'fault' ? faultItem.message : undefined
  }

  if (draft.mode === 'status') return { ...base, metricKind: 'none' }

  const max = draft.mode === 'percent' ? 100 : Number(draft.powerMax) || 0
  const unit = draft.mode === 'percent' ? '%' : 'W'
  if (draft.valueItemId === KEEP_CURRENT && existing?.metricKind === draft.mode) {
    return { ...base, metricKind: draft.mode, metricLabel: existing.metricLabel, metricUnit: unit, metricMax: max, metricValue: existing.metricValue, valueItemId: existing.valueItemId }
  }
  const valueItem = getItem(draft.valueItemId)
  const value = valueItem && (valueItem.role === 'percent' || valueItem.role === 'power') ? valueItem : undefined
  return {
    ...base,
    metricKind: draft.mode,
    metricLabel: value?.label ?? (draft.mode === 'power' ? '功率' : undefined),
    metricUnit: unit,
    metricMax: max,
    metricValue: value?.value ?? undefined,
    valueItemId: value?.id,
  }
}

export type DraftErrors = Partial<Record<'name' | 'regionId' | 'hostId' | 'statusItemId' | 'valueItemId' | 'powerMax' | 'order', string>>

export function validateDraft(draft: ProjectDraft, existing?: MonitorDevice): DraftErrors {
  const errors: DraftErrors = {}
  const legacyUnbound = Boolean(existing && !existing.hostId)
  if (!draft.name.trim()) errors.name = '请填写项目名称'
  if (!draft.regionId) errors.regionId = '请选择所属区域'
  if (!draft.hostId && !legacyUnbound) errors.hostId = '请选择来源主机'
  if (draft.hostId && !draft.statusItemId) errors.statusItemId = '请选择状态监控项'
  if (draft.mode !== 'status') {
    const canKeep = draft.valueItemId === KEEP_CURRENT && existing?.metricKind === draft.mode
    if (!canKeep && !getItem(draft.valueItemId)) errors.valueItemId = '请选择数值监控项'
  }
  if (draft.mode === 'power') {
    const max = Number(draft.powerMax)
    if (!draft.powerMax.trim() || !Number.isFinite(max) || max <= 0) errors.powerMax = '满量程需大于 0'
  }
  if (draft.order.trim() !== '') {
    const order = Number(draft.order)
    if (!Number.isInteger(order) || order < 1) errors.order = '请输入大于 0 的整数'
  }
  return errors
}
