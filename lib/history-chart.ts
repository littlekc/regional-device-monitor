import type { DeviceHistory, HistorySeries } from '@/lib/contracts'
import { rateMultiplier } from '@/lib/traffic-catalog'

type ChartAxis = { unit: string; divisor: number; min?: number; max?: number }

function chartAxis(series: HistorySeries[], unit: string, rate = false): ChartAxis {
  const multiplier = rate ? rateMultiplier(unit) : undefined
  const scale = multiplier === undefined ? { unit, divisor: 1 } : { unit: 'Mbps', divisor: 1_000_000 / multiplier }
  const values = series.flatMap(({ values }) => values.filter((value): value is number => value !== null && Number.isFinite(value)))
  if (!values.length) return scale
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values) || (min === 0 ? 1 : 0)
  return { min, max, ...scale }
}

export function buildHistoryAxes(metric: DeviceHistory['metricKind'], series: HistorySeries[]) {
  if (metric === 'resources') return { left: { unit: '%', divisor: 1, min: 0, max: 100 } }
  if (metric === 'traffic') return {
    left: chartAxis(series.filter(({ role }) => role === 'rate'), 'bps', true),
    right: chartAxis(series.filter(({ role }) => role === 'count'), '个'),
  }
  const scalar = series.find(({ role }) => role === 'value')
  return { left: chartAxis(scalar ? [scalar] : [], scalar?.unit ?? '', metric === 'rate' || scalar?.unit === 'bps') }
}

type Point = { index: number; value: number }

export function historySegments({ values, breaks }: Pick<HistorySeries, 'values' | 'breaks'>): Point[][] {
  const segments: Point[][] = []
  let current: Point[] | undefined
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      current = undefined
      return
    }
    if (!current || breaks[index]) {
      current = []
      segments.push(current)
    }
    current.push({ index, value })
  })
  return segments
}
