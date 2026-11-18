import Link from 'next/link'
import { Server, Settings2 } from 'lucide-react'
import type { SnapshotDevice } from '@/lib/contracts'
import { getReading } from './device-gauge'

export function MonitorHeader({ now, batteries }: { now?: number; batteries: SnapshotDevice[] }) {
  const date = now === undefined ? undefined : new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  const timestamp = date && `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return <header className="monitor-head">
    <div className="monitor-title"><span className="server-mark"><Server size={23} aria-hidden="true" /></span><h1>区域设备状态监控中心</h1></div>
    <div className="monitor-tools">
      <div className="clock"><time dateTime={date?.toISOString()}>{timestamp ?? '—'}</time></div>
      <div className="battery-list">{batteries.length ? batteries.map(device => {
        const reading = getReading(device)
        const percent = reading.kind === 'value' ? reading.batteryPercent : undefined
        return <span className="battery-readout" key={device.id} title={`${device.deviceName ?? device.name} · ${device.name}`}><span>{batteries.length > 1 ? device.deviceName ?? device.name : '电量'}</span><b className={percent !== undefined && percent <= 20 ? 'low-charge' : undefined}>{percent === undefined ? '—' : `${reading.kind === 'value' ? reading.value : ''}%`}</b></span>
      }) : <span className="battery-readout" title="暂无电池监控读数">电量 <b>—</b></span>}</div>
      <Link href="/admin/projects" className="monitor-admin"><Settings2 size={15} aria-hidden="true" />管理后台</Link>
    </div>
  </header>
}
