import { useId, type CSSProperties } from 'react'
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
  connectionsLabel,
  formatOfflineDuration,
  formatRate,
  formatGaugeRate,
  formatSampleTime,
  getDeviceStatus,
  type DeviceStatus,
  statusReasonText,
} from '@/lib/monitor-data'
import type { ConnectionsScope, DeviceType, PaletteId, SnapshotDevice } from '@/lib/contracts'
import { rateMultiplier } from '@/lib/traffic-catalog'

export const statusMeta: Record<DeviceStatus, { label: string; tone: string; icon: LucideIcon }> = {
  normal: { label: '正常', tone: 'tone-normal', icon: CheckCircle2 },
  error: { label: '异常', tone: 'tone-error', icon: AlertTriangle },
  offline: { label: '无影响离线', tone: 'tone-offline', icon: PowerOff },
  unknown: { label: '状态未知', tone: 'tone-unknown', icon: HelpCircle },
}

const normalText: Record<DeviceType, string> = {
  server: '运行正常',
  router: '运行正常',
  line: '链路正常',
  power: '供电正常',
  battery: '设备在线',
  terminal: '设备在线',
}

const STATUS_RING_RADIUS = 46
const LOAD_RING_RADIUS = 37
const LOAD_CIRCUMFERENCE = 2 * Math.PI * LOAD_RING_RADIUS
const gaugeColors = { green: '#56c991', yellow: '#f5cf49', red: '#f46059' }

export const palettes: { id: PaletteId; name: string; note: string; swatches: string[] }[] = [
  { id: 'harbor', name: '港湾蓝', note: '默认 · 冷色负荷，暖色告警', swatches: ['#5cc8ec', '#56c9a0', '#ff5b69', '#f2b24a'] },
  { id: 'titanium', name: '钛白橙', note: '高对比负荷与强调色', swatches: ['#e6eef6', '#62d2a5', '#ff5e6d', '#f3c361'] },
  { id: 'jade', name: '玉青', note: '柔和 · 长时间值守', swatches: ['#42d6c2', '#7fcf9e', '#ff6576', '#ffd166'] },
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
  | { kind: 'value'; value: string; unit: string; label?: string; progress: number; latencyMs?: number; batteryPercent?: number }
  | TrafficReading
  | ResourceReading
  | { kind: 'online' }
  | { kind: 'missing'; label?: string }
  | { kind: 'offline' }
  | { kind: 'unknown' }

type TrafficRate = { value?: string; unit?: string; progress?: number; hasScale?: boolean }
type TrafficReading = { kind: 'traffic'; upload: TrafficRate; download: TrafficRate; connections?: number; scope?: ConnectionsScope }

type ResourcePercent = { value: string; progress?: number }
type ResourceReading = { kind: 'resources'; cpu: ResourcePercent; memory: ResourcePercent }
type SplitReading = TrafficReading | ResourceReading

function resourcePercent(value?: number): ResourcePercent {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 100) return { value: '—' }
  return { value: `${value.toFixed(1)}%`, progress: value / 100 }
}

function splitReading(reading: GaugeReading, metricKind: SnapshotDevice['metricKind'], scope?: ConnectionsScope): SplitReading | undefined {
  if (reading.kind === 'traffic' || reading.kind === 'resources') return reading
  if (metricKind === 'traffic') return { kind: 'traffic', scope, upload: {}, download: {} }
  if (metricKind === 'resources') return { kind: 'resources', cpu: resourcePercent(), memory: resourcePercent() }
}

function trafficRate(bps?: number, max?: number): TrafficRate {
  const hasScale = max !== undefined && Number.isFinite(max) && max > 0
  const scale = hasScale ? { hasScale } : {}
  if (bps === undefined || !Number.isFinite(bps) || bps < 0) return scale
  return { value: formatGaugeRate(bps), unit: 'Mbps', ...scale, progress: max !== undefined && hasScale ? Math.min(1, bps / max) : undefined }
}

export function getReading(device: SnapshotDevice, status: DeviceStatus = getDeviceStatus(device)): GaugeReading {
  if (status === 'unknown') return { kind: 'unknown' }
  if (!device.reachable && device.statusReason !== 'link_check_failed') return { kind: 'offline' }
  if (!device.metricKind || device.metricKind === 'none') return { kind: 'online' }
  if (device.metricKind === 'resources') {
    return { kind: 'resources', cpu: resourcePercent(device.cpuValue), memory: resourcePercent(device.memoryValue) }
  }
  if (device.metricKind === 'traffic') {
    const scope = device.connectionsScope
    const count = device.connections
    return {
      kind: 'traffic', scope,
      upload: trafficRate(device.uploadValue, device.uploadMax),
      download: trafficRate(device.downloadValue, device.downloadMax),
      connections: scope && count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count : undefined,
    }
  }
  if (device.metricValue === undefined || device.metricValue === null || !Number.isFinite(device.metricValue)) {
    return { kind: 'missing', label: device.metricLabel }
  }
  const max = device.metricKind === 'percent' ? 100 : device.metricMax
  const progress = max && max > 0 ? Math.min(1, Math.max(0, device.metricValue / max)) : 0
  const unit = device.metricKind === 'percent' ? '%' : device.metricUnit ?? ''
  const amount = device.metricValue
  if (device.type === 'battery' && device.metricKind === 'percent') {
    if (amount < 0 || amount > 100) return { kind: 'missing', label: device.metricLabel }
    return { kind: 'value', value: String(Number(amount.toFixed(1))), unit, label: device.metricLabel, progress, batteryPercent: amount }
  }
  if (device.metricKind === 'raw' && unit === 'ms') return { kind: 'value', value: String(Math.round(amount)), unit, label: device.metricLabel, progress, latencyMs: amount }
  if (device.metricKind === 'rate') {
    const multiplier = rateMultiplier(unit)
    if (multiplier === undefined) return { kind: 'missing', label: device.metricLabel }
    return { kind: 'value', value: formatGaugeRate(amount * multiplier), unit: 'Mbps', label: device.metricLabel, progress }
  }
  const value = device.metricKind === 'power'
    ? amount.toFixed(1)
    : device.metricKind === 'percent' ? (['CPU', '内存'].includes(device.metricLabel ?? '') ? amount.toFixed(1) : String(Number(amount.toFixed(1)))) : String(Number(amount.toPrecision(4)))
  return { kind: 'value', value, unit, label: device.metricLabel, progress }
}

export function getStatusText(device: SnapshotDevice, status: DeviceStatus, now: number): string {
  if (status === 'unknown') return `状态未知 · ${statusReasonText[device.statusReason]}`
  if (device.statusReason === 'link_check_failed') return '链路检测失败'
  if (status === 'normal' && device.onlineAddress) return device.onlineAddress
  if (status === 'normal') return device.type === 'line' && device.metricKind === 'traffic'
    ? device.wanIps?.join(' / ') || 'IP 未获取' : normalText[device.type]
  const offlineText = device.offlineSince !== undefined ? formatOfflineDuration(device.offlineSince, now) : '离线，时长未知'
  if (device.hasFault && device.faultAvailable !== false) {
    const faultText = device.faultMessage ?? '检测到故障'
    return device.reachable ? faultText : `${faultText} · ${offlineText}`
  }
  return offlineText
}

function halfArc(half: 'up' | 'down', progress: number) {
  const direction = half === 'up' ? 1 : -1
  const polar = (deg: number) => {
    const radians = deg * Math.PI / 180
    return `${(50 + LOAD_RING_RADIUS * Math.cos(radians)).toFixed(3)} ${(50 + LOAD_RING_RADIUS * Math.sin(radians)).toFixed(3)}`
  }
  const start = 180 + direction * 7
  return `M ${polar(start)} A ${LOAD_RING_RADIUS} ${LOAD_RING_RADIUS} 0 0 ${half === 'up' ? 1 : 0} ${polar(start + direction * 166 * progress)}`
}

const compactCount = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumSignificantDigits: 3 })

function severityColor(level: number): string {
  if (level <= 0) return gaugeColors.green
  if (level >= 1) return gaugeColors.red
  const lowerHalf = level <= 0.5
  const from = lowerHalf ? gaugeColors.green : gaugeColors.yellow
  const to = lowerHalf ? gaugeColors.yellow : gaugeColors.red
  const percent = (level - (lowerHalf ? 0 : 0.5)) * 200
  return `color-mix(in srgb, ${from}, ${to} ${percent}%)`
}

const LATENCY_TICKS = Array.from({ length: 24 }, (_, index) => index * 15)

function Gauge({ reading, gaugeStatus, ariaLabel, split }: { reading: GaugeReading; gaugeStatus: GaugeStatus; ariaLabel: string; split?: SplitReading }) {
  const gradientId = useId()
  const BadgeIcon = statusBadgeIcon[gaugeStatus]
  const progress = reading.kind === 'value' ? reading.progress : 0
  const latency = reading.kind === 'value' ? reading.latencyMs : undefined
  const battery = reading.kind === 'value' ? reading.batteryPercent : undefined
  const level = battery !== undefined ? (80 - battery) / 60 : latency !== undefined ? (latency - 100) / 400 : undefined
  const style = {
    '--load-dash': `${LOAD_CIRCUMFERENCE * progress} ${LOAD_CIRCUMFERENCE}`,
    ...(level === undefined ? {} : { '--reading-color': severityColor(level) }),
  } as CSSProperties
  const traffic = split?.kind === 'traffic' ? split : undefined
  const resources = split?.kind === 'resources' ? split : undefined
  const halves = resources
    ? { up: { hasScale: true, progress: resources.cpu.progress }, down: { hasScale: true, progress: resources.memory.progress } }
    : traffic ? { up: traffic.upload, down: traffic.download } : undefined

  return (
    <span className={`gauge gs-${gaugeStatus} gr-${reading.kind}${battery !== undefined ? ' is-battery' : latency !== undefined ? ' is-latency' : ''}`} style={style} role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
            <stop stopColor={gaugeColors.green} /><stop offset=".5" stopColor={gaugeColors.yellow} /><stop offset="1" stopColor={gaugeColors.red} />
          </linearGradient>
          {reading.kind === 'value' && (
            <>
              <linearGradient id={gradientId + '-first'} gradientUnits="userSpaceOnUse" x1="50" y1="13" x2="50" y2="87">
                <stop stopColor={gaugeColors.green} /><stop offset="1" stopColor={gaugeColors.yellow} />
              </linearGradient>
              <linearGradient id={gradientId + '-second'} gradientUnits="userSpaceOnUse" x1="50" y1="87" x2="50" y2="13">
                <stop stopColor={gaugeColors.yellow} /><stop offset="1" stopColor={gaugeColors.red} />
              </linearGradient>
              <mask id={gradientId + '-progress'} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
                <circle className="gauge-load" cx="50" cy="50" r={LOAD_RING_RADIUS} transform="rotate(-90 50 50)" />
              </mask>
            </>
          )}
        </defs>
        <circle className="gauge-status-ring" cx="50" cy="50" r={STATUS_RING_RADIUS} />
        <circle className="gauge-face" cx="50" cy="50" r="41" />
        {halves ? (
          (['up', 'down'] as const).map((half) => {
            const { hasScale, progress } = halves[half]
            return (
              <g key={half}>
                {hasScale && <path className={`gauge-split-track is-${half}`} d={halfArc(half, 1)} />}
                {progress !== undefined && <path className={`gauge-split is-${half}`} d={halfArc(half, 1)}
                  pathLength="1" style={{ stroke: `url(#${gradientId})`, strokeDasharray: `${progress} 1` }} />}
              </g>
            )
          })
        ) : latency !== undefined ? (
          <g className="latency-ticks">
            {LATENCY_TICKS.map((angle, index) => (
              <line key={angle} className={index < Math.max(1, Math.ceil(progress * LATENCY_TICKS.length)) ? 'is-lit' : undefined}
                x1="50" y1="11" x2="50" y2="17.5" transform={`rotate(${angle} 50 50)`} />
            ))}
            <circle className="latency-core" cx="50" cy="50" r="29" />
          </g>
        ) : (
          <>
            <circle className="gauge-load-track" cx="50" cy="50" r={LOAD_RING_RADIUS} />
            {reading.kind === 'value' && (
              <g className="gauge-progress" mask={`url(#${gradientId}-progress)`} fill="none" strokeWidth="4.5">
                <path d="M50 13 A37 37 0 0 1 50 87" stroke={`url(#${gradientId}-first)`} />
                <path d="M50 87 A37 37 0 0 1 50 13" stroke={`url(#${gradientId}-second)`} />
              </g>
            )}
          </>
        )}
      </svg>
      <span className="gauge-center" aria-hidden="true">
        {reading.kind === 'value' && (
          <>
            <span className="gauge-value">{reading.value}{reading.unit !== 'Mbps' && <small>{reading.unit}</small>}</span>
          </>
        )}
        {traffic && (
          <>
            <span className="gauge-rate is-up"><span className="gauge-arrow">↑</span>{traffic.upload.value ?? '—'}</span>
            <span className="gauge-conn">{traffic.connections === undefined ? '—' : traffic.connections < 10_000 ? traffic.connections : compactCount.format(traffic.connections)}</span>
            <span className="gauge-rate is-down"><span className="gauge-arrow">↓</span>{traffic.download.value ?? '—'}</span>
          </>
        )}
        {resources && (
          <>
            <span className={`gauge-resource is-up${resources.cpu.progress === undefined ? ' is-missing' : ''}`}>{resources.cpu.value}</span>
            <span className={`gauge-resource is-down${resources.memory.progress === undefined ? ' is-missing' : ''}`}>{resources.memory.value}</span>
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
            <span className="gauge-label">无数据</span>
          </>
        )}
        {!split && reading.kind === 'offline' && (
          <>
            <PowerOff size={17} strokeWidth={1.8} />
            <span className="gauge-label">无读数</span>
          </>
        )}
        {!split && reading.kind === 'unknown' && (
          <>
            <span className="gauge-empty">—</span>
            <span className="gauge-label">未知</span>
          </>
        )}
      </span>
      <span className="gauge-badge" aria-hidden="true">
        <BadgeIcon size={10} strokeWidth={2.8} />
      </span>
    </span>
  )
}

export function describeReading(reading: GaugeReading): string {
  switch (reading.kind) {
    case 'value': return `${reading.label ?? ''} ${reading.value}${reading.unit}`.trim()
    case 'resources': {
      const percent = ({ value, progress }: ResourcePercent) => progress === undefined ? '无读数' : value
      return `CPU ${percent(reading.cpu)}，内存 ${percent(reading.memory)}`
    }
    case 'traffic': {
      const rate = ({ value, unit }: TrafficRate) => value === undefined ? '无读数' : `${value} ${unit}`
      return `上传 ${rate(reading.upload)}，${connectionsLabel(reading.scope)} ${reading.connections === undefined ? '无读数' : `${reading.connections} 个`}，下载 ${rate(reading.download)}`
    }
    case 'online': return '在线，无负荷指标'
    case 'missing': return '指标数据缺失'
    case 'offline': return '离线，无当前读数'
    default: return '无当前读数'
  }
}

export function DeviceUnit({ device, now, onHistory }: { device: SnapshotDevice; now: number; onHistory?: () => void }) {
  const status = getDeviceStatus(device)
  const meta = statusMeta[status]
  const reading = getReading(device, status)
  const statusText = getStatusText(device, status, now)
  let caption = statusText
  if (status === 'unknown') caption = statusReasonText[device.statusReason]
  else if (device.statusReason === 'link_check_failed') caption = status === 'offline' ? '链路未通' : '链路异常'
  else if (status === 'error' && device.hasFault && device.reachable) {
    const message = device.faultMessage ?? ''
    caption = /space is (?:critically )?low/i.test(message) ? '磁盘空间不足' : message.length > 12 || !message ? '设备故障' : message
  }
  const clockLabel = device.clockBasis === 'received' ? ' API 接收' : '采样'
  const evidence = [
    device.liveSource === 'ikuai' ? '实时来源：爱快 API；时间为服务端接收时间' : undefined,
    device.uploadValue === undefined ? undefined : `上传实际 ${formatRate(device.uploadValue).value} Mbps`,
    device.downloadValue === undefined ? undefined : `下载实际 ${formatRate(device.downloadValue).value} Mbps`,
    device.statusClock === undefined ? undefined : `状态${clockLabel} ${formatSampleTime(device.statusClock)}`,
    device.valueClock === undefined ? undefined : `数值${clockLabel} ${formatSampleTime(device.valueClock)}`,
    device.cpuClock === undefined ? undefined : `CPU ${clockLabel} ${formatSampleTime(device.cpuClock)}`,
    device.memoryClock === undefined ? undefined : `内存${clockLabel} ${formatSampleTime(device.memoryClock)}`,
    device.uploadClock === undefined ? undefined : `上传${clockLabel} ${formatSampleTime(device.uploadClock)}`,
    device.downloadClock === undefined ? undefined : `下载${clockLabel} ${formatSampleTime(device.downloadClock)}`,
    device.connectionsClock === undefined ? undefined : `${connectionsLabel(device.connectionsScope)}${clockLabel} ${formatSampleTime(device.connectionsClock)}`,
    device.wanIpClock === undefined ? undefined : `WAN IP ${clockLabel} ${formatSampleTime(device.wanIpClock)}`,
    status === 'error' && device.alarmSince !== undefined ? `告警开始 ${formatSampleTime(device.alarmSince)}` : undefined,
    status !== 'unknown' && !device.reachable && device.offlineSince !== undefined ? `离线开始 ${formatSampleTime(device.offlineSince)}` : undefined,
  ].filter(Boolean)
  const gaugeStatus: GaugeStatus = status === 'error' && !device.reachable && device.statusReason !== 'link_check_failed' ? 'error-offline' : status
  const split = splitReading(reading, device.metricKind, device.connectionsScope)
  const description = [device.name, statusText, describeReading(split ?? reading), ...evidence]
  const className = `device-unit ${meta.tone}`
  const contents = (
    <>
      <span className="device-name">{device.name}</span>
      <Gauge reading={reading} gaugeStatus={gaugeStatus} ariaLabel={description.join('，')} split={split} />
      <span className="device-status">{caption}</span>
    </>
  )
  return onHistory
    ? <button type="button" className={`${className} device-history-trigger`} title={[...description, '查看历史'].join(' · ')} aria-label={[...description, '查看历史'].join('，')} aria-haspopup="dialog" onClick={onHistory}>{contents}</button>
    : <div className={className} title={description.join(' · ')}>{contents}</div>
}
