'use client'

import { useEffect, useMemo, useState } from 'react'
import { Expand, HelpCircle, Monitor, Network, Power, Router, Server, Wifi, X } from 'lucide-react'
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

const statusMeta: Record<DeviceStatus, { label: string; short: string; color: string; dot: string }> = {
  normal: { label: '正常', short: '正常', color: 'status-normal', dot: 'bg-emerald-400' },
  error: { label: '异常', short: '异常', color: 'status-error', dot: 'bg-red-400' },
  offline: { label: '无影响离线', short: '允许离线', color: 'status-offline', dot: 'bg-slate-400' },
  unknown: { label: '状态未知', short: '状态未知', color: 'status-unknown', dot: 'bg-amber-400' },
}

const typeIcon: Record<DeviceType, typeof Server> = {
  server: Server,
  line: Network,
  router: Router,
  power: Power,
  terminal: Monitor,
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="summary-tile">
      <span className={`summary-mark ${tone}`} />
      <div><strong>{String(value).padStart(2, '0')}</strong><span>{label}</span></div>
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
    <div className={`device-card ${meta.color}`} title={`${device.name} · ${meta.label}`}>
      <div className="device-topline">
        <span className="device-type-icon"><Icon size={14} strokeWidth={1.8} /></span>
        <span className="device-name">{device.name}</span>
        <span className={`status-dot ${meta.dot}`} aria-label={meta.label} />
      </div>
      <div className="device-detail">
        {status === 'unknown' && <HelpCircle size={12} />}
        <span>{detail}</span>
      </div>
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

  return (
    <section className={`region-panel ${hasAlert ? 'has-alert' : ''} ${hasUnknown ? 'has-unknown' : ''}`}>
      <header className="region-header">
        <div>
          <div className="region-kicker"><span className="region-pulse" /> MONITORING ZONE</div>
          <h2>{region.name}</h2>
        </div>
        <div className="region-status">
          {hasAlert ? <><span className="mini-alert-dot" />需要处理</> : hasUnknown ? <><HelpCircle size={13} />存在未知</> : <><span className="mini-ok-dot" />运行正常</>}
        </div>
      </header>
      <div className="region-metrics">
        <span><b>{devices.length}</b> 对象</span>
        <span className={counts.error ? 'metric-alert' : ''}><b>{counts.error}</b> 异常</span>
        <span className={counts.offline ? 'metric-muted' : ''}><b>{counts.offline}</b> 无影响离线</span>
        {counts.unknown > 0 && <span className="metric-unknown"><b>{counts.unknown}</b> 未知</span>}
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

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => setIsFullscreen(true))
    else document.exitFullscreen?.().then(() => setIsFullscreen(false))
  }

  return (
    <main className="monitor-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-icon"><Wifi size={20} /></div><div><div className="eyebrow">INFRASTRUCTURE OBSERVABILITY</div><h1>区域设备状态监控中心</h1></div></div>
        <div className="topbar-actions">
          <div className="clock"><span>{dateText}</span><strong>{timeText}</strong></div>
          <span className="demo-badge"><i />演示数据</span>
          <button className="fullscreen-button" onClick={toggleFullscreen} aria-label="切换全屏"><Expand size={17} />{isFullscreen ? '退出全屏' : '全屏显示'}</button>
        </div>
      </header>
      <section className="summary-bar" aria-label="全局状态摘要">
        <div className="summary-heading"><span className="live-line" />全局状态摘要</div>
        <StatTile label="监控对象" value={devices.length} tone="tone-total" />
        <StatTile label="正常数量" value={summary.normal} tone="tone-normal" />
        <StatTile label="异常数量" value={summary.error} tone="tone-error" />
        <StatTile label="无影响离线" value={summary.offline} tone="tone-offline" />
        <StatTile label="状态未知" value={summary.unknown} tone="tone-unknown" />
      </section>
      <div className="zones-grid">
        {regions.map((region) => <RegionPanel key={region.id} regionId={region.id} devices={devices.filter((device) => device.regionId === region.id)} now={now} />)}
      </div>
      <footer className="screen-footer"><span><span className="footer-dot" />状态每 30 秒更新计时</span><span>数据源：本地演示配置</span></footer>
    </main>
  )
}
