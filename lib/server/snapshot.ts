import type {
  CatalogItem,
  CatalogTrigger,
  MonitorProject,
  MonitorSnapshot,
  SnapshotDevice,
  SourceDiagnostics,
  StatusReason,
} from '../contracts.ts'
import { resourceItemCandidate } from '../resource-metric.ts'
import { WAN_ADDRESS_KEY, wanAddresses } from './wan-address.ts'
import { IkuaiService, ikuaiBinding, type LiveData } from './ikuai.ts'
import {
  statusFingerprint,
  type CheckpointUpdate,
  type DatabaseState,
  type MonitorDatabase,
  type OfflineCheckpoint,
} from './database.ts'
import { canReuseCheckpoint, historyFrom, historyStart, statusMatcher } from './history.ts'
import { countItem, countSample, displayUnit, percentSample, projectItem, projectItemIds, rateItem, rateSample, scalarSample } from './measurements.ts'
import { belongsToProject, effectiveInterval, numericItem, supported, ZabbixClient, ZabbixError } from './zabbix.ts'

const DEFAULT_CACHE_MS = 10_000
const DEFAULT_SOURCE_DEADLINE_MS = 9_000
const HISTORY_CONCURRENCY = 6

type SourceData = {
  diagnostics: SourceDiagnostics
  items: Map<string, CatalogItem>
  triggers: Map<string, CatalogTrigger>
  offlineStarts: Map<string, number>
  redact: (text: string, limit?: number) => string
}

type CacheEntry = {
  revision: number
  controller: AbortController
  flight?: Promise<SourceData>
  data?: SourceData
  expiresAt?: number
}

type Sample = { item?: CatalogItem; ttl?: number; reason?: StatusReason }

function sampleTTL(item: CatalogItem, items: ReadonlyMap<string, CatalogItem>, fallback?: number): number | undefined {
  const interval = effectiveInterval(item, items)
  return interval === undefined ? fallback : interval * 2
}

function sampleReason(item: CatalogItem | undefined, ttl: number | undefined, now: number): StatusReason | undefined {
  if (!item) return 'status_missing'
  if (!supported(item)) return 'status_unsupported'
  if (!item.lastClock) return 'status_missing'
  if (!ttl) return 'status_interval_unknown'
  const seconds = Math.floor(now / 1000)
  if (item.lastClock > seconds || seconds - item.lastClock > ttl) return 'status_stale'
}

function statusSample(project: MonitorProject, items: ReadonlyMap<string, CatalogItem>, now: number): Sample {
  const item = projectItem(items, project.statusItemId, project.hostId)
  const ttl = item && (project.staleAfterSeconds ?? sampleTTL(item, items))
  return { item, ttl, reason: sampleReason(item, ttl, now) }
}

async function runBounded<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (next < items.length) {
      const index = next++
      await work(items[index])
    }
  }))
}

function alarm(project: MonitorProject, data: SourceData, now: number) {
  let available = true
  let active: CatalogTrigger | undefined
  let clock = 0
  for (const id of project.triggerIds) {
    const trigger = data.triggers.get(id)
    if (!belongsToProject(trigger, data.items, project.hostId) ||
      trigger.status !== '0' || trigger.state !== '0' || (trigger.value !== '0' && trigger.value !== '1')) {
      available = false
      continue
    }
    const items = trigger.itemIds.map((itemId) => data.items.get(itemId)!)
    if (items.some((item) => sampleReason(item, sampleTTL(item, data.items, project.staleAfterSeconds), now))) {
      available = false
      continue
    }
    for (const item of items) clock = Math.max(clock, item.lastClock)
    if (trigger.value === '1' && !active) active = trigger
  }
  return { available, active, clock }
}

function milliseconds(seconds?: number): number | undefined {
  return seconds ? seconds * 1000 : undefined
}

function outputDevice(project: MonitorProject, data: SourceData, now: number): SnapshotDevice {
  const status = statusSample(project, data.items, now)
  const observed = status.reason ? undefined : statusMatcher(project)(status.item!.lastValue)
  let reason: StatusReason
  if (data.diagnostics.status === 'not_configured') reason = 'not_configured'
  else if (data.diagnostics.status !== 'ok') reason = 'source_unavailable'
  else reason = status.reason ?? (observed === 'unmapped' ? 'status_unmapped' : observed!)

  const value = projectItem(data.items, project.valueItemId, project.hostId)
  const fault = alarm(project, data, now)
  const reachable = reason === 'online'
  const statusAvailable = reason === 'online' || reason === 'offline'
  const hasFault = statusAvailable && !!fault.active
  const alarmSince = milliseconds(fault.active?.lastChange)
  if (hasFault) reason = 'active_fault'
  else if (reachable && !fault.available) reason = 'trigger_unavailable'

  const max = project.metric.kind === 'percent' ? 100 : 'max' in project.metric ? project.metric.max : undefined
  const unit = displayUnit(project, value)
  const showReading = reachable && reason !== 'trigger_unavailable'
  const fresh = (item: CatalogItem | undefined): item is CatalogItem => !!item && showReading &&
    !sampleReason(item, sampleTTL(item, data.items, project.staleAfterSeconds), now)
  const { metric } = project
  let channels: Partial<SnapshotDevice> = {}
  if (metric.kind === 'traffic') {
    const upload = projectItem(data.items, metric.uploadItemId, project.hostId)
    const download = projectItem(data.items, metric.downloadItemId, project.hostId)
    const count = projectItem(data.items, metric.connectionsItemId, project.hostId)
    const addressTables = [...data.items.values()].filter((item) => item.hostId === project.hostId && item.key === WAN_ADDRESS_KEY)
    const addressTable = addressTables.length === 1 ? addressTables[0] : undefined
    const ips = fresh(addressTable) ? wanAddresses(status.item, addressTable) : undefined
    channels = {
      wanIps: ips,
      wanIpClock: ips === undefined ? undefined : milliseconds(addressTable?.lastClock),
      uploadClock: milliseconds(upload?.lastClock),
      downloadClock: milliseconds(download?.lastClock),
      connectionsClock: milliseconds(count?.lastClock),
      uploadValue: fresh(upload) && rateItem(upload, status.item, 'upload') ? rateSample(upload, upload.lastValue) : undefined,
      downloadValue: fresh(download) && rateItem(download, status.item, 'download') ? rateSample(download, download.lastValue) : undefined,
      connections: metric.connectionsScope && fresh(count) && countItem(count, status.item, metric.connectionsScope)
        ? countSample(count.lastValue) : undefined,
      uploadMax: metric.uploadMax,
      downloadMax: metric.downloadMax,
      connectionsScope: metric.connectionsScope,
    }
  } else if (metric.kind === 'resources') {
    const cpu = projectItem(data.items, metric.cpuItemId, project.hostId)
    const memory = projectItem(data.items, metric.memoryItemId, project.hostId)
    channels = {
      cpuClock: milliseconds(cpu?.lastClock),
      memoryClock: milliseconds(memory?.lastClock),
      cpuValue: fresh(cpu) && resourceItemCandidate(cpu, project.statusItemId, metric.memoryItemId) ? percentSample(cpu.lastValue) : undefined,
      memoryValue: fresh(memory) && resourceItemCandidate(memory, project.statusItemId, metric.cpuItemId) ? percentSample(memory.lastValue) : undefined,
    }
  }
  return {
    id: project.id,
    name: project.name,
    regionId: project.regionId,
    type: project.type,
    order: project.order,
    allowOffline: project.allowOffline,
    ...(project.hidden ? { hidden: true } : {}),
    statusReason: reason,
    statusAvailable: statusAvailable && reason !== 'trigger_unavailable',
    reachable,
    hasFault,
    faultAvailable: fault.available || hasFault,
    faultMessage: hasFault ? data.redact(fault.active!.name, 240) : undefined,
    alarmSince: hasFault && alarmSince !== undefined && alarmSince <= now ? alarmSince : undefined,
    offlineSince: observed === 'offline' ? milliseconds(data.offlineStarts.get(project.id)) : undefined,
    sourceClock: Math.max(milliseconds(Math.max(status.item?.lastClock ?? 0, value?.lastClock ?? 0, fault.clock)) ?? 0,
      channels.uploadClock ?? 0, channels.downloadClock ?? 0, channels.connectionsClock ?? 0,
      channels.cpuClock ?? 0, channels.memoryClock ?? 0, channels.wanIpClock ?? 0) || undefined,
    statusClock: milliseconds(status.item?.lastClock),
    valueClock: milliseconds(value?.lastClock),
    metricKind: project.metric.kind,
    metricLabel: 'label' in project.metric ? project.metric.label : undefined,
    metricUnit: unit ? data.redact(unit.trim(), 24) : undefined,
    metricMax: max,
    metricValue: fresh(value) && numericItem(value) ? scalarSample(project, value, value.lastValue) : undefined,
    ...channels,
  }
}

export class MonitorEngine {
  private readonly db: MonitorDatabase
  private readonly clock: () => number
  private readonly cacheMs: number
  private readonly deadlineMs: number
  private readonly timeoutMs?: number
  private readonly retries?: number
  private cache?: CacheEntry
  private readonly ikuai: IkuaiService

  constructor(db: MonitorDatabase, options: {
    now?: () => number
    cacheMs?: number
    deadlineMs?: number
    timeoutMs?: number
    retries?: number
    ikuai?: IkuaiService
  } = {}) {
    this.db = db
    this.clock = options.now ?? Date.now
    this.cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS
    this.deadlineMs = options.deadlineMs ?? DEFAULT_SOURCE_DEADLINE_MS
    this.timeoutMs = options.timeoutMs
    this.retries = options.retries
    this.ikuai = options.ikuai ?? new IkuaiService({ now: this.clock })
  }

  async read(includeHidden = false): Promise<MonitorSnapshot> {
    let state = this.db.readState()
    // The source revision changes only when a source or binding changes. A concurrent layout
    // edit can immediately reuse this response with refreshed display metadata.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { config } = state
      if (!this.visibleProjects(state, includeHidden).length) {
        return { version: config.version, regions: config.regions, settings: config.settings, devices: [], source: { status: 'empty' }, serverTime: this.clock() }
      }
      // Keep the slower Zabbix refresh independent of the five-second native source. Existing
      // Zabbix samples still undergo normal TTL validation, and failures replace that cache.
      const pending = this.load(state)
      void pending.catch(() => {})
      const visible = this.visibleProjects(state, includeHidden)
      const samples = await Promise.all(state.routers.map(async router => [router.hostId, await this.ikuai.live(router, visible)] as const))
      const native = new Map(samples.filter((entry): entry is readonly [string, LiveData] => !!entry[1]))
      const data = native.size
        ? (this.cache?.revision === state.sourceRevision ? this.cache.data : undefined) ??
          this.emptyData(state, { status: 'unavailable', code: 'connection' })
        : await pending
      const latest = this.db.readState()
      if (latest.sourceRevision === state.sourceRevision) return this.render(latest, includeHidden, data, native)
      state = latest
    }
    return this.render(state, includeHidden, this.emptyData(state, { status: 'unavailable', code: 'connection' }))
  }

  private visibleProjects(state: DatabaseState, includeHidden: boolean): MonitorProject[] {
    return includeHidden ? state.config.projects : state.config.projects.filter((project) => !project.hidden)
  }

  private render(state: DatabaseState, includeHidden: boolean, data: SourceData, native?: Map<string, LiveData>): MonitorSnapshot {
    const serverTime = this.clock()
    const projects = this.visibleProjects(state, includeHidden)
    const groups = new Map<string, string>()
    const devices = projects.map((project) => {
      const deviceGroup = groups.get(project.hostId) ?? project.id
      groups.set(project.hostId, deviceGroup)
      const device = this.ikuai.overlay(state.routers.find(r => r.hostId === project.hostId), project, outputDevice(project, data, serverTime), native?.get(project.hostId))
      return { ...device, deviceGroup: project.displayGroup ? 'group:' + project.displayGroup : deviceGroup,
        deviceName: project.displayGroup ?? project.deviceName, onlineAddress: project.onlineAddress }
    })
    // A cached item can age out before the next API call, so preserve that observed gap.
    this.db.applyCheckpoints(state.sourceRevision, devices
      .filter((device) => device.statusReason === 'status_stale')
      .map((device) => ({ kind: 'invalidate', projectId: device.id })))
    const { version, regions, settings } = state.config
    const checks = Array.from(native?.values() ?? [], live => this.ikuai.diagnostics(live)!)
    const ikuai = checks.length ? { checkedAt: Math.min(...checks.map(c => c.checkedAt)),
      status: checks.every(c => c.status === 'ok') ? 'ok' as const : 'unavailable' as const } : undefined
    return { version, regions, settings, devices, source: projects.length ? { ...data.diagnostics, ...(ikuai ? { ikuai } : {}) } : { status: 'empty' }, serverTime }
  }

  private load(state: DatabaseState): Promise<SourceData> {
    if (this.cache?.revision !== state.sourceRevision) {
      this.cache?.controller.abort()
      this.cache = { revision: state.sourceRevision, controller: new AbortController() }
    }
    const entry = this.cache
    if (entry.data && this.clock() < (entry.expiresAt ?? 0)) return Promise.resolve(entry.data)
    if (entry.flight) return entry.flight
    entry.flight = this.fetch(state, entry.controller.signal).then((data) => {
      entry.data = data
      entry.expiresAt = this.clock() + this.cacheMs
      return data
    }).finally(() => { entry.flight = undefined })
    return entry.flight
  }

  private emptyData(state: DatabaseState, diagnostics: SourceDiagnostics): SourceData {
    const client = new ZabbixClient(state.connection)
    return { diagnostics, items: new Map(), triggers: new Map(), offlineStarts: new Map(), redact: client.redacted.bind(client) }
  }

  private async fetch(state: DatabaseState, obsolete: AbortSignal): Promise<SourceData> {
    const { connection } = state
    if (!connection.url || !connection.token) return this.emptyData(state, { status: 'not_configured' })
    const client = new ZabbixClient(connection, {
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      signal: AbortSignal.any([obsolete, AbortSignal.timeout(this.deadlineMs)]),
    })
    const projects = state.config.projects.filter(p => !state.routers.some(r => ikuaiBinding(r, p)))
    try {
      const triggers = await client.triggerIndex(projects.flatMap((project) => project.triggerIds))
        .catch((error: unknown) => {
          if (!(error instanceof ZabbixError) || obsolete.aborted) throw error
          return new Map<string, CatalogTrigger>()
        })
      const items = await client.itemIndex([
        ...projects.flatMap(projectItemIds),
        ...Array.from(triggers.values(), (trigger) => trigger.itemIds).flat(),
      ])
      // Optional address enrichment shares the snapshot cache. Its absence must not change link status.
      const addressItems = await client.wanAddressItems(projects
        .filter((project) => project.type === 'line' && project.metric.kind === 'traffic')
        .map((project) => project.hostId)).catch(() => new Map<string, CatalogItem>())
      for (const [id, item] of addressItems) if (!items.has(id)) items.set(id, item)
      const checkedAt = this.clock()
      const offlineStarts = await this.offlines(state, client, items, checkedAt, obsolete)
      return { diagnostics: { status: 'ok', checkedAt }, items, triggers, offlineStarts, redact: client.redacted.bind(client) }
    } catch (error) {
      if (!obsolete.aborted) this.db.applyCheckpoints(state.sourceRevision, projects.map(({ id }) => ({ kind: 'invalidate', projectId: id })))
      return this.emptyData(state, {
        status: 'unavailable',
        checkedAt: this.clock(),
        code: error instanceof ZabbixError ? error.code : 'connection',
      })
    }
  }

  private async offlines(
    state: DatabaseState, client: ZabbixClient, items: ReadonlyMap<string, CatalogItem>, now: number, obsolete: AbortSignal,
  ): Promise<Map<string, number>> {
    const starts = new Map<string, number>()
    const previous = this.db.readCheckpoints()
    const updates: CheckpointUpdate[] = []
    const history = new Map<string, ReturnType<ZabbixClient['history']>>()
    await runBounded(state.config.projects, HISTORY_CONCURRENCY, async (project) => {
      if (obsolete.aborted) return
      const sample = statusSample(project, items, now)
      const match = statusMatcher(project)
      if (sample.reason || !sample.item || !sample.ttl) {
        if (previous.has(project.id)) updates.push({ kind: 'invalidate', projectId: project.id })
        return
      }
      const { item, ttl } = sample
      const status = match(item.lastValue)
      if (status !== 'offline') {
        if (previous.has(project.id)) updates.push({ kind: status === 'online' ? 'clear' : 'invalidate', projectId: project.id })
        return
      }
      const fingerprint = statusFingerprint(project)
      const saved = previous.get(project.id)
      const checkpoint = saved?.fingerprint === fingerprint ? saved : undefined
      let start
      if (checkpoint && canReuseCheckpoint(checkpoint, item.lastClock, now, ttl)) {
        start = checkpoint.offlineSince
      } else {
        const from = historyFrom(item.lastClock, ttl)
        const key = item.id + ':' + from
        let request = history.get(key)
        if (!request) {
          request = client.history(item, from)
          history.set(key, request)
        }
        try { start = historyStart(item, await request, ttl, match, checkpoint) } catch { /* Keep status known without a verified duration. */ }
      }
      if (start === undefined) {
        if (previous.has(project.id)) updates.push({ kind: 'invalidate', projectId: project.id })
        return
      }
      starts.set(project.id, start)
      const next: OfflineCheckpoint = {
        projectId: project.id, fingerprint, offlineSince: start,
        lastEvidenceClock: item.lastClock, observedAt: now, needsBridge: false,
      }
      updates.push({ kind: 'record', checkpoint: next })
    })
    if (!obsolete.aborted) this.db.applyCheckpoints(state.sourceRevision, updates)
    return starts
  }
}
