'use client'

import type { CSSProperties } from 'react'
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
  formatSampleTime,
  sortDevices,
  sortRegions,
  type DeviceStatus,
} from '@/lib/monitor-data'
import { DEFAULT_SETTINGS, type MonitorSnapshot, type Region, type SnapshotDevice } from '@/lib/contracts'
import { DeviceUnit, RoundIcon, statusMeta } from '@/components/device-gauge'
import { DeviceHistoryDialog } from '@/components/device-history-dialog'
import { useMonitorSnapshot } from '@/components/use-monitor-snapshot'

function GaugeLegend() {
  return (
    <div className="legend-body">
      <div className="legend-key">
        <span><i className="key-load" />内环表示有量程的指标比例，中心显示读数</span>
        <span>进度从低到高依次经过绿、黄、红。</span>
        <span>延时数字与内圈同色：100 ms 及以下为绿，300 ms 为黄，500 ms 及以上为红，中间连续过渡。</span>
        <span>流量仪表：上传在上、下载在下，连接数居中。未设置实际带宽时不显示对应的占用弧线。</span>
      </div>
      <div className="legend-key">
        <span>外圈表示状态：正常为绿色细线，异常为红色粗线，允许离线为灰色虚线，未知为黄色点线。</span>
        {Object.values(statusMeta).map(({ label, tone, icon }) => (
          <span key={tone}><RoundIcon icon={icon} tone={tone} size="sm" />{label}</span>
        ))}
      </div>
    </div>
  )
}

function SourceBadge({ snapshot, failed }: { snapshot?: MonitorSnapshot; failed: boolean }) {
  const source = snapshot?.source
  const stale = snapshot?.devices.some((device) => !device.hidden && device.statusReason === 'status_stale')
  const [label, tone] = failed ? ['监控服务连接中断', 'tone-unknown']
    : source?.ikuai?.status === 'unavailable' ? ['爱快 API 不可用', 'tone-unknown']
    : source?.status === 'ok' && stale ? ['采集数据过期', 'tone-unknown']
    : source?.status === 'ok' ? [source.ikuai ? 'Zabbix / 爱快 API 正常' : 'Zabbix 连接正常', 'tone-normal']
    : source?.status === 'not_configured' ? ['数据源未配置', 'tone-unknown']
    : source?.status === 'unavailable' ? ['Zabbix 不可用', 'tone-unknown']
    : source?.status === 'empty' ? ['暂无监控数据', 'tone-offline']
    : ['正在连接监控服务', 'tone-brand']
  const reason = source?.code && { connection: '连接失败', auth: '认证失败', permission: '权限不足', no_items: '无可用采样' }[source.code]
  const checkedAt = source?.ikuai?.checkedAt ?? source?.checkedAt
  return (
    <span className={'source-badge ' + tone} title={reason}>
      <i aria-hidden="true" />
      {label}
      {checkedAt !== undefined && <time dateTime={new Date(checkedAt).toISOString()} title={'数据源检查时间 ' + formatSampleTime(checkedAt)}>{new Date(checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}</time>}
    </span>
  )
}

export function countStatuses(devices: SnapshotDevice[]) {
  return devices.reduce<Record<DeviceStatus, number>>((acc, device) => {
    acc[getDeviceStatus(device)] += 1
    return acc
  }, { normal: 0, error: 0, offline: 0, unknown: 0 })
}

function RegionPanel({ region, devices, now, onHistory }: { region: Region; devices: SnapshotDevice[]; now: number; onHistory?: (id: string) => void }) {
  const ordered = useMemo(() => sortDevices(devices), [devices])
  const groups = new Map<string, SnapshotDevice[]>()
  for (const device of ordered) {
    const key = device.deviceGroup ?? device.id
    const group = groups.get(key)
    if (group) group.push(device)
    else groups.set(key, [device])
  }
  const counts = useMemo(() => countStatuses(devices), [devices])
  const hasAlert = counts.error > 0
  const hasUnknown = counts.unknown > 0
  const regionState = devices.length === 0
    ? { text: '暂无项目', tone: 'tone-offline', icon: PowerOff }
    : hasAlert
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
      {Array.from(groups, ([key, members]) => (
        <div className="host-row" key={key}>
          <strong className="host-name">{(members.find(device => device.deviceName)?.deviceName ?? members[0].name)
            .replace(/^(Zabbix|Excel|业务)(服务器)$/, '$1\n$2').replace(/^(路由器)(（[主备]）)$/, '$1\n$2')}</strong>
          <div className={key.startsWith('group:') ? 'device-grid named-group' : 'device-grid'}>
            {members.map(device => <DeviceUnit key={device.id} device={device} now={now}
              onHistory={onHistory && device.liveSource !== 'ikuai' ? () => onHistory(device.id) : undefined} />)}
          </div>
        </div>
      ))}
    </section>
  )
}

export default function MonitorDashboard() {
  const { snapshot, clockOffset, failed } = useMonitorSnapshot('/api/snapshot')
  const [localTime, setLocalTime] = useState<number>()
  useEffect(() => {
    const tick = () => setLocalTime(Date.now())
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [])
  const now = snapshot && (localTime === undefined ? snapshot.serverTime : Math.max(snapshot.serverTime, localTime + clockOffset))
  return <DashboardView snapshot={snapshot} now={now} failed={failed} />
}

export function DashboardView({ snapshot, now = snapshot?.serverTime, failed, demo = false }: { snapshot?: MonitorSnapshot; now?: number; failed: boolean; demo?: boolean }) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const legendRef = useRef<HTMLDialogElement>(null)
  const settings = snapshot?.settings ?? DEFAULT_SETTINGS
  const style = { '--columns': settings.columns, '--gauge-scale': settings.gaugeSize / 100 } as CSSProperties

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const devices = useMemo(() => snapshot?.devices.filter((device) => !device.hidden) ?? [], [snapshot?.devices])
  const historyDevice = devices.find((device) => device.id === selectedId && device.liveSource !== 'ikuai')
  const regions = useMemo(() => sortRegions(snapshot?.regions ?? []), [snapshot?.regions])
  const summary = useMemo(() => countStatuses(devices), [devices])
  const devicesByRegion = useMemo(
    () => Object.fromEntries(regions.map((region) => [region.id, devices.filter((device) => device.regionId === region.id)])),
    [devices, regions],
  )

  const date = now === undefined ? undefined : new Date(now)
  const dateText = date && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const timeText = date?.toLocaleTimeString('zh-CN', { hourCycle: 'h23' })
  const total = devices.length

  function toggleFullscreen() {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {})
    else void document.exitFullscreen?.().catch(() => {})
  }

  const stats = [
    { key: 'total', label: '监控对象', value: total, tone: 'tone-brand', icon: Activity },
    { key: 'normal', label: '正常', value: summary.normal, tone: 'tone-normal', icon: CheckCircle2 },
    { key: 'error', label: '异常', value: summary.error, tone: 'tone-error', icon: AlertTriangle },
    { key: 'offline', label: '无影响离线', value: summary.offline, tone: 'tone-offline', icon: PowerOff },
    { key: 'unknown', label: '状态未知', value: summary.unknown, tone: 'tone-unknown', icon: HelpCircle },
  ]

  return (
    <main className="monitor-shell" data-palette={settings.palette} style={style}>
      <dialog ref={legendRef} className="legend-dialog" aria-labelledby="legend-title" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
        <div className="legend-head">
          <h2 id="legend-title">仪表图例</h2>
          <button type="button" className="legend-close" onClick={() => legendRef.current?.close()} aria-label="关闭图例"><X size={14} /></button>
        </div>
        <GaugeLegend />
      </dialog>
      <DeviceHistoryDialog device={historyDevice} version={snapshot?.version} onClose={() => setSelectedId(undefined)} />
      <header className="topbar">
        <div className="brand-lockup">
          <RoundIcon icon={Wifi} tone="tone-brand" />
          <h1>区域设备状态监控中心</h1>
        </div>
        <div className="topbar-actions">
          <div className="clock">{date ? <time dateTime={date.toISOString()}><span>{dateText}</span><strong>{timeText}</strong></time> : <strong aria-label="等待服务器时间">—</strong>}</div>
          {demo ? <span className="source-badge tone-brand"><i />演示 · 虚构数据</span> : <SourceBadge snapshot={snapshot} failed={failed} />}
          <button type="button" className="fullscreen-button" onClick={() => legendRef.current?.showModal()}>
            <span className="button-icon"><Palette size={13} /></span>
            仪表图例
          </button>
          <button type="button" className="fullscreen-button" onClick={toggleFullscreen} aria-label={isFullscreen ? '退出全屏' : '全屏显示'}>
            <span className="button-icon">{isFullscreen ? <Shrink size={13} /> : <Expand size={13} />}</span>
            {isFullscreen ? '退出全屏' : '全屏显示'}
          </button>
          {!demo && <Link href="/admin/projects" className="admin-entry" title="管理后台">
            <Settings2 size={13} aria-hidden="true" />
            管理后台
          </Link>}
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

      {total === 0 && (
        <p className="monitor-empty" role="status">
          {failed ? '连接监控服务失败，正在重试。' : snapshot ? '暂无监控项目' : '正在读取监控状态…'}
        </p>
      )}
      <div className="zones-grid">
        {regions.map((region) => <RegionPanel key={region.id} region={region} devices={devicesByRegion[region.id] ?? []} now={now ?? 0} onHistory={demo ? undefined : setSelectedId} />)}
      </div>
    </main>
  )
}
