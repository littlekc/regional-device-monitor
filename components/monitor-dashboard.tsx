'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Expand,
  HelpCircle,
  Minus,
  Monitor,
  Palette,
  X,
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

const STATUS_RING_RADIUS = 46
const LOAD_RING_RADIUS = 37
const LOAD_CIRCUMFERENCE = 2 * Math.PI * LOAD_RING_RADIUS
const PALETTE_KEY = 'region-monitor-gauge-palette'

export const palettes = [
  { id: 'harbor', name: '港湾蓝', note: '默认 · 冷色负荷，暖色告警', swatches: ['#5cc8ec', '#56c9a0', '#ff5b69', '#f2b24a'] },
  { id: 'titanium', name: '钛白橙', note: '高对比 · 色觉差异友好', swatches: ['#e6eef6', '#9db2c4', '#ff8a2b', '#59a8ff'] },
  { id: 'jade', name: '玉青', note: '柔和 · 长时间值守', swatches: ['#42d6c2', '#7fcf9e', '#ff4d8d', '#ffd166'] },
] as const

export type PaletteId = (typeof palettes)[number]['id']

const statusBadgeIcon: Record<GaugeStatus, LucideIcon> = {
  normal: Check,
  error: AlertTriangle,
  'error-offline': PowerOff,
  offline: Minus,
  unknown: HelpCircle,
}

type GaugeStatus = DeviceStatus | 'error-offline'

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
  | { kind: 'missing'; label?: string }
  | { kind: 'offline' }
  | { kind: 'unknown' }

function getReading(device: MonitorDevice, status: DeviceStatus): GaugeReading {
  if (status === 'unknown') return { kind: 'unknown' }
  if (!device.reachable) return { kind: 'offline' }
  if (!device.metricKind || device.metricKind === 'none') return { kind: 'online' }
  if (device.metricValue === undefined || !Number.isFinite(device.metricValue)) return { kind: 'missing', label: device.metricLabel }
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
            <span className="gauge-empty">--</span>
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

function describeReading(reading: GaugeReading): string {
  switch (reading.kind) {
    case 'value': return `${reading.label ?? ''} ${reading.value}${reading.unit}`
    case 'online': return '在线，无负荷指标'
    case 'missing': return '指标数据缺失'
    case 'offline': return '离线，无当前读数'
    default: return '无当前读数'
  }
}

function DeviceUnit({ device, now }: { device: MonitorDevice; now: number }) {
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

function GaugeLegend({ palette, onPaletteChange }: { palette: PaletteId; onPaletteChange: (id: PaletteId) => void }) {
  const [sampleNow] = useState(() => Date.now())
  const base = { regionId: 'sample', reachable: true, hasFault: false, allowOffline: false }
  const percent = { metricKind: 'percent' as const, metricLabel: 'CPU', metricUnit: '%', metricMax: 100 }
  const samples: { caption: string; device: MonitorDevice }[] = [
    { caption: '低值 · 正常', device: { ...base, ...percent, id: 's1', name: '样例-低值', type: 'server', metricValue: 1 } },
    { caption: '满负荷 · 正常', device: { ...base, ...percent, id: 's2', name: '样例-满载', type: 'server', metricValue: 100 } },
    { caption: '功率 200/200W', device: { ...base, id: 's3', name: '样例-功率', type: 'power', metricKind: 'power', metricLabel: '功率', metricUnit: 'W', metricMax: 200, metricValue: 200 } },
    { caption: '在线 · 无指标', device: { ...base, id: 's4', name: '样例-终端', type: 'terminal', metricKind: 'none' } },
    { caption: '在线 · 数据缺失', device: { ...base, ...percent, id: 's5', name: '样例-缺数', type: 'server' } },
    { caption: '在线故障', device: { ...base, id: 's6', name: '样例-故障', type: 'power', metricKind: 'power', metricLabel: '功率', metricUnit: 'W', metricMax: 200, metricValue: 42.5, hasFault: true, faultMessage: '供电异常' } },
    { caption: '需在线却离线', device: { ...base, ...percent, id: 's7', name: '样例-告警离线', type: 'line', metricLabel: '带宽', reachable: false, offlineSince: sampleNow - 25 * 60_000 } },
    { caption: '允许离线', device: { ...base, id: 's8', name: '样例-允许离线', type: 'terminal', metricKind: 'none', reachable: false, allowOffline: true, offlineSince: sampleNow - 3 * 60 * 60_000 } },
    { caption: '状态未知', device: { ...base, id: 's9', name: '样例-未知', type: 'terminal', metricKind: 'none', reachable: false } },
  ]

  return (
    <div className="legend-body">
      <fieldset className="palette-picker">
        <legend>配色方案</legend>
        {palettes.map((item) => (
          <label key={item.id} className={`palette-option ${palette === item.id ? 'is-selected' : ''}`}>
            <input type="radio" name="gauge-palette" value={item.id} checked={palette === item.id} onChange={() => onPaletteChange(item.id)} />
            <span className="palette-swatches" aria-hidden="true">
              {item.swatches.map((color) => <i key={color} style={{ background: color }} />)}
            </span>
            <span className="palette-text"><b>{item.name}</b><small>{item.note}</small></span>
          </label>
        ))}
      </fieldset>
      <div className="legend-key">
        <span><i className="key-load" />内环 + 中心数字 = 实际负荷（真实比例）</span>
        <span><i className="key-status" />外环 + 右下圆形徽标 = 运行状态</span>
      </div>
      <p className="sample-note">以下为设计测试样例，独立于 89 个监控对象，不计入任何统计。</p>
      <div className="sample-grid">
        {samples.map(({ caption, device }) => (
          <figure key={device.id} className="sample-cell">
            <DeviceUnit device={device} now={sampleNow} />
            <figcaption>{caption}</figcaption>
          </figure>
        ))}
      </div>
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
  const [palette, setPalette] = useState<PaletteId>('harbor')
  const legendRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    setDevices(loadDevices())
    const savedPalette = window.localStorage.getItem(PALETTE_KEY)
    if (palettes.some((item) => item.id === savedPalette)) setPalette(savedPalette as PaletteId)
  }, [])

  function changePalette(id: PaletteId) {
    setPalette(id)
    window.localStorage.setItem(PALETTE_KEY, id)
  }

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
    <main className="monitor-shell" data-palette={palette}>
      <dialog ref={legendRef} className="legend-dialog" aria-labelledby="legend-title" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
        <div className="legend-head">
          <h2 id="legend-title">仪表图例与配色</h2>
          <button type="button" className="legend-close" onClick={() => legendRef.current?.close()} aria-label="关闭图例"><X size={14} /></button>
        </div>
        <GaugeLegend palette={palette} onPaletteChange={changePalette} />
      </dialog>
      <header className="topbar">
        <div className="brand-lockup">
          <RoundIcon icon={Wifi} tone="tone-brand" />
          <h1>区域设备状态监控中心</h1>
        </div>
        <div className="topbar-actions">
          <div className="clock"><span suppressHydrationWarning>{dateText}</span><strong suppressHydrationWarning>{timeText}</strong></div>
          <span className="demo-badge"><i />演示数据</span>
          <button type="button" className="fullscreen-button" onClick={() => legendRef.current?.showModal()}>
            <span className="button-icon"><Palette size={13} /></span>
            图例 · 配色
          </button>
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
