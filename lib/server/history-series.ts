import type {
  CatalogItem, DeviceHistory, HistoryConnectivity, HistoryCoverage, HistoryNote, HistoryRange, HistorySeries,
  HistorySummary, MonitorProject,
} from '../contracts.ts'
import { resourceItemCandidate } from '../resource-metric.ts'
import type { DatabaseState, MonitorDatabase } from './database.ts'
import { MonitorError } from './errors.ts'
import { statusMatcher } from './history.ts'
import { countItem, countSample, displayUnit, numericItem, percentSample, projectItem, projectItemIds, rateItem, rateSample, scalarSample } from './measurements.ts'
import { effectiveInterval, ZabbixClient, ZabbixError } from './zabbix.ts'
import { IkuaiService, ikuaiBinding } from './ikuai.ts'

const ranges: Record<HistoryRange, [durationSeconds: number, bucketSeconds: number]> = {
  '1h': [3600, 60],
  '24h': [86400, 300],
  '7d': [604800, 1800],
}
const cacheMs = 10_000
const maxEntries = 96
const maxFlights = 12
type Window = Pick<DeviceHistory, 'from' | 'to' | 'bucketMs' | 'timestamps'>
type Payload = Omit<DeviceHistory, 'version'>
type SeriesMeta = Pick<HistorySeries, 'key' | 'role' | 'label' | 'unit' | 'connectionsScope'>
type HistoryRows = Awaited<ReturnType<ZabbixClient['historyWindow']>>
type Point<T> = { clock: number; value: T }
type CacheEntry = {
  controller: AbortController
  flight?: Promise<Payload>
  cached?: Payload
  expiresAt?: number
}

function windowFor(range: HistoryRange, now: number): Window {
  const [seconds, bucketSeconds] = ranges[range]
  const to = Math.floor(now / 1000) * 1000
  const from = to - seconds * 1000
  const bucketMs = bucketSeconds * 1000
  return { from, to, bucketMs, timestamps: Array.from({ length: seconds / bucketSeconds }, (_, i) => from + i * bucketMs) }
}

function bucketIndex(clock: number, window: Window): number {
  return Math.min(window.timestamps.length - 1, Math.floor((clock - window.from) / window.bucketMs))
}

function samples<T>(
  rows: HistoryRows | undefined, window: Window, ttlMs: number | undefined, parse: (raw: string) => T | undefined,
  combine: (values: T[]) => T,
) {
  const values: (T | null)[] = window.timestamps.map(() => null)
  const sampleClocks: (number | null)[] = window.timestamps.map(() => null)
  const breaks = window.timestamps.map(() => false)
  const points: Point<T>[] = []
  const truncated = rows?.truncated ?? false
  let coverage: HistoryCoverage = rows ? 'empty' : 'unavailable'
  if (!rows) return { values, sampleClocks, breaks, coverage, truncated, points }

  let gaps = truncated || ttlMs === undefined
  let bucket: T[] = []
  let index = -1
  let lastClock: number | undefined
  let unknown = false
  for (const row of rows.entries.sort((a, b) => a.clock - b.clock || a.ns - b.ns)) {
    const clock = row.clock * 1000 + Math.floor(row.ns / 1e6)
    const value = parse(row.value)
    if (row.clock <= 0 || row.ns >= 1e9 || clock < window.from || clock > window.to || value === undefined) {
      gaps = true
      unknown = true
      continue
    }
    const next = bucketIndex(clock, window)
    const gap = lastClock === undefined ? clock - window.from > (ttlMs ?? 0)
      : ttlMs === undefined || clock - lastClock > ttlMs || unknown
    gaps ||= gap
    if (lastClock !== undefined && (gap || next > index + 1)) breaks[next] = true
    if (next !== index) {
      if (index >= 0) values[index] = combine(bucket)
      bucket = []
      index = next
    }
    bucket.push(value)
    points.push({ clock, value })
    sampleClocks[next] = clock
    lastClock = clock
    unknown = false
  }
  if (index >= 0) {
    values[index] = combine(bucket)
    if (window.to - lastClock! > (ttlMs ?? 0)) gaps = true
    coverage = gaps || values.includes(null) ? 'partial' : 'complete'
  } else if (rows.entries.length || truncated) {
    coverage = 'partial'
  }
  return { values, sampleClocks, breaks, coverage, truncated, points }
}

function average(values: readonly number[]): number {
  const sum = values.reduce((total, value) => total + value, 0)
  // Dividing each term first prevents overflow for large finite samples.
  return Number.isFinite(sum) ? sum / values.length : values.reduce((total, value) => total + value / values.length, 0)
}

function summary(points: Point<number>[]): HistorySummary | undefined {
  const first = points[0]
  if (!first) return
  let min = first.value
  let max = first
  for (const point of points) {
    min = Math.min(point.value, min)
    if (point.value > max.value) max = point
  }
  return {
    min, max: max.value, average: average(points.map(({ value }) => value)), sampleCount: points.length,
    firstClock: first.clock, lastClock: points[points.length - 1].clock, peakClock: max.clock,
  }
}

function numericSeries(
  meta: SeriesMeta, rows: HistoryRows | undefined, window: Window, ttl: number | undefined,
  parse: (raw: string) => number | undefined,
): HistorySeries {
  const { points, ...fields } = samples(rows, window, ttl, parse, average)
  return { ...meta, ...fields, summary: summary(points) }
}

function connectivity(
  project: MonitorProject, rows: HistoryRows | undefined, window: Window, ttl: number | undefined,
): HistoryConnectivity {
  const match = statusMatcher(project)
  type State = NonNullable<HistoryConnectivity['values'][number]>
  const { points: _points, ...fields } = samples<State>(rows, window, ttl, (raw) => {
    const state = match(raw)
    return state === 'unmapped' ? undefined : state
  }, (values) => values.some((value) => value !== values[0]) ? 'mixed' : values[0])
  return { role: 'connectivity', ...fields }
}

function visibleProject(state: DatabaseState, projectId: string): MonitorProject {
  const project = state.config.projects.find((candidate) => candidate.id === projectId && !candidate.hidden)
  if (!project) throw new MonitorError(404, 'not_found', '找不到指定记录。')
  return project
}

function busy(): never {
  throw new MonitorError(503, 'history_busy', '历史数据暂时无法读取，请稍后重试。')
}

// Config version also changes for layout edits. Include metric settings that change rendered history,
// without discarding recent reads solely because cards were reordered or renamed.
function metricKey(project: MonitorProject): string {
  return JSON.stringify(project.metric)
}

export class HistoryService {
  private readonly db: MonitorDatabase
  private readonly now: () => number
  private readonly timeoutMs?: number
  private readonly cache = new Map<string, CacheEntry>()
  private revision?: number
  private readonly ikuai: IkuaiService
  constructor(db: MonitorDatabase, now: () => number, timeoutMs?: number, ikuai?: IkuaiService) {
    this.db = db
    this.now = now
    this.timeoutMs = timeoutMs
    this.ikuai = ikuai ?? new IkuaiService({ now })
  }

  async read(projectId: string, range: HistoryRange): Promise<DeviceHistory> {
    let state = this.db.readState()
    for (let attempt = 0; attempt < 4; attempt++) {
      const project = visibleProject(state, projectId)
      const payload = await this.load(state, project, range)
      const latest = this.db.readState()
      const current = visibleProject(latest, projectId)
      if (latest.sourceRevision === state.sourceRevision && metricKey(project) === metricKey(current)) {
        return { ...payload, version: latest.config.version }
      }
      state = latest
    }
    return busy()
  }

  private load(state: DatabaseState, project: MonitorProject, range: HistoryRange): Promise<Payload> {
    if (state.sourceRevision !== this.revision) {
      for (const entry of this.cache.values()) entry.controller.abort()
      this.cache.clear()
      this.revision = state.sourceRevision
    }
    const now = this.now()
    for (const [key, entry] of this.cache) {
      if (!entry.flight && now >= (entry.expiresAt ?? 0)) this.cache.delete(key)
    }
    const key = JSON.stringify([project.id, range, metricKey(project)])
    const previous = this.cache.get(key)
    if (previous?.flight) return previous.flight
    if (previous?.cached) return Promise.resolve(previous.cached)
    if ([...this.cache.values()].filter((entry) => entry.flight).length >= maxFlights) return busy()
    if (this.cache.size >= maxEntries) {
      for (const [key, entry] of this.cache) {
        if (!entry.flight) {
          this.cache.delete(key)
          break
        }
      }
    }
    const entry: CacheEntry = { controller: new AbortController() }
    entry.flight = this.fetch(state, project, range, now, entry.controller.signal).then((payload) => {
      entry.cached = payload
      entry.expiresAt = this.now() + cacheMs
      return payload
    }).finally(() => { entry.flight = undefined })
    this.cache.set(key, entry)
    return entry.flight
  }

  private async fetch(
    state: DatabaseState, project: MonitorProject, range: HistoryRange, now: number, obsolete: AbortSignal,
  ): Promise<Payload> {
    const window = windowFor(range, now)
    const router = state.routers.find(r => r.hostId === project.hostId)
    const nativeBinding = ikuaiBinding(router, project)
    if (!project.statusItemId) throw new MonitorError(404, 'not_found', '此直连接口仅提供实时读数。')
    if (nativeBinding?.kind === 'resources') return this.nativeResources(router!, project, range, window)
    const configured = Boolean(state.connection.url && state.connection.token)
    const client = new ZabbixClient(state.connection, {
      timeoutMs: this.timeoutMs,
      retries: 0,
      signal: AbortSignal.any([obsolete, AbortSignal.timeout(9000)]),
    })
    const items = configured
      ? await client.itemIndex(projectItemIds(project)).catch((error: unknown) => {
        if (error instanceof ZabbixError) return new Map<string, CatalogItem>()
        throw error
      })
      : new Map<string, CatalogItem>()
    const find = (id?: string) => projectItem(items, id, project.hostId)
    const status = find(project.statusItemId)
    const ttl = (item?: CatalogItem, isStatus = false) => {
      if (!item) return
      const interval = effectiveInterval(item, items)
      const seconds = isStatus && project.staleAfterSeconds !== undefined ? project.staleAfterSeconds
        : interval === undefined ? project.staleAfterSeconds : 2 * interval
      return seconds === undefined ? undefined : seconds * 1000
    }
    const rows = new Map<string, Promise<HistoryRows | undefined>>()
    const read = (item?: CatalogItem): Promise<HistoryRows | undefined> => {
      if (!item || !['0', '1', '2', '3', '4'].includes(item.valueType)) return Promise.resolve(undefined)
      let pending = rows.get(item.id)
      if (!pending) {
        pending = client.historyWindow(item, Math.max(1, window.from / 1000), window.to / 1000).catch((error: unknown) => {
          if (error instanceof ZabbixError) return undefined
          throw error
        })
        rows.set(item.id, pending)
      }
      return pending
    }
    const result = async (meta: SeriesMeta, item: CatalogItem | undefined, parse: (raw: string) => number | undefined) =>
      numericSeries(meta, await read(item), window, ttl(item), parse)

    const link = read(status).then((data) => connectivity(project, data, window, ttl(status, true)))
    const { metric } = project
    const requests: Promise<HistorySeries>[] = []
    if (metric.kind === 'traffic') {
      const upload = find(metric.uploadItemId)
      const download = find(metric.downloadItemId)
      requests.push(
        result({ key: 'upload', role: 'rate', label: '上传', unit: 'bps' },
          rateItem(upload, status, 'upload') ? upload : undefined, (raw) => upload && rateSample(upload, raw)),
        result({ key: 'download', role: 'rate', label: '下载', unit: 'bps' },
          rateItem(download, status, 'download') ? download : undefined, (raw) => download && rateSample(download, raw)),
      )
      if (metric.connectionsItemId) {
        const count = find(metric.connectionsItemId)
        requests.push(result({
          key: 'connections', role: 'count', label: metric.connectionsScope === 'port' ? '端口连接数' : '主机连接数',
          unit: '个', connectionsScope: metric.connectionsScope,
        }, countItem(count, status, metric.connectionsScope) ? count : undefined, countSample))
      }
    } else if (metric.kind === 'resources') {
      const cpu = find(metric.cpuItemId)
      const memory = find(metric.memoryItemId)
      requests.push(
        result({ key: 'cpu', role: 'value', label: 'CPU', unit: '%' },
          resourceItemCandidate(cpu, project.statusItemId, metric.memoryItemId) ? cpu : undefined, percentSample),
        result({ key: 'memory', role: 'value', label: '内存', unit: '%' },
          resourceItemCandidate(memory, project.statusItemId, metric.cpuItemId) ? memory : undefined, percentSample),
      )
    } else if (metric.kind !== 'none') {
      const value = find(project.valueItemId)
      requests.push(result({
        key: 'value', role: 'value', label: client.redacted(metric.label ?? '数值', 40),
        unit: client.redacted(displayUnit(project, value)?.trim() ?? '', 24),
      }, value && numericItem(value) ? value : undefined, (raw) => value && scalarSample(project, value, raw)))
    }

    const [series, links] = await Promise.all([Promise.all(requests), link])
    const channels = [...series, links]
    const unavailable = channels.some((channel) => channel.coverage === 'unavailable')
    const notedGaps = channels.some((channel) => channel.coverage === 'partial')
    const hasSamples = channels.some((channel) => channel.sampleClocks.some((clock) => clock !== null))
    const notes: HistoryNote[] = []
    if (notedGaps || (hasSamples && channels.some((channel) => channel.coverage === 'empty'))) notes.push('gaps')
    if (channels.some((channel) => channel.truncated)) notes.push('truncated')
    if (configured && unavailable) notes.push('unavailable')
    if (metric.kind === 'traffic' && !metric.connectionsItemId) notes.push('connections_unbound')
    if (nativeBinding) notes.push('ikuai_live_only')
    const availability = !configured ? 'not_configured' : !hasSamples
      ? unavailable ? 'unavailable' : notedGaps ? 'partial' : 'empty'
      : channels.every((channel) => channel.coverage === 'complete') ? 'ok' : 'partial'
    return {
      ...window, projectId: project.id, range, metricKind: metric.kind, series, connectivity: links,
      source: { status: availability, checkedAt: this.now(), notes, ...(nativeBinding ? { provider: 'zabbix' as const } : {}) },
    }
  }

  private async nativeResources(router: DatabaseState['routers'][number], project: MonitorProject, range: HistoryRange, window: Window): Promise<Payload> {
    const datetype = { '1h': 'hour', '24h': 'day', '7d': 'week' }[range]
    const end = Math.floor(window.to / 60000) * 60
    const query = new URLSearchParams({ datetype, start_time: String(end - ranges[range][0]), end_time: String(end), math: 'avg' })
    const read = async (key: 'cpu' | 'memory'): Promise<HistoryRows | undefined> => {
      const result = await this.ikuai.read(router, '/api/v4.0/monitoring/' + key + '?' + query, 10_000)
      const data = result.data?.[key]
      if (!result.ok || !Array.isArray(data)) return
      return { truncated: false, entries: data.filter(row => row && Number.isSafeInteger(row.timestamp))
        .map(row => ({ clock: row.timestamp, ns: 0, value: String(row[key === 'cpu' ? 'cpu' : 'memory_use'] ?? '') })) }
    }
    const [cpu, memory] = await Promise.all([read('cpu'), read('memory')])
    const series = [
      numericSeries({ key: 'cpu', role: 'value', label: 'CPU', unit: '%' }, cpu, window, 120000, percentSample),
      numericSeries({ key: 'memory', role: 'value', label: '内存', unit: '%' }, memory, window, 120000, percentSample),
    ]
    const hasSamples = series.some(s => s.summary)
    const notes: HistoryNote[] = ['connectivity_unavailable', 'router_retention']
    if (!cpu || !memory) notes.push('unavailable')
    if (series.some(s => s.coverage !== 'complete')) notes.push('gaps')
    return { ...window, projectId: project.id, range, metricKind: project.metric.kind, series,
      connectivity: connectivity(project, undefined, window, undefined),
      source: { provider: 'ikuai', status: !hasSamples ? !cpu || !memory ? 'unavailable' : 'empty' : 'partial', checkedAt: this.now(), notes } }
  }
}
