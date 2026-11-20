'use client'

import { useEffect, useState } from 'react'
import { DashboardView } from '@/components/monitor-dashboard'
import { DEFAULT_SETTINGS, type MonitorSnapshot, type SnapshotDevice } from '@/lib/contracts'

const start = Date.UTC(2025, 0, 1, 4)
const areas = [
  { id: 'lab', name: '示例机房', order: 0 },
  { id: 'network', name: '示例网络', order: 1 },
  { id: 'floor', name: '示例工区', order: 2 },
]

function snapshot(tick: number): MonitorSnapshot {
  const now = start + tick * 5000
  const devices: SnapshotDevice[] = []
  function add(regionId: string, group: string, name: string, values: Partial<SnapshotDevice>) {
    const order = devices.length
    devices.push({
      id: 'demo-' + order, regionId, deviceGroup: group, deviceName: group, name, order,
      type: 'server', metricKind: 'percent', reachable: true, statusAvailable: true,
      faultAvailable: true, hasFault: false, statusReason: 'online', allowOffline: false,
      statusClock: now, ...values,
    })
  }
  const wave = Math.sin(tick / 3)
  add('lab', '应用服务器 A', 'CPU', { metricValue: 32.8 + wave * 8, metricLabel: 'CPU' })
  add('lab', '应用服务器 A', '内存', { metricValue: 56.2 + wave * 2, metricLabel: '内存' })
  add('lab', '备用电源', '电池电量', { type: 'battery', metricValue: 18, metricLabel: '剩余电量' })
  add('lab', '应用服务器 A', '数据盘', { metricValue: 92.1, hasFault: true, statusReason: 'active_fault', faultMessage: '可用空间不足' })
  add('network', '边缘路由器 A', 'CPU / 内存', { type: 'router', metricKind: 'resources', cpuValue: 18 + wave * 6, memoryValue: 42 })
  for (const i of [1, 2]) {
    add('network', '边缘路由器 A', 'WAN ' + i, {
      type: 'line', metricKind: 'traffic', uploadValue: (2 + wave) * i * 1e6,
      downloadValue: (4 - wave) * i * 1e6, uploadMax: 1e7, downloadMax: 1e7,
      connectionsScope: 'port', connections: Math.round(240 * i + wave * 35), wanIps: ['198.51.100.' + i],
    })
  }
  const names = ['读码器 A', '测量终端 B', '标签机 C', '采集器 D', '工作站 E', '控制器 F']
  names.forEach((name, i) => {
    const offline = i === 2
    const unknown = i === 5
    add('floor', '设备', name, {
      type: 'terminal', metricKind: 'raw', metricUnit: 'ms', allowOffline: true,
      onlineAddress: '192.0.2.' + (20 + i), metricValue: offline || unknown ? undefined : 12 + i + wave * 3,
      reachable: !offline && !unknown, statusAvailable: !unknown,
      statusReason: offline ? 'offline' : unknown ? 'status_missing' : 'online',
      offlineSince: offline ? start - 720000 : undefined,
    })
  })
  return { version: 1, serverTime: now, regions: areas, settings: DEFAULT_SETTINGS, devices, source: { status: 'ok' } }
}

export default function DemoPage() {
  const [tick, setTick] = useState<number | null>(null)
  useEffect(() => {
    setTick(0)
    const timer = window.setInterval(() => setTick(value => (value ?? 0) + 1), 5000)
    return () => window.clearInterval(timer)
  }, [])
  if (tick === null) return <main className="monitor-shell" aria-busy="true">正在打开演示大屏…</main>
  return <DashboardView demo snapshot={snapshot(tick)} failed={false} />
}
