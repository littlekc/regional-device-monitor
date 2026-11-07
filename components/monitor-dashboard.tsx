'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Expand,
  HelpCircle,
  Monitor,
  PowerOff,
  Shrink,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import {
  createDemoDevices,
  formatOfflineDuration,
  getDeviceStatus,
  regions,
  sortDevices,
  withDemoMetric,
  type DeviceStatus,
  type DeviceType,
  type MonitorDevice,
} from '@/lib/monitor-data'

const STORAGE_KEY = 'region-monitor-demo-data'

const statusMeta: Record<DeviceStatus, { label: string; tone: string; icon: LucideIcon }> = {
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

const GAUGE_RADIUS = 41
const CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS
const ARC_SWEEP = 270
const ARC_LENGTH = (CIRCUMFERENCE * ARC_SWEEP) / 360
const ARC_START = 90 + (360 - ARC_SWEEP) / 2

const LEVEL_STOPS = [
  { at: 0, h: 152, s: 62, l: 50 },
  { at: 0.5, h: 46, s: 92, l: 56 },
  { at: 1, h: 356, s: 84, l: 60 },
]

function levelColor(progress: number): string {
  const p = Math.min(1, Math.max(0, progress))
  const upper = p <= LEVEL_STOPS[1].at ? 1 : 2
  const from = LEVEL_STOPS[upper - 1]
  const to = LEVEL_STOPS[upper]
  const t = (p - from.at) / (to.at - from.at)
  const toHue = to.h > from.h ? to.h - 360 : to.h
  const hue = (from.h + (toHue - from.h) * t + 360) % 360
  const mix = (a: number, b: number) => a + (b - a) * t
  return `hsl(${hue.toFixed(1)} ${mix(from.s, to.s).toFixed(1)}% ${mix(from.l, to.l).toFixed(1)}%)`
}

function arcPoint(progress: number) {
  const angle = ((ARC_START + ARC_SWEEP * progress) * Math.PI) / 180
  return { x: 50 + GAUGE_RADIUS * Math.cos(angle), y: 50 + GAUGE_RADIUS * Math.sin(angle) }
}

function RoundIcon({ icon: Icon, tone, size = 'md' }: { icon: LucideIcon; tone: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`round-icon round-${size} ${tone}`} aria-hidden="true">
      <Icon size={size === 'md' ? 16 : 12} strokeWidth={1.9} />
    </span>
  )
}

type GaugeReading =
  | { kind: 'value'; value: string; unit: string; label?: string; progress: number }
  | { kind: 'online' }
  | { kind: 'empty'; symbol: string }

function getReading(device: MonitorDevice, status: DeviceStatus): GaugeReading {
  if (status === 'unknown') return { kind: 'empty', symbol: '?' }
  if (!device.reachable) return { kind: 'empty', symbol: '—' }
  if (!device.metricKind || device.metricKind === 'none' || device.metricValue === undefined) return { kind: 'online' }
  const max = device.metricKind === 'percent' ? 100 : device.metricMax ?? 100
  const progress = Math.min(1, Math.max(0, device.metricValue / max))
  const value = device.metricKind === 'power' ? device.metricValue.toFixed(1) : String(Math.round(device.metricValue))
  return { kind: 'value', value, unit: device.metricUnit ?? '', label: device.metricLabel, progress }
}

function getStatusText(device: MonitorDevice, status: DeviceStatus, now: number): string {
  if (status === 'unknown') return '状态未知'
  if (status === 'normal') return normalText[device.type]
  if (device.reachable && device.hasFault) return device.faultMessage ?? '检测到故障'
  return device.offlineSince ? formatOfflineDuration(device.offlineSince, now) : '状态未知'
}

function Gauge({ reading, tone, alert, ariaLabel }: { reading: GaugeReading; tone: string; alert: boolean; ariaLabel: string }) {
  const hasLevel = reading.kind === 'value'
  const level = hasLevel ? levelColor(reading.progress) : undefined
  const cap = hasLevel ? arcPoint(reading.progress) : undefined
  const style = level ? ({ '--level': level } as CSSProperties) : undefined

  return (
    <div className={`gauge ${tone} ${hasLevel ? 'has-level' : 'is-idle'}`} style={style} role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="gauge-face" cx="50" cy="50" r="34.5" />
        <circle
          className="gauge-track"
          cx="50"
          cy="50"
          r={GAUGE_RADIUS}
          strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
          transform={`rotate(${ARC_START} 50 50)`}
        />
        {hasLevel && reading.progress > 0 && (
          <circle
            className="gauge-progress"
            cx="50"
            cy="50"
            r={GAUGE_RADIUS}
            strokeDasharray={`${ARC_LENGTH * reading.progress} ${CIRCUMFERENCE}`}
            transform={`rotate(${ARC_START} 50 50)`}
          />
        )}
        {cap && <circle className="gauge-cap" cx={cap.x} cy={cap.y} r="4.2" />}
      </svg>
      {alert && (
        <span className="gauge-alert" aria-hidden="true">
          <AlertTriangle size={9} strokeWidth={2.6} />
        </span>
      )}
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
        {reading.kind === 'empty' && <span className="gauge-empty">{reading.symbol}</span>}
      </span>
    </div>
  )
}

function DeviceUnit({ device, now }: { device: MonitorDevice; now: number }) {
  const status = getDeviceStatus(device)
  const meta = statusMeta[status]
  const reading = getReading(device, status)
  const statusText = getStatusText(device, status, now)
  const readingText = reading.kind === 'value' ? `${reading.label ?? ''} ${reading.value}${reading.unit}` : reading.kind === 'online' ? '在线' : '无当前数值'

  return (
    <div className={`device-unit ${meta.tone}`} title={`${device.name} · ${meta.label} · ${statusText}`}>
      <span className="device-name">{device.name}</span>
      <Gauge reading={reading} tone={meta.tone} alert={status === 'error'} ariaLabel={`${device.name}，${meta.label}，${readingText}`} />
      <span className="device-status">{statusText}</span>
    </div>
  )
}

function countStatuses(devices: MonitorDevice[]) {
  return devices.reduce<Record<DeviceStatus, number>>((acc, device) => {
    acc[getDeviceStatus(device)] += 1
    return acc
  }, { normal: 0, error: 0, offline: 0, unknown: 0 })
}

function RegionPanel({ regionId, devices, now }: { regionId: string; devices: MonitorDevice[]; now: number }) {
  const ordered = useMemo(() => sortDevices(devices), [devices])
  const counts = useMemo(() => countStatuses(devices), [devices])
  const hasAlert = counts.error > 0
  const hasUnknown = counts.unknown > 0
  const region = regions.find((item) => item.id === regionId)!
  const regionState = hasAlert
    ? { text: '需要处理', tone: 'tone-error', icon: AlertTriangle }
    : hasUnknown
      ? { text: '存在未知', tone: 'tone-unknown', icon: HelpCircle }
      : { text: '运行正常', tone: 'tone-normal', icon: CheckCircle2 }

  return (
    <section className={`region-panel ${hasAlert ? 'has-alert' : ''} ${hasUnknown ? 'has-unknown' : ''}`} aria-label={region.name}>
      <header className="region-header">
        <span className="region-badge" aria-hidden="true">{region.name.charAt(0)}</span>
        <h2>{region.name}</h2>
        <div className="region-metrics">
          <span className="metric"><b>{devices.length}</b>对象</span>
          <span className={`metric tone-normal ${counts.normal ? 'is-active' : ''}`}><i /><b>{counts.normal}</b>正常</span>
          <span className={`metric tone-error ${counts.error ? 'is-active' : ''}`}><i /><b>{counts.error}</b>异常</span>
          <span className={`metric tone-offline ${counts.offline ? 'is-active' : ''}`}><i /><b>{counts.offline}</b>离线</span>
          {counts.unknown > 0 && <span className="metric tone-unknown is-active"><i /><b>{counts.unknown}</b>未知</span>}
        </div>
        <div className={`region-state ${regionState.tone}`}>
          <RoundIcon icon={regionState.icon} tone={regionState.tone} size="sm" />
          {regionState.text}
        </div>
      </header>
      <div className="device-grid">
        {ordered.map((device) => <DeviceUnit key={device.id} device={device} now={now} />)}
      </div>
    </section>
  )
}

function loadDevices(): MonitorDevice[] {
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const migrated = (parsed as MonitorDevice[]).map(withDemoMetric)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
        return migrated
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }
  const initial = createDemoDevices()
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
  return initial
}

export default function MonitorDashboard() {
  const [now, setNow] = useState(() => Date.now())
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [devices, setDevices] = useState<MonitorDevice[]>([])

  useEffect(() => {
    setDevices(loadDevices())
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  const summary = useMemo(() => countStatuses(devices), [devices])
  const devicesByRegion = useMemo(
    () => Object.fromEntries(regions.map((region) => [region.id, devices.filter((device) => device.regionId === region.id)])),
    [devices],
  )

  const date = new Date(now)
  const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const timeText = date.toLocaleTimeString('zh-CN', { hour12: false })
  const total = devices.length

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
    else document.exitFullscreen?.()
  }

  const stats = [
    { key: 'total', label: '监控对象', value: total, tone: 'tone-brand', icon: Activity },
    { key: 'normal', label: '正常', value: summary.normal, tone: 'tone-normal', icon: CheckCircle2 },
    { key: 'error', label: '异常', value: summary.error, tone: 'tone-error', icon: AlertTriangle },
    { key: 'offline', label: '无影响离线', value: summary.offline, tone: 'tone-offline', icon: PowerOff },
    { key: 'unknown', label: '状态未知', value: summary.unknown, tone: 'tone-unknown', icon: HelpCircle },
  ]

  return (
    <main className="monitor-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <RoundIcon icon={Wifi} tone="tone-brand" />
          <h1>区域设备状态监控中心</h1>
        </div>
        <div className="topbar-actions">
          <div className="clock"><span suppressHydrationWarning>{dateText}</span><strong suppressHydrationWarning>{timeText}</strong></div>
          <span className="demo-badge"><i />演示数据</span>
          <button type="button" className="fullscreen-button" onClick={toggleFullscreen} aria-label={isFullscreen ? '退出全屏' : '全屏显示'}>
            <span className="button-icon">{isFullscreen ? <Shrink size={13} /> : <Expand size={13} />}</span>
            {isFullscreen ? '退出全屏' : '全屏显示'}
          </button>
        </div>
      </header>

      <section className="summary-bar" aria-label="全局状态摘要">
        {stats.map((stat) => (
          <div key={stat.key} className={`summary-stat ${stat.tone}`}>
            <RoundIcon icon={stat.icon} tone={stat.tone} size="sm" />
            <span className="summary-label">{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
        <div className="distribution" role="img" aria-label={`正常 ${summary.normal}，异常 ${summary.error}，无影响离线 ${summary.offline}，状态未知 ${summary.unknown}`}>
          {(['normal', 'error', 'offline', 'unknown'] as const).map((key) => (
            <span key={key} className={statusMeta[key].tone} style={{ flexGrow: summary[key] }} />
          ))}
        </div>
      </section>

      <div className="zones-grid">
        {regions.map((region) => <RegionPanel key={region.id} regionId={region.id} devices={devicesByRegion[region.id] ?? []} now={now} />)}
      </div>
    </main>
  )
}
