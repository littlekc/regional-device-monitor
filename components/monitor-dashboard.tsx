'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Expand,
  HelpCircle,
  Palette,
  PowerOff,
  Settings2,
  Shrink,
  Wifi,
  X,
} from 'lucide-react'
import {
  getDeviceStatus,
  getVisibleDevices,
  sortDevices,
  sortRegions,
  type DeviceStatus,
  type MonitorDevice,
  type Region,
} from '@/lib/monitor-data'
import { demoApi, syncFromStorage, useDemoState, type PaletteId } from '@/lib/demo-store'
import { DeviceUnit, RoundIcon, palettes, statusMeta } from '@/components/device-gauge'

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
    { caption: '状态未知', device: { ...base, id: 's9', name: '样例-未知', type: 'terminal', metricKind: 'none', reachable: false, statusAvailable: false } },
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
      <p className="sample-note">以下为设计测试样例，独立于大屏监控对象，不计入任何统计。</p>
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

export function countStatuses(devices: MonitorDevice[]) {
  return devices.reduce<Record<DeviceStatus, number>>((acc, device) => {
    acc[getDeviceStatus(device)] += 1
    return acc
  }, { normal: 0, error: 0, offline: 0, unknown: 0 })
}

function RegionPanel({ region, devices, now }: { region: Region; devices: MonitorDevice[]; now: number }) {
  const ordered = useMemo(() => sortDevices(devices), [devices])
  const counts = useMemo(() => countStatuses(devices), [devices])
  const hasAlert = counts.error > 0
  const hasUnknown = counts.unknown > 0
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

export default function MonitorDashboard() {
  const demo = useDemoState()
  const [now, setNow] = useState(() => Date.now())
  const [isFullscreen, setIsFullscreen] = useState(false)
  const legendRef = useRef<HTMLDialogElement>(null)
  const palette = demo?.palette ?? 'harbor'
  const refreshSeconds = demo?.settings.refreshSeconds ?? 10

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(syncFromStorage, Math.max(1, refreshSeconds) * 1000)
    return () => window.clearInterval(timer)
  }, [refreshSeconds])

  const devices = useMemo(() => getVisibleDevices(demo?.devices ?? []), [demo?.devices])
  const regions = useMemo(() => sortRegions(demo?.regions ?? []), [demo?.regions])
  const summary = useMemo(() => countStatuses(devices), [devices])
  const devicesByRegion = useMemo(
    () => Object.fromEntries(regions.map((region) => [region.id, devices.filter((device) => device.regionId === region.id)])),
    [devices, regions],
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
        <GaugeLegend palette={palette} onPaletteChange={(id) => demoApi.setPalette(id)} />
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
          <Link href="/admin/projects" className="admin-entry" title="管理后台">
            <Settings2 size={13} aria-hidden="true" />
            管理后台
          </Link>
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
        {regions.map((region) => <RegionPanel key={region.id} region={region} devices={devicesByRegion[region.id] ?? []} now={now} />)}
      </div>
    </main>
  )
}
