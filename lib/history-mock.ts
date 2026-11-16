import { formatCount, getDemoMetric, getDeviceStatus, type DeviceStatus, type MonitorDevice } from '@/lib/monitor-data'

/** 演示历史数据：按设备 ID 稳定生成，末点与当前读数一致；离线 / 缺失时段留空。 */

export type HistoryRange = '1h' | '24h' | '7d'

export const historyRanges: { id: HistoryRange; label: string }[] = [
  { id: '1h', label: '近 1 小时' },
  { id: '24h', label: '近 24 小时' },
  { id: '7d', label: '近 7 天' },
]

const rangeConfig: Record<HistoryRange, { step: number; count: number }> = {
  '1h': { step: 60_000, count: 61 },
  '24h': { step: 15 * 60_000, count: 97 },
  '7d': { step: 60 * 60_000, count: 169 },
}

export type SeriesTone = 'load' | 'up' | 'down' | 'conn'

export type HistorySeries = {
  key: string
  label: string
  unit: string
  tone: SeriesTone
  /** 量程；缺省时按数据自动取整 */
  max?: number
  values: (number | null)[]
  current: number | null
  format: (value: number) => string
}

export type StatusSegment = { from: number; to: number; state: DeviceStatus }

export type DeviceHistory = {
  times: number[]
  series: HistorySeries[]
  segments: StatusSegment[]
  availability: number | null
}

function hash(value: string): number {
  let h = 2166136261
  for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619)
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shape(seed: string, times: number[], volatility: number, diurnal: number): number[] {
  const rand = mulberry32(hash(seed))
  let drift = 0
  return times.map((t) => {
    drift = drift * 0.82 + (rand() - 0.5) * volatility
    const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60
    const day = 1 + diurnal * Math.sin(((hour - 8) / 24) * Math.PI * 2)
    const spike = rand() > 0.97 ? 1 + rand() * volatility * 2 : 1
    return Math.max(0.04, day * (1 + drift) * spike)
  })
}

function fit(raw: number[], target: number, max?: number): number[] {
  const last = raw[raw.length - 1]
  return raw.map((r, i) => {
    const value = target > 0 ? (target * r) / last : (max ?? 10) * 0.015 * Math.abs(r - last)
    const clamped = max !== undefined ? Math.min(max, Math.max(0, value)) : Math.max(0, value)
    return i === raw.length - 1 ? target : clamped
  })
}

function cutoffFor(device: MonitorDevice, status: DeviceStatus, times: number[]): number {
  if (status === 'unknown') return times[0]
  if (!device.reachable) return device.offlineSince ?? times[Math.floor(times.length * 0.75)]
  return Number.POSITIVE_INFINITY
}

function mask(values: number[], times: number[], cutoff: number, missingTail: boolean): (number | null)[] {
  const tailStart = Math.floor(times.length * 0.86)
  return values.map((value, i) => (times[i] >= cutoff || (missingTail && i >= tailStart) ? null : value))
}

function buildSegments(device: MonitorDevice, status: DeviceStatus, start: number, end: number): StatusSegment[] {
  if (status === 'unknown') return [{ from: start, to: end, state: 'unknown' }]
  if (!device.reachable) {
    const since = Math.max(start, device.offlineSince ?? start + (end - start) * 0.75)
    const offState: DeviceStatus = device.allowOffline ? 'offline' : 'error'
    return since > start ? [{ from: start, to: since, state: 'normal' }, { from: since, to: end, state: offState }] : [{ from: start, to: end, state: offState }]
  }
  if (device.hasFault) {
    const since = Math.max(start, end - 37 * 60_000)
    return since > start ? [{ from: start, to: since, state: 'normal' }, { from: since, to: end, state: 'error' }] : [{ from: start, to: end, state: 'error' }]
  }
  return [{ from: start, to: end, state: 'normal' }]
}

function niceCeil(value: number): number {
  if (value <= 0) return 10
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value) ?? 10
  return step * power
}

export function buildHistory(device: MonitorDevice, range: HistoryRange, now: number): DeviceHistory {
  const { step, count } = rangeConfig[range]
  const end = Math.floor(now / step) * step
  const times = Array.from({ length: count }, (_, i) => end - (count - 1 - i) * step)
  const status = getDeviceStatus(device)
  const segments = buildSegments(device, status, times[0], times[times.length - 1])
  const span = times[times.length - 1] - times[0]
  const availability = status === 'unknown' ? null : segments.filter((s) => s.state === 'normal').reduce((sum, s) => sum + (s.to - s.from), 0) / span
  const cutoff = cutoffFor(device, status, times)
  const live = status !== 'unknown' && device.reachable
  const fallback = getDemoMetric(device.id, device.type)
  const seed = `${device.id}:${range}`
  const diurnal = range === '1h' ? 0.05 : 0.32

  const series: HistorySeries[] = []
  const kind = device.metricKind ?? 'none'

  if (kind === 'percent' || kind === 'power') {
    const max = kind === 'percent' ? 100 : device.metricMax ?? 200
    const hasCurrent = Number.isFinite(device.metricValue)
    const base = hasCurrent ? (device.metricValue as number) : fallback.metricValue ?? max * 0.4
    const values = mask(fit(shape(`${seed}:m`, times, 0.22, diurnal), base, max), times, cutoff, live && !hasCurrent)
    const unit = kind === 'percent' ? '%' : 'W'
    series.push({
      key: 'metric', label: device.metricLabel ?? (kind === 'power' ? '功率' : '负荷'), unit, tone: 'load', max, values,
      current: live && hasCurrent ? base : null,
      format: (v) => (kind === 'power' ? v.toFixed(1) : String(Math.round(v))),
    })
  }

  if (kind === 'traffic') {
    const upMax = device.uploadMax ?? 100
    const downMax = device.downloadMax ?? 1000
    const parts: { key: 'up' | 'down' | 'conn'; label: string; unit: string; value?: number; fallback: number; max?: number; volatility: number }[] = [
      { key: 'up', label: '上传速率', unit: 'Mbps', value: device.uploadValue, fallback: fallback.uploadValue ?? upMax * 0.3, max: upMax, volatility: 0.42 },
      { key: 'down', label: '下载速率', unit: 'Mbps', value: device.downloadValue, fallback: fallback.downloadValue ?? downMax * 0.3, max: downMax, volatility: 0.34 },
      { key: 'conn', label: '连接数', unit: '个', value: device.connections, fallback: fallback.connections ?? 800, volatility: 0.16 },
    ]
    for (const part of parts) {
      const hasCurrent = Number.isFinite(part.value)
      const base = hasCurrent ? (part.value as number) : part.fallback
      const fitted = fit(shape(`${seed}:${part.key}`, times, part.volatility, diurnal), base, part.max)
      const values = mask(part.key === 'conn' ? fitted.map(Math.round) : fitted, times, cutoff, live && !hasCurrent)
      const peak = Math.max(0, ...values.filter((v): v is number => v !== null))
      series.push({
        key: part.key, label: part.label, unit: part.unit, tone: part.key, values,
        max: part.max ?? niceCeil(peak * 1.15),
        current: live && hasCurrent ? base : null,
        format: part.key === 'conn' ? formatCount : (v) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1)),
      })
    }
  }

  return { times, series, segments, availability }
}

export function summarize(values: (number | null)[]) {
  const present = values.filter((v): v is number => v !== null)
  if (!present.length) return { avg: null, peak: null }
  return { avg: present.reduce((a, b) => a + b, 0) / present.length, peak: Math.max(...present) }
}

export function formatTime(t: number, range: HistoryRange): string {
  const d = new Date(t)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return range === '7d' ? `${d.getMonth() + 1}/${d.getDate()} ${hm}` : hm
}
