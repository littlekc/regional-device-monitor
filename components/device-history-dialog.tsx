'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { History, X } from 'lucide-react'
import { HISTORY_RANGES, type DeviceHistory, type HistoryNote, type HistoryRange, type SnapshotDevice } from '@/lib/contracts'
import { loadDeviceHistory, requestErrorMessage } from '@/lib/monitor-client'
import { formatSampleTime, getDeviceStatus } from '@/lib/monitor-data'
import { DeviceHistoryChart } from '@/components/device-history-chart'
import { statusMeta } from '@/components/device-gauge'

const rangeLabels: Record<HistoryRange, string> = { '1h': '1 小时', '24h': '24 小时', '7d': '7 天' }
const noteLabels: Record<HistoryNote, string> = {
  gaps: '部分时段缺少有效采样，曲线保留断点。',
  truncated: '达到原始样本上限，图表仅包含所读取的最新样本。',
  unavailable: '至少一个已绑定的监控项不可用。',
  connections_unbound: '未绑定连接数监控项，无连接数曲线。',
  ikuai_live_only: '当前仪表使用爱快 API；此图保留原 Zabbix 历史采样，并非每 5 秒 API 记录。WAN 历史连接数尚未采集。',
  connectivity_unavailable: '爱快此历史接口未提供连通性采样，无法还原历史在线状态或离线起点。',
  router_retention: '来自爱快分钟级历史采样；仅展示路由器实际保留的数据，缺少的时段留空。',
}

type HistoryResult = { data: DeviceHistory } | { error: string }

function HistoryResponse({ projectId, version, range }: { projectId: string; version: number; range: HistoryRange }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<HistoryResult>()
  function retry() {
    setResult(undefined)
    setAttempt((previous) => previous + 1)
  }

  useEffect(() => {
    const request = new AbortController()
    void loadDeviceHistory(projectId, range, request.signal).then((data) => {
      if (request.signal.aborted) return
      if (data.projectId !== projectId || data.range !== range || data.version !== version) {
        setResult({ error: '项目配置已变更，等待大屏刷新后重试。' })
      } else {
        setResult({ data })
      }
    }).catch((error: unknown) => {
      if (!request.signal.aborted) setResult({ error: requestErrorMessage(error) })
    })
    return () => request.abort()
  }, [projectId, version, range, attempt])

  if (!result) return <div className="history-empty" role="status">正在读取历史数据…</div>
  if ('error' in result) return <div className="history-empty"><p role="alert">{result.error}</p><button className="history-retry" type="button" onClick={retry}>重试</button></div>

  const { data } = result
  const hasSamples = data.series.some(({ values }) => values.some((value) => value !== null)) || data.connectivity.values.some((value) => value !== null)
  const sourceProblem = data.source.status === 'unavailable' || data.source.status === 'not_configured'
  return (
    <>
      {data.source.notes.length > 0 && <div className="history-note" role="status">{data.source.notes.map((note) => <p key={note}>{noteLabels[note]}</p>)}</div>}
      {!hasSamples && <div className="history-empty">
        <p role={sourceProblem ? 'alert' : 'status'}>{data.source.status === 'not_configured' ? 'Zabbix 数据源未配置。' : sourceProblem ? '暂时无法获取历史数据。' : '所选时段暂无有效历史采样。'}</p>
        {sourceProblem && <button className="history-retry" type="button" onClick={retry}>重试</button>}
      </div>}
      {hasSamples && data.series.length === 0 && <p className="history-note">此项目仅监控连通性，没有数值曲线。</p>}
      <DeviceHistoryChart key={attempt} history={data} />
      {data.source.status === 'partial' && data.source.notes.includes('unavailable') && <button className="history-retry" type="button" onClick={retry}>重试读取</button>}
      <p className="history-foot">
        {data.source.provider === 'ikuai' ? '爱快 API' : 'Zabbix'} · 读取于 {formatSampleTime(data.source.checkedAt)}。{data.series.length > 0 && '曲线显示各时段内的采样均值，统计基于已取得的原始有效样本。'}
      </p>
    </>
  )
}

function HistoryContent({ device, version, close, titleId }: { device: SnapshotDevice; version: number; close: () => void; titleId: string }) {
  const [range, setRange] = useState<HistoryRange>('1h')
  const status = statusMeta[getDeviceStatus(device)]
  return (
    <>
      <header className="history-head">
        <span className="history-icon" aria-hidden="true"><History size={18} /></span>
        <div className="history-id">
          <h2 id={titleId}>{device.name}</h2>
          <p>历史数据 · 当前状态：<span className={`history-state ${status.tone}`}>{status.label}</span></p>
        </div>
        <div className="history-range" role="group" aria-label="历史时间范围">
          {HISTORY_RANGES.map((option) => <button type="button" key={option} aria-pressed={range === option} onClick={() => setRange(option)}>{rangeLabels[option]}</button>)}
        </div>
        <button type="button" className="legend-close history-close" onClick={close} aria-label="关闭历史数据"><X size={15} aria-hidden="true" /></button>
      </header>
      <div className="history-body">
        <HistoryResponse key={`${version}:${range}`} projectId={device.id} version={version} range={range} />
      </div>
    </>
  )
}

export function DeviceHistoryDialog({ device, version, onClose }: { device?: SnapshotDevice; version?: number; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const open = device !== undefined && version !== undefined
  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLButtonElement>('.history-close')?.focus()
    }
    if (!open && dialog?.open) dialog.close()
  }, [open])

  return (
    <dialog ref={dialogRef} className="history-dialog" aria-labelledby={titleId} onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
      {open && <HistoryContent key={device.id} device={device} version={version} titleId={titleId} close={() => dialogRef.current?.close()} />}
    </dialog>
  )
}
