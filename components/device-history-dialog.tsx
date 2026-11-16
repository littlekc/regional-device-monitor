'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { HelpCircle, X } from 'lucide-react'
import { adminTypeLabels, getDeviceStatus, type DeviceStatus, type MonitorDevice } from '@/lib/monitor-data'
import { buildHistory, formatTime, historyRanges, summarize, type HistoryRange, type HistorySeries, type StatusSegment } from '@/lib/history-mock'
import { DeviceGauge, getStatusText, statusMeta } from '@/components/device-gauge'

const W = 600
const H = 120

function linePaths(values: (number | null)[], max: number) {
  const n = values.length
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => H - (v / max) * H
  const lines: string[] = []
  const areas: string[] = []
  let run: [number, number][] = []
  const flush = () => {
    if (run.length > 1) {
      const d = run.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
      lines.push(d)
      areas.push(`${d} L${run[run.length - 1][0].toFixed(1)} ${H} L${run[0][0].toFixed(1)} ${H} Z`)
    }
    run = []
  }
  values.forEach((v, i) => (v === null ? flush() : run.push([x(i), y(v)])))
  flush()
  return { lines, areas }
}

function gapRanges(values: (number | null)[]) {
  const ranges: [number, number][] = []
  let start = -1
  values.forEach((v, i) => {
    if (v === null && start < 0) start = i
    if (v !== null && start >= 0) { ranges.push([start, i]); start = -1 }
  })
  if (start >= 0) ranges.push([start, values.length - 1])
  return ranges
}

function SeriesChart({ series, times, range, hover, onHover }: {
  series: HistorySeries
  times: number[]
  range: HistoryRange
  hover: number | null
  onHover: (index: number | null) => void
}) {
  const scaleMax = (series.max ?? 1) * 1.08
  const { lines, areas } = useMemo(() => linePaths(series.values, scaleMax), [series.values, scaleMax])
  const gaps = useMemo(() => gapRanges(series.values), [series.values])
  const stats = summarize(series.values)
  const n = times.length
  const idx = hover ?? n - 1
  const pointValue = series.values[idx]
  const showingHover = hover !== null
  const headline = showingHover ? pointValue : series.current
  const limitTop = (1 - (series.max ?? 0) / scaleMax) * 100

  function indexFrom(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * (n - 1))
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? -1 : 1
    onHover(Math.min(n - 1, Math.max(0, (hover ?? n - 1) + delta)))
  }

  return (
    <section className={`hist-chart tone-${series.tone}`} aria-label={series.label}>
      <header className="hist-chart-head">
        <span className="hist-chart-title"><i aria-hidden="true" />{series.label}</span>
        <span className="hist-chart-read" aria-live="polite">
          <b>{headline === null ? '—' : series.format(headline)}</b>
          <small>{series.unit}</small>
          <em>{showingHover ? formatTime(times[idx], range) : series.current === null ? '当前无读数' : '当前'}</em>
        </span>
        <span className="hist-chart-stats">
          <span>均值 <b>{stats.avg === null ? '—' : series.format(stats.avg)}</b></span>
          <span>峰值 <b>{stats.peak === null ? '—' : series.format(stats.peak)}</b></span>
          {series.tone !== 'conn' && series.tone !== 'load' && <span>量程 <b>{series.format(series.max ?? 0)}</b></span>}
          {series.tone === 'load' && series.unit === 'W' && <span>满量程 <b>{series.max}</b></span>}
        </span>
      </header>
      <div className="hist-plot">
        <div className="hist-y" aria-hidden="true">
          <span>{series.format(series.max ?? 0)}</span>
          <span>{series.format((series.max ?? 0) / 2)}</span>
          <span>0</span>
        </div>
        <div
          className="hist-canvas"
          tabIndex={0}
          role="img"
          aria-label={`${series.label}历史曲线，均值 ${stats.avg === null ? '无数据' : series.format(stats.avg)}${series.unit}，峰值 ${stats.peak === null ? '无数据' : series.format(stats.peak)}${series.unit}。左右方向键逐点查看`}
          onPointerMove={(e) => onHover(indexFrom(e))}
          onPointerLeave={() => onHover(null)}
          onKeyDown={onKey}
          onBlur={() => onHover(null)}
        >
          {gaps.map(([a, b]) => (
            <span key={a} className="hist-gap" style={{ left: `${(a / (n - 1)) * 100}%`, width: `${(Math.max(b - a, 0.5) / (n - 1)) * 100}%` }} aria-hidden="true">
              {b - a > n * 0.12 && <em>无数据</em>}
            </span>
          ))}
          <span className="hist-limit" style={{ top: `${limitTop}%` }} aria-hidden="true" />
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} className="hist-grid" x1="0" x2={W} y1={H - (f * (series.max ?? 0)) / scaleMax * H} y2={H - (f * (series.max ?? 0)) / scaleMax * H} vectorEffect="non-scaling-stroke" />
            ))}
            {areas.map((d) => <path key={d} className="hist-area" d={d} />)}
            {lines.map((d) => <path key={d} className="hist-line" d={d} vectorEffect="non-scaling-stroke" />)}
          </svg>
          {showingHover && (
            <>
              <span className="hist-cursor" style={{ left: `${(idx / (n - 1)) * 100}%` }} aria-hidden="true" />
              {pointValue !== null && (
                <span className="hist-dot" style={{ left: `${(idx / (n - 1)) * 100}%`, top: `${(1 - pointValue / scaleMax) * 100}%` }} aria-hidden="true" />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function StatusTimeline({ segments, times, range, availability, hover }: {
  segments: StatusSegment[]
  times: number[]
  range: HistoryRange
  availability: number | null
  hover: number | null
}) {
  const start = times[0]
  const span = times[times.length - 1] - start
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => start + span * f)
  const present = [...new Set(segments.map((s) => s.state))] as DeviceStatus[]

  return (
    <section className="hist-status" aria-label="运行状态时间线">
      <header className="hist-chart-head">
        <span className="hist-chart-title">运行状态</span>
        <span className="hist-legend">
          {present.map((state) => <span key={state} className={statusMeta[state].tone}><i aria-hidden="true" />{statusMeta[state].label}</span>)}
        </span>
        <span className="hist-chart-stats">
          <span>正常占比 <b>{availability === null ? '—' : `${(availability * 100).toFixed(1)}%`}</b></span>
        </span>
      </header>
      <div className="hist-plot">
        <div className="hist-y" aria-hidden="true" />
        <div className="hist-strip-wrap">
          <div className="hist-strip" role="list">
            {segments.map((segment) => (
              <span
                key={segment.from}
                role="listitem"
                className={`hist-seg ${statusMeta[segment.state].tone} st-${segment.state}`}
                style={{ flexGrow: Math.max(segment.to - segment.from, span * 0.004) }}
                title={`${formatTime(segment.from, range)} – ${formatTime(segment.to, range)} · ${statusMeta[segment.state].label}`}
                aria-label={`${formatTime(segment.from, range)} 至 ${formatTime(segment.to, range)}：${statusMeta[segment.state].label}`}
              />
            ))}
            {hover !== null && <span className="hist-cursor" style={{ left: `${(hover / (times.length - 1)) * 100}%` }} aria-hidden="true" />}
          </div>
          <div className="hist-x" aria-hidden="true">
            {ticks.map((t) => <span key={t}>{formatTime(t, range)}</span>)}
          </div>
        </div>
      </div>
    </section>
  )
}

export function DeviceHistoryDialog({ device, regionName, now, onClose }: {
  device: MonitorDevice | null
  regionName?: string
  now: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [range, setRange] = useState<HistoryRange>('24h')
  const [hover, setHover] = useState<number | null>(null)
  const [openedAt, setOpenedAt] = useState(now)
  const deviceId = device?.id

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (deviceId && !dialog.open) {
      setOpenedAt(Date.now())
      setHover(null)
      dialog.showModal()
    }
    if (!deviceId && dialog.open) dialog.close()
  }, [deviceId])

  const history = useMemo(() => (device ? buildHistory(device, range, openedAt) : null), [device, range, openedAt])
  const status = device ? getDeviceStatus(device) : 'normal'
  const meta = statusMeta[status]

  return (
    <dialog
      ref={ref}
      className="history-dialog"
      aria-labelledby="history-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close() }}
    >
      {device && history && (
        <>
          <header className="history-head">
            <div className="history-gauge"><DeviceGauge device={device} /></div>
            <div className="history-id">
              <h2 id="history-title">{device.name}<span className="history-sub">历史数据</span></h2>
              <p>
                <span>{regionName ?? '未分配区域'}</span>
                <span>{adminTypeLabels[device.type]}</span>
                <span className={`history-state ${meta.tone}`}><i aria-hidden="true" />{meta.label} · {getStatusText(device, status, now)}</span>
              </p>
            </div>
            <div className="history-range" role="radiogroup" aria-label="时间范围">
              {historyRanges.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={range === item.id}
                  className={range === item.id ? 'is-active' : ''}
                  onClick={() => { setRange(item.id); setHover(null) }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" className="legend-close" onClick={() => ref.current?.close()} aria-label="关闭历史数据"><X size={14} /></button>
          </header>

          <div className="history-body">
            {status === 'unknown' ? (
              <div className="history-empty">
                <HelpCircle size={22} aria-hidden="true" />
                <b>状态数据不可用</b>
                <span>监控源未返回该项目的数据，暂无可展示的历史记录。</span>
              </div>
            ) : (
              <>
                {history.series.length === 0 && (
                  <p className="history-note">该项目仅监控在线状态，没有数值类历史曲线。</p>
                )}
                {history.series.map((series) => (
                  <SeriesChart key={series.key} series={series} times={history.times} range={range} hover={hover} onHover={setHover} />
                ))}
                <StatusTimeline segments={history.segments} times={history.times} range={range} availability={history.availability} hover={hover} />
              </>
            )}
          </div>

          <footer className="history-foot">
            <span className="demo-dot" aria-hidden="true" />
            演示历史数据，仅用于界面设计；离线与缺失时段留空，不做插值。
          </footer>
        </>
      )}
    </dialog>
  )
}
