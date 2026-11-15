import type { CSSProperties } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  HelpCircle,
  Minus,
  Monitor,
  PowerOff,
  type LucideIcon,
} from 'lucide-react'
import {
  formatOfflineDuration,
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

export type GaugeReading =
  | { kind: 'value'; value: string; unit: string; label?: string; progress: number }
  | { kind: 'online' }
  | { kind: 'missing'; label?: string }
  | { kind: 'offline' }
  | { kind: 'unknown' }

export function getReading(device: MonitorDevice, status: DeviceStatus = getDeviceStatus(device)): GaugeReading {
  if (status === 'unknown') return { kind: 'unknown' }
  if (!device.reachable) return { kind: 'offline' }
  if (!device.metricKind || device.metricKind === 'none') return { kind: 'online' }
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
  const offlineText = device.offlineSince !== undefined ? formatOfflineDuration(device.offlineSince, now) : '离线，时长未知'
  if (device.hasFault && device.faultAvailable !== false) {
    const faultText = device.faultMessage ?? '检测到故障'
    return device.reachable ? faultText : `${faultText} · ${offlineText}`
  }
  return offlineText
}

function Gauge({ reading, gaugeStatus, ariaLabel }: { reading: GaugeReading; gaugeStatus: GaugeStatus; ariaLabel: string }) {
  const BadgeIcon = statusBadgeIcon[gaugeStatus]
  const progress = reading.kind === 'value' ? reading.progress : 0
  const style = { '--load-dash': `${LOAD_CIRCUMFERENCE * progress} ${LOAD_CIRCUMFERENCE}` } as CSSProperties

  return (
    <div className={`gauge gs-${gaugeStatus} gr-${reading.kind}`} style={style} role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="gauge-status-ring" cx="50" cy="50" r={STATUS_RING_RADIUS} />
        <circle className="gauge-face" cx="50" cy="50" r="41" />
        <circle className="gauge-load-track" cx="50" cy="50" r={LOAD_RING_RADIUS} />
        {reading.kind === 'value' && progress > 0 && (
          <circle className="gauge-load" cx="50" cy="50" r={LOAD_RING_RADIUS} transform="rotate(-90 50 50)" />
        )}
      </svg>
      <span className="gauge-center" aria-hidden="true">
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
    case 'online': return '在线，无负荷指标'
    case 'missing': return '指标数据缺失'
    case 'offline': return '离线，无当前读数'
    default: return '无当前读数'
  }
}

export function DeviceUnit({ device, now }: { device: MonitorDevice; now: number }) {
  const status = getDeviceStatus(device)
  const meta = statusMeta[status]
  const reading = getReading(device, status)
  const statusText = getStatusText(device, status, now)
  const gaugeStatus: GaugeStatus = status === 'error' && !device.reachable ? 'error-offline' : status

  return (
    <div className={`device-unit ${meta.tone}`} title={`${device.name} · ${meta.label} · ${statusText}`}>
      <span className="device-name">{device.name}</span>
      <Gauge reading={reading} gaugeStatus={gaugeStatus} ariaLabel={`${device.name}，${meta.label}，${describeReading(reading)}`} />
      <span className="device-status">{statusText}</span>
    </div>
  )
}
