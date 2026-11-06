'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Expand,
  HelpCircle,
  Monitor,
  Network,
  Power,
  PowerOff,
  Router,
  Server,
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
  type DeviceStatus,
  type DeviceType,
  type MonitorDevice,
} from '@/lib/monitor-data'

const statusMeta: Record<DeviceStatus, { label: string; tone: string; icon: LucideIcon }> = {
  normal: { label: '正常', tone: 'tone-normal', icon: CheckCircle2 },
  error: { label: '异常', tone: 'tone-error', icon: AlertTriangle },
  offline: { label: '无影响离线', tone: 'tone-offline', icon: PowerOff },
  unknown: { label: '状态未知', tone: 'tone-unknown', icon: HelpCircle },
}

const typeIcon: Record<DeviceType, LucideIcon> = {
  server: Server,
  line: Network,
  router: Router,
  power: Power,
  terminal: Monitor,
}

function RoundIcon({ icon: Icon, tone, size = 'md', label }: { icon: LucideIcon; tone: string; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const iconSize = size === 'lg' ? 20 : size === 'md' ? 15 : 12
  return (
    <span className={`round-icon round-${size} ${tone}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <Icon size={iconSize} strokeWidth={1.9} />
    </span>
  )
}

function StatTile({ label, value, total, tone, icon }: { label: string; value: number; total: number; tone: string; icon: LucideIcon }) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className={`summary-tile ${tone}`}>
      <RoundIcon icon={icon} tone={tone} size="lg" />
      <div className="summary-copy">
        <span className="summary-label">{label}</span>
        <strong>{String(value).padStart(2, '0')}</strong>
      </div>
      <span className="summary-share">{share}%</span>
    </div>
  )
}

function DeviceCard({ device, now }: { device: MonitorDevice; now: number }) {
  const status = getDeviceStatus(device)
  const meta = statusMeta[status]
  const Icon = typeIcon[device.type]
  const detail = status === 'error' && device.hasFault
    ? device.faultMessage ?? '检测到明确故障'
    : status === 'unknown'
      ? '暂时无法判断'
      : status === 'normal'
        ? '检查正常'
        : device.offlineSince
          ? formatOfflineDuration(device.offlineSince, now)
          : '状态未知'

  return (
    <div className={`device-card ${meta.tone}`} title={`${device.name} · ${meta.label}`}>
      <span className="device-icon">
        <RoundIcon icon={Icon} tone={meta.tone} />
        <span className="device-badge" role="img" aria-label={meta.label} />
      </span>
      <span className="device-body">
        <span className="device-name">{device.name}</span>
        <span className="device-detail">{detail}</span>
      </span>
    </div>
  )
}

function RegionPanel({ regionId, devices, now }: { regionId: string; devices: MonitorDevice[]; now: number }) {
  const ordered = sortDevices(devices)
  const counts = devices.reduce<Record<DeviceStatus, number>>((acc, device) => {
    const status = getDeviceStatus(device)
    acc[status] += 1
    return acc
  }, { normal: 0, error: 0, offline: 0, unknown: 0 })
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
        <div className="region-title">
          <span className="region-badge" aria-hidden="true">{region.name.charAt(0)}</span>
          <div>
            <span className="region-kicker">MONITORING ZONE</span>
            <h2>{region.name}</h2>
          </div>
        </div>
        <div className={`region-state ${regionState.tone}`}>
          <RoundIcon icon={regionState.icon} tone={regionState.tone} size="sm" />
          {regionState.text}
        </div>
      </header>
      <div className="region-metrics">
        <span className="metric"><b>{devices.length}</b>对象</span>
        <span className={`metric ${counts.error ? 'tone-error is-active' : ''}`}><i /><b>{counts.error}</b>异常</span>
        <span className={`metric ${counts.offline ? 'tone-offline is-active' : ''}`}><i /><b>{counts.offline}</b>无影响离线</span>
        {counts.unknown > 0 && <span className="metric tone-unknown is-active"><i /><b>{counts.unknown}</b>未知</span>}
      </div>
      <div className="device-grid">
        {ordered.map((device) => <DeviceCard key={device.id} device={device} now={now} />)}
      </div>
    </section>
  )
}

export default function MonitorDashboard() {
  const [now, setNow] = useState(() => Date.now())
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [devices, setDevices] = useState<MonitorDevice[]>([])

  useEffect(() => {
    const saved = window.localStorage.getItem('region-monitor-demo-data')
    if (saved) {
      try { setDevices(JSON.parse(saved)); return } catch { window.localStorage.removeItem('region-monitor-demo-data') }
    }
    const initial = createDemoDevices()
    window.localStorage.setItem('region-monitor-demo-data', JSON.stringify(initial))
    setDevices(initial)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const summary = useMemo(() => devices.reduce<Record<DeviceStatus, number>>((acc, device) => {
    acc[getDeviceStatus(device)] += 1
    return acc
  }, { normal: 0, error: 0, offline: 0, unknown: 0 }), [devices])

  const date = new Date(now)
  const dateText = `${date.getFullYear()} / ${String(date.getMonth() + 1).padStart(2, '0')} / ${String(date.getDate()).padStart(2, '0')}`
  const timeText = date.toLocaleTimeString('zh-CN', { hour12: false })
  const total = devices.length

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => setIsFullscreen(true))
    else document.exitFullscreen?.().then(() => setIsFullscreen(false))
  }

  return (
    <main className="monitor-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <RoundIcon icon={Wifi} tone="tone-brand" size="lg" />
          <div>
            <div className="eyebrow">INFRASTRUCTURE OBSERVABILITY</div>
            <h1>区域设备状态监控中心</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="clock"><span suppressHydrationWarning>{dateText}</span><strong suppressHydrationWarning>{timeText}</strong></div>
          <span className="demo-badge"><i />演示数据</span>
          <button className="fullscreen-button" onClick={toggleFullscreen} aria-label="切换全屏">
            <span className="button-icon">{isFullscreen ? <Shrink size={14} /> : <Expand size={14} />}</span>
            {isFullscreen ? '退出全屏' : '全屏显示'}
          </button>
        </div>
      </header>

      <section className="summary-bar" aria-label="全局状态摘要">
        <div className="summary-heading">
          <span className="summary-title">全局状态摘要</span>
          <div className="distribution" role="img" aria-label={`正常 ${summary.normal}，异常 ${summary.error}，无影响离线 ${summary.offline}，状态未知 ${summary.unknown}`}>
            {(['normal', 'error', 'offline', 'unknown'] as const).map((key) => (
              <span key={key} className={statusMeta[key].tone} style={{ flexGrow: summary[key] }} />
            ))}
          </div>
        </div>
        <StatTile label="监控对象" value={total} total={total} tone="tone-brand" icon={Activity} />
        <StatTile label="正常数量" value={summary.normal} total={total} tone="tone-normal" icon={CheckCircle2} />
        <StatTile label="异常数量" value={summary.error} total={total} tone="tone-error" icon={AlertTriangle} />
        <StatTile label="无影响离线" value={summary.offline} total={total} tone="tone-offline" icon={PowerOff} />
        <StatTile label="状态未知" value={summary.unknown} total={total} tone="tone-unknown" icon={HelpCircle} />
      </section>

      <div className="zones-grid">
        {regions.map((region) => <RegionPanel key={region.id} regionId={region.id} devices={devices.filter((device) => device.regionId === region.id)} now={now} />)}
      </div>

      <footer className="screen-footer">
        <span><span className="footer-dot" />状态每 30 秒更新计时</span>
        <span className="legend">
          {(['normal', 'error', 'offline', 'unknown'] as const).map((key) => (
            <span key={key} className={statusMeta[key].tone}><i />{statusMeta[key].label}</span>
          ))}
        </span>
        <span>数据源：本地演示配置</span>
      </footer>
    </main>
  )
}
