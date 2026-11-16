import type { CSSProperties } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  HelpCircle,
  Minus,
  Monitor,
  PowerOff,
  type LucideIcon,
} from 'lucide-react'
import {
  formatCount,
  formatOfflineDuration,
  formatRate,
  getDeviceStatus,
  type DeviceStatus,
  type DeviceType,
  type MonitorDevice,
} from '@/lib/monitor-data'
import type { PaletteId } from '@/lib/demo-store'

export const statusMeta: Record<DeviceStatus, { label: string; tone: string; icon: LucideIcon }> = {
  normal: { label: '正常', tone: 'tone-normal', icon: CheckCircle2 },
  error: { label: '异常', tone: 'tone-error', icon: AlertTriangle },
  offline: { label: '无影响离线', tone: 'tone-offline', icon: PowerOff },
  unknown: { label: '状态未知', tone: 'tone-unknown', icon: HelpCircle },
}

const normalText: Record<DeviceType, string> = {
  server: '运行正常',
  router: '运行正常',
  line: '线路正常',
  power: '供电正常',
  terminal: '设备在线',
}

const STATUS_RING_RADIUS = 46
const LOAD_RING_RADIUS = 37
const LOAD_CIRCUMFERENCE = 2 * Math.PI * LOAD_RING_RADIUS
/** 上下半圆在 3 点 / 9 点方向各留出的缝隙角度 */
const SPLIT_GAP = 7
const HALF_SWEEP = 180 - 2 * SPLIT_GAP

export const palettes: { id: PaletteId; name: string; note: string; swatches: string[] }[] = [
  { id: 'harbor', name: '港湾蓝', note: '默认 · 冷色负荷，暖色告警', swatches: ['#5cc8ec', '#56c9a0', '#ff5b69', '#f2b24a'] },
  { id: 'titanium', name: '钛白橙', note: '高对比 · 色觉差异友好', swatches: ['#e6eef6', '#9db2c4', '#ff8a2b', '#59a8ff'] },
  { id: 'jade', name: '玉青', note: '柔和 · 长时间值守', swatches: ['#42d6c2', '#7fcf9e', '#ff4d8d', '#ffd166'] },
]

type GaugeStatus = DeviceStatus | 'error-offline'

const statusBadgeIcon: Record<GaugeStatus, LucideIcon> = {
  normal: Check,
  error: AlertTriangle,
  'error-offline': PowerOff,
  offline: Minus,
  unknown: HelpCircle,
}

export function RoundIcon({ icon: Icon, tone, size = 'md' }: { icon: LucideIcon; tone: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`round-icon round-${size} ${tone}`} aria-hidden="true">
      <Icon size={size === 'md' ? 16 : 12} strokeWidth={1.9} />
    </span>
  )
}

export type TrafficReading = {
  kind: 'traffic'
  up?: number
  upMax: number
  down?: number
  downMax: number
  conn?: number
}

export type GaugeReading =
  | { kind: 'value'; value: string; unit: string; label?: string; progress: number }
  | TrafficReading
  | { kind: 'online' }
  | { kind: 'missing'; label?: string }
  | { kind: 'offline' }
  | { kind: 'unknown' }

const finite = (value?: number) => (value !== undefined && value !== null && Number.isFinite(value) ? value : undefined)
const ratio = (value: number | undefined, max: number) => (value === undefined || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max)))

export function getReading(device: MonitorDevice, status: DeviceStatus = getDeviceStatus(device)): GaugeReading {
  if (status === 'unknown') return { kind: 'unknown' }
  if (!device.reachable) return { kind: 'offline' }
  if (!device.metricKind || device.metricKind === 'none') return { kind: 'online' }
  if (device.metricKind === 'traffic') {
    const up = finite(device.uploadValue)
    const down = finite(device.downloadValue)
    const conn = finite(device.connections)
    if (up === undefined && down === undefined && conn === undefined) return { kind: 'missing', label: '流量' }
    return { kind: 'traffic', up, down, conn, upMax: device.uploadMax ?? 100, downMax: device.downloadMax ?? 1000 }
  }
  if (device.metricValue === undefined || device.metricValue === null || !Number.isFinite(device.metricValue)) {
    return { kind: 'missing', label: device.metricLabel }
  }
  const max = device.metricKind === 'percent' ? 100 : device.metricMax ?? 100
  const progress = max > 0 ? Math.min(1, Math.max(0, device.metricValue / max)) : 0
  const value = device.metricKind === 'power' ? device.metricValue.toFixed(1) : String(Math.round(device.metricValue))
  return { kind: 'value', value, unit: device.metricUnit ?? '', label: device.metricLabel, progress }
}

export function getStatusText(device: MonitorDevice, status: DeviceStatus, now: number): string {
  if (status === 'unknown') return '状态未知'
  if (status === 'normal') return normalText[device.type]
  if (device.reachable && device.hasFault) return device.faultMessage ?? '检测到故障'
  return device.offlineSince ? formatOfflineDuration(device.offlineSince, now) : '离线，时长未知'
}

function polar(deg: number) {
  const rad = (deg * Math.PI) / 180
  return `${(50 + LOAD_RING_RADIUS * Math.cos(rad)).toFixed(3)} ${(50 + LOAD_RING_RADIUS * Math.sin(rad)).toFixed(3)}`
}

/** 上半圆从 9 点顺时针经 12 点；下半圆从 9 点逆时针经 6 点。两者都从左侧起步，便于上下对照。 */
function halfArc(half: 'up' | 'down', progress: number) {
  const sweep = HALF_SWEEP * progress
  if (half === 'up') {
    const start = 180 + SPLIT_GAP
    return `M ${polar(start)} A ${LOAD_RING_RADIUS} ${LOAD_RING_RADIUS} 0 0 1 ${polar(start + sweep)}`
  }
  const start = 180 - SPLIT_GAP
  return `M ${polar(start)} A ${LOAD_RING_RADIUS} ${LOAD_RING_RADIUS} 0 0 0 ${polar(start - sweep)}`
}

function TrafficCenter({ reading }: { reading: TrafficReading }) {
  return (
    <>
      <span className="gauge-rate is-up">
        <ArrowUp size={8} strokeWidth={3} />
        {reading.up === undefined ? '—' : formatRate(reading.up)}
      </span>
      <span className="gauge-conn">{reading.conn === undefined ? '—' : formatCount(reading.conn)}</span>
      <span className="gauge-rate is-down">
        <ArrowDown size={8} strokeWidth={3} />
        {reading.down === undefined ? '—' : formatRate(reading.down)}
      </span>
    </>
  )
}

function Gauge({ reading, gaugeStatus, split, ariaLabel }: { reading: GaugeReading; gaugeStatus: GaugeStatus; split: boolean; ariaLabel?: string }) {
  const BadgeIcon = statusBadgeIcon[gaugeStatus]
  const progress = reading.kind === 'value' ? reading.progress : 0
  const style = { '--load-dash': `${LOAD_CIRCUMFERENCE * progress} ${LOAD_CIRCUMFERENCE}` } as CSSProperties
  const upProgress = reading.kind === 'traffic' ? ratio(reading.up, reading.upMax) : 0
  const downProgress = reading.kind === 'traffic' ? ratio(reading.down, reading.downMax) : 0
  const a11y = ariaLabel ? { role: 'img' as const, 'aria-label': ariaLabel } : { 'aria-hidden': true }

  return (
    <div className={`gauge gs-${gaugeStatus} gr-${reading.kind} ${split ? 'is-split' : ''}`} style={style} {...a11y}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="gauge-status-ring" cx="50" cy="50" r={STATUS_RING_RADIUS} />
        <circle className="gauge-face" cx="50" cy="50" r="41" />
        {split ? (
          <>
            <path className="gauge-split-track is-up" d={halfArc('up', 1)} />
            <path className="gauge-split-track is-down" d={halfArc('down', 1)} />
            {upProgress > 0 && <path className="gauge-split is-up" d={halfArc('up', upProgress)} />}
            {downProgress > 0 && <path className="gauge-split is-down" d={halfArc('down', downProgress)} />}
          </>
        ) : (
          <>
            <circle className="gauge-load-track" cx="50" cy="50" r={LOAD_RING_RADIUS} />
            {reading.kind === 'value' && progress > 0 && (
              <circle className="gauge-load" cx="50" cy="50" r={LOAD_RING_RADIUS} transform="rotate(-90 50 50)" />
            )}
          </>
        )}
      </svg>
      <span className="gauge-center" aria-hidden="true">
        {reading.kind === 'traffic' && <TrafficCenter reading={reading} />}
        {reading.kind === 'value' && (
          <>
            <span className="gauge-value">{reading.value}<small>{reading.unit}</small></span>
            {reading.label && <span className="gauge-label">{reading.label}</span>}
          </>
        )}
        {reading.kind === 'online' && (
          <>
            <Monitor size={17} strokeWidth={1.8} />
            <span className="gauge-label">在线</span>
          </>
        )}
        {reading.kind === 'missing' && (
          <>
            <span className="gauge-empty">—</span>
            <span className="gauge-label">{reading.label ? `${reading.label}无数据` : '无数据'}</span>
          </>
        )}
        {reading.kind === 'offline' && (
          <>
            <PowerOff size={17} strokeWidth={1.8} />
            <span className="gauge-label">无读数</span>
          </>
        )}
        {reading.kind === 'unknown' && (
          <>
            <span className="gauge-empty">?</span>
            <span className="gauge-label">未知</span>
          </>
        )}
      </span>
      <span className="gauge-badge" aria-hidden="true">
        <BadgeIcon size={10} strokeWidth={2.8} />
      </span>
    </div>
  )
}

export function describeReading(reading: GaugeReading): string {
  switch (reading.kind) {
    case 'value': return `${reading.label ?? ''} ${reading.value}${reading.unit}`.trim()
    case 'traffic': {
      const rate = (v?: number) => (v === undefined ? '无数据' : `${formatRate(v)}bps`)
      return `上传 ${rate(reading.up)}，下载 ${rate(reading.down)}，连接数 ${reading.conn === undefined ? '无数据' : formatCount(reading.conn)}`
    }
    case 'online': return '在线，无负荷指标'
    case 'missing': return '指标数据缺失'
    case 'offline': return '离线，无当前读数'
    default: return '无当前读数'
  }
}

export function getGaugeStatus(device: MonitorDevice, status: DeviceStatus = getDeviceStatus(device)): GaugeStatus {
  return status === 'error' && !device.reachable ? 'error-offline' : status
}

export function DeviceGauge({ device, ariaLabel }: { device: MonitorDevice; ariaLabel?: string }) {
  const status = getDeviceStatus(device)
  return <Gauge reading={getReading(device, status)} gaugeStatus={getGaugeStatus(device, status)} split={device.metricKind === 'traffic'} ariaLabel={ariaLabel} />
}

export function DeviceUnit({ device, now, onOpen }: { device: MonitorDevice; now: number; onOpen?: (device: MonitorDevice) => void }) {
  const status = getDeviceStatus(device)
  const meta = statusMeta[status]
  const reading = getReading(device, status)
  const statusText = getStatusText(device, status, now)
  const summary = `${device.name}，${meta.label}，${describeReading(reading)}`
  const gauge = (
    <Gauge reading={reading} gaugeStatus={getGaugeStatus(device, status)} split={device.metricKind === 'traffic'} ariaLabel={onOpen ? undefined : summary} />
  )

  if (onOpen) {
    return (
      <button
        type="button"
        className={`device-unit is-clickable ${meta.tone}`}
        title={`${device.name} · ${meta.label} · ${statusText} · 点击查看历史`}
        aria-label={`${summary}，${statusText}。查看历史数据`}
        aria-haspopup="dialog"
        onClick={() => onOpen(device)}
      >
        <span className="device-name">{device.name}</span>
        {gauge}
        <span className="device-status">{statusText}</span>
      </button>
    )
  }

  return (
    <div className={`device-unit ${meta.tone}`} title={`${device.name} · ${meta.label} · ${statusText}`}>
      <span className="device-name">{device.name}</span>
      {gauge}
      <span className="device-status">{statusText}</span>
    </div>
  )
}
