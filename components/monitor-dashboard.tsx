'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { Boxes, Network } from 'lucide-react'
import { sortDevices, sortRegions, getDeviceStatus, type DeviceStatus } from '@/lib/monitor-data'
import { DEFAULT_SETTINGS, type MonitorSnapshot, type Region, type SnapshotDevice } from '@/lib/contracts'
import { DeviceUnit, statusMeta } from '@/components/device-gauge'
import { MonitorHeader } from '@/components/monitor-header'
import { DeviceHistoryDialog } from '@/components/device-history-dialog'
import { useMonitorSnapshot } from '@/components/use-monitor-snapshot'

export function countStatuses(devices: SnapshotDevice[]) {
  return devices.reduce<Record<DeviceStatus, number>>((counts, device) => {
    counts[getDeviceStatus(device)]++
    return counts
  }, { normal: 0, error: 0, offline: 0, unknown: 0 })
}

function RegionPanel({ region, devices, now, onHistory }: { region: Region; devices: SnapshotDevice[]; now: number; onHistory?: (id: string) => void }) {
  const ordered = useMemo(() => sortDevices(devices), [devices])
  const counts = countStatuses(devices)
  const state = !devices.length ? '暂无设备' : counts.error ? `${counts.error} 项异常` : counts.unknown ? `${counts.unknown} 项未知` : counts.offline ? `${counts.offline} 项离线` : '全部正常'
  const tone = !devices.length ? 'offline' : counts.error ? 'error' : counts.unknown ? 'unknown' : counts.offline ? 'offline' : 'normal'
  return <section className="rack" aria-label={region.name}>
    <header className="rack-label">
      <span className="rack-count"><Boxes size={16} aria-hidden="true" />{devices.length} 个监控对象</span>
      <h2>{region.name}</h2>
      <span className={`rack-state ${statusMeta[tone].tone}`}><i aria-hidden="true" />{state}</span>
    </header>
    {ordered.length ? <div className="rack-grid" style={{ '--rack-columns': Math.ceil(ordered.length / 2) } as CSSProperties} tabIndex={0} aria-label={`${region.name}的设备读数`} role="group">
      {ordered.map(device => <DeviceUnit key={device.id} device={device} now={now} onHistory={onHistory && device.liveSource !== 'ikuai' ? () => onHistory(device.id) : undefined} />)}
    </div> : <p className="rack-empty">此区域暂无监控对象</p>}
  </section>
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
  const now = localTime === undefined ? snapshot?.serverTime : localTime + (snapshot ? clockOffset : 0)
  return <DashboardView snapshot={snapshot} now={now} failed={failed} />
}

export function DashboardView({ snapshot, now = snapshot?.serverTime, displayTime = now, failed, demo = false }: { snapshot?: MonitorSnapshot; now?: number; displayTime?: number; failed: boolean; demo?: boolean }) {
  const [selectedId, setSelectedId] = useState<string>()
  const devices = useMemo(() => snapshot?.devices.filter(device => !device.hidden) ?? [], [snapshot?.devices])
  const regions = useMemo(() => sortRegions(snapshot?.regions ?? []), [snapshot?.regions])
  const historyDevice = devices.find(device => device.id === selectedId && device.liveSource !== 'ikuai')
  const stale = devices.some(device => device.statusReason === 'status_stale')
  const warning = failed ? '连接监控服务失败，正在重试。' : stale ? '采集数据过期' : snapshot?.source.status === 'unavailable' ? '数据源不可用' : snapshot?.source.ikuai?.status === 'unavailable' ? '爱快 API 不可用' : undefined
  return <main className="monitor-shell" data-palette={snapshot?.settings.palette ?? DEFAULT_SETTINGS.palette}>
    <DeviceHistoryDialog device={historyDevice} version={snapshot?.version} onClose={() => setSelectedId(undefined)} />
    <MonitorHeader now={displayTime} batteries={devices.filter(device => device.type === 'battery')} />
    <div className="monitor-section-label"><h2><Network size={16} aria-hidden="true" />区域监控</h2><span>{demo && '演示数据 · '}{regions.length} 个区域 / {devices.length} 个对象</span></div>
    {warning && <p className="monitor-warning" role="status">{warning}</p>}
    {!devices.length && <div className="monitor-empty"><Network size={28} aria-hidden="true" /><strong role="status">{snapshot ? '暂无监控项目' : failed ? '未收到监控数据' : '正在读取监控状态…'}</strong>{!demo && <Link href="/demo">查看演示大屏 →</Link>}</div>}
    <div className="zones-grid">{regions.map(region => <RegionPanel key={region.id} region={region} devices={devices.filter(device => device.regionId === region.id)} now={now ?? 0} onHistory={demo ? undefined : setSelectedId} />)}</div>
  </main>
}
