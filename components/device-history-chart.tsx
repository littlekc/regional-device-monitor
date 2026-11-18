'use client'

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { DeviceHistory, HistorySeries } from '@/lib/contracts'
import { buildHistoryAxes, historySegments } from '@/lib/history-chart'
import { connectionsLabel, formatRate, formatSampleTime } from '@/lib/monitor-data'
import { rateMultiplier } from '@/lib/traffic-catalog'

const coverageLabel = { complete: '完整', partial: '部分', empty: '无采样', unavailable: '不可用' }
const connectivityLabel = { online: '在线观测', offline: '离线观测', mixed: '同段有在线及离线观测' }
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 4, useGrouping: false })

function tickValue(value: number) {
  const magnitude = Math.abs(value)
  return magnitude >= 10000 || (magnitude > 0 && magnitude < 0.001) ? value.toExponential(1) : numberFormat.format(value)
}

function tickTime(clock: number, range: DeviceHistory['range']) {
  const date = new Date(clock)
  const day = `${date.getMonth() + 1}/${date.getDate()}`
  return range === '7d' ? day : range === '1h' ? timeFormat.format(date) : `${day} ${timeFormat.format(date)}`
}

function displayValue(value: number, series: HistorySeries) {
  if (series.unit === 'ms') return `${Math.round(value)} ms`
  const multiplier = rateMultiplier(series.unit)
  if (multiplier !== undefined) {
    const rate = formatRate(value * multiplier)
    return `${rate.value} ${rate.unit}`
  }
  return `${numberFormat.format(value)}${series.unit ? ` ${series.unit}` : ''}`
}

function SeriesStats({ series }: { series: HistorySeries }) {
  const { summary } = series
  return (
    <section className={`history-stat series-${series.key}`} aria-label={`${series.label}的历史采样统计`}>
      <h3><i className="series-mark" aria-hidden="true" />{series.label}<small>覆盖：{coverageLabel[series.coverage]}</small></h3>
      {summary ? (
        <dl>
          <div><dt>最低</dt><dd>{displayValue(summary.min, series)}</dd></div>
          <div><dt>平均</dt><dd>{displayValue(summary.average, series)}</dd></div>
          <div><dt>最高</dt><dd title={`最高采样 ${formatSampleTime(summary.peakClock)}`}>{displayValue(summary.max, series)}</dd></div>
          <div><dt>有效样本</dt><dd>{summary.sampleCount}</dd></div>
        </dl>
      ) : <p>没有可统计的样本</p>}
    </section>
  )
}

export function DeviceHistoryChart({ history }: { history: DeviceHistory }) {
  const [hidden, setHidden] = useState<HistorySeries['key'][]>([])
  const [cursor, setCursor] = useState<number>()
  const [width, setWidth] = useState(640)
  const plotRef = useRef<SVGSVGElement>(null)
  const { series, timestamps, connectivity, metricKind, from, to, bucketMs } = history
  const axes = useMemo(() => buildHistoryAxes(metricKind, series), [metricKind, series])
  const visible = series.filter(({ key }) => !hidden.includes(key))
  const hasConnectivity = connectivity.values.some((value) => value !== null)
  const hasNumeric = series.some(({ values }) => values.some((value) => value !== null))
  const hasPlot = timestamps.length > 0 && (hasNumeric || hasConnectivity)

  useEffect(() => {
    const svg = plotRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(220, Math.round(entry.contentRect.width))))
    observer.observe(svg)
    return () => observer.disconnect()
  }, [hasPlot])

  const axisLeft = series.length ? 53 : 8
  const axisRight = width - (axes.right ? 53 : 8)
  const innerWidth = axisRight - axisLeft
  const top = 25
  const bottom = hasNumeric ? 153 : 20
  const timelineY = bottom + (hasNumeric ? 12 : 0)
  const timeLabelY = hasConnectivity ? timelineY + 28 : bottom + 20
  const height = timeLabelY + 5
  const bucketWidth = innerWidth / timestamps.length
  const pointX = (index: number) => axisLeft + (index + 0.5) * bucketWidth
  const currentIndex = cursor ?? timestamps.length - 1
  const bucketStart = timestamps[currentIndex]
  const state = connectivity.values[currentIndex]
  const cursorTime = bucketStart === undefined ? '' : `${formatSampleTime(bucketStart)} 至 ${formatSampleTime(Math.min(bucketStart + bucketMs, to))}`
  const cursorText = visible.map((entry) => {
    const value = entry.values[currentIndex]
    return `${entry.label} ${value == null ? '无采样' : displayValue(value, entry)}`
  })
  const countLabel = connectionsLabel(series.find(({ key }) => key === 'connections')?.connectionsScope)
  const plotLabel = metricKind === 'traffic' ? '流量历史图，左轴为速率，右轴为连接数，下方为时间'
    : metricKind === 'resources' ? 'CPU 和内存使用率历史图，纵轴为 0–100%，横轴为时间' : '监控历史图，横轴为时间'

  function moveCursor(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * width
    setCursor(Math.max(0, Math.min(timestamps.length - 1, Math.floor((x - axisLeft) / bucketWidth))))
  }

  return (
    <>
      {series.length > 0 && <div className="history-legend" role="group" aria-label="历史曲线">
        {series.map((entry) => (
          <button key={entry.key} type="button" className={`series-${entry.key}`} aria-pressed={!hidden.includes(entry.key)}
            onClick={() => setHidden((current) => current.includes(entry.key) ? current.filter((key) => key !== entry.key) : [...current, entry.key])}>
            <i className="series-mark" aria-hidden="true" />{entry.label}
          </button>
        ))}
        {history.source.notes.includes('connections_unbound') && <span>连接数 — 未绑定</span>}
      </div>}
      {hasPlot && (
        <div className="history-chart">
          <svg ref={plotRef} className="history-plot" viewBox={`0 0 ${width} ${height}`} width={width} height={height}
            role="img" aria-label={plotLabel}
            onPointerMove={moveCursor} onPointerDown={moveCursor}>
            {series.length > 0 && (
              <text className="axis-caption" x={6} y={13}>
                {metricKind === 'traffic' ? `速率（${axes.left.unit}）` : axes.left.unit || '数值'}
              </text>
            )}
            {axes.right && <text className="axis-caption" x={width - 6} y={13} textAnchor="end">{countLabel}（{axes.right.unit}）</text>}
            {hasNumeric && [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
              const y = bottom - fraction * (bottom - top)
              const tick = (axis: typeof axes.left) => axis.min !== undefined && axis.max !== undefined
                ? tickValue((axis.min * (1 - fraction) + axis.max * fraction) / axis.divisor) : '—'
              return <g key={fraction}>
                <line className="plot-grid" x1={axisLeft} x2={axisRight} y1={y} y2={y} />
                <text x={axisLeft - 6} y={y} dy=".32em" textAnchor="end">{tick(axes.left)}</text>
                {axes.right && <text x={axisRight + 6} y={y} dy=".32em">{tick(axes.right)}</text>}
              </g>
            })}
            {visible.map((entry) => {
              const axis = entry.role === 'count' ? axes.right : axes.left
              if (axis?.max === undefined || axis.min === undefined) return null
              const { min, max } = axis
              const scale = Math.max(Math.abs(min), Math.abs(max))
              const pointY = (value: number) => bottom - ((value / scale - min / scale) / (max / scale - min / scale)) * (bottom - top)
              return <g key={entry.key} className={`series-${entry.key}`}>
                {historySegments(entry).map((segment) => segment.length === 1
                  ? <circle className="plot-point" key={segment[0].index} cx={pointX(segment[0].index)} cy={pointY(segment[0].value)} r={2.6} />
                  : <polyline className="plot-line" key={segment[0].index} points={segment.map(({ index, value }) => `${pointX(index).toFixed(2)},${pointY(value).toFixed(2)}`).join(' ')} />)}
              </g>
            })}
            {hasConnectivity && connectivity.values.map((value, index) => {
              if (!value) return null
              const seam = connectivity.breaks[index] ? Math.min(1, bucketWidth / 2) : 0
              return <rect className={`plot-state state-${value}`} key={index} x={axisLeft + index * bucketWidth + seam} y={timelineY} width={bucketWidth - seam} height={9} />
            })}
            {[0, 0.5, 1].map((fraction) => <text className="plot-time" key={fraction}
              x={axisLeft + fraction * innerWidth} y={timeLabelY} textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}>
              {tickTime(from + (to - from) * fraction, history.range)}
            </text>)}
            <line className="plot-cursor" x1={pointX(currentIndex)} x2={pointX(currentIndex)} y1={hasNumeric ? top : timelineY - 5} y2={hasConnectivity ? timelineY + 9 : bottom} />
          </svg>
          <label className="history-cursor">
            <span>时间游标</span>
            <input type="range" min={0} max={timestamps.length - 1} value={currentIndex} onChange={(event) => setCursor(Number(event.target.value))}
              aria-valuetext={[cursorTime, ...cursorText, ...(hasConnectivity ? [state ? connectivityLabel[state] : '无连通性观测'] : [])].join('，')} />
          </label>
          <div className="history-cursor-data">
            <span>{cursorTime}</span>
            {visible.map((entry, index) => <span key={entry.key} className={`series-${entry.key}`} title={entry.sampleClocks[currentIndex] == null ? undefined : `末次采样 ${formatSampleTime(entry.sampleClocks[currentIndex]!)}`}><i className="series-mark" aria-hidden="true" />{cursorText[index]}</span>)}
            {hasConnectivity && <span>{state ? connectivityLabel[state] : '无连通性观测'}</span>}
          </div>
        </div>
      )}
      {hasConnectivity && <div className="history-connectivity">
        <span><i className="plot-state state-online" />在线观测</span><span><i className="plot-state state-offline" />离线观测</span><span><i className="plot-state state-mixed" />同段混合</span>
        <span>连通性覆盖：{coverageLabel[connectivity.coverage]}。仅表示状态采样，不代表历史告警或可用率。</span>
      </div>}
      {visible.length > 0 && <div className="history-stat-grid">{visible.map((entry) => <SeriesStats key={entry.key} series={entry} />)}</div>}
    </>
  )
}
