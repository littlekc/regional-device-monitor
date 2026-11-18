import type {
  CatalogHost,
  CatalogItem,
  CatalogPage,
  CatalogTrigger,
  ConnectionResultCode,
  ConnectionTest,
  MonitorProject,
  StatusMapping,
} from '../contracts.ts'
import { resourceItemCandidate } from '../resource-metric.ts'
import { readText } from './body.ts'
import type { StoredConnection } from './database.ts'
import { invalid, MonitorError } from './errors.ts'
import { countItem, numericItem, projectItem, projectItemIds, rateItem } from './measurements.ts'
import { isSourceId } from './validation.ts'
import { WAN_ADDRESS_KEY } from './wan-address.ts'

export { numericItem } from './measurements.ts'

type Data = Record<string, unknown>
type SourceErrorCode = Exclude<ConnectionResultCode, 'success'>

export const SOURCE_MESSAGES: Record<ConnectionResultCode, string> = {
  success: '已访问 Zabbix 主机和可用监控项。',
  connection: '无法完成 Zabbix API 请求。',
  auth: '未通过 Zabbix API 身份验证，请检查令牌。',
  permission: 'Zabbix API 拒绝了读取权限。',
  no_items: '未找到可访问的主机或可用监控项，请检查数据与访问范围。',
}

export class ZabbixError extends Error {
  readonly code: SourceErrorCode
  readonly retryable: boolean

  constructor(code: SourceErrorCode, retryable = false) {
    super(SOURCE_MESSAGES[code])
    this.name = 'ZabbixError'
    this.code = code
    this.retryable = retryable
  }
}

const itemFields = [
  'itemid', 'hostid', 'key_', 'name', 'units', 'value_type', 'lastvalue', 'lastclock',
  'status', 'state', 'error', 'delay', 'master_itemid',
]
const triggerFields = ['triggerid', 'description', 'status', 'state', 'value', 'priority', 'lastchange']
const itemSelection = {
  output: itemFields,
  selectPreprocessing: ['type', 'params'],
  selectValueMap: ['mappings'],
}
const triggerSelection = {
  output: triggerFields,
  selectHosts: ['hostid'],
  selectItems: ['itemid'],
}

function record(input: unknown): Data | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Data : undefined
}

function list(input: unknown): Data[] {
  if (!Array.isArray(input) || input.some((entry) => !record(entry))) throw new ZabbixError('connection')
  return input as Data[]
}

function str(input: unknown): string {
  return typeof input === 'string' || typeof input === 'number' ? String(input) : ''
}

function seconds(input: unknown): number {
  const value = str(input)
  return /^\d{1,13}$/.test(value) ? Number(value) : 0
}

function classifyRpcError(raw: unknown): ZabbixError {
  const error = record(raw)
  const evidence = [str(error?.message), str(error?.data)].join(' ')
  if (/\b(?:no permissions?|permission denied|access denied|not permitted|not allowed|insufficient permissions?)\b/i.test(evidence)) {
    return new ZabbixError('permission')
  }
  if (/\b(?:not authori[sz]ed|not authenticated|re-?login|invalid (?:api )?token|session terminated|session expired)\b/i.test(evidence)) {
    return new ZabbixError('auth')
  }
  return new ZabbixError('connection')
}

function parseItem(row: Data): CatalogItem {
  const masterItemId = decimalId(row.master_itemid)
  const valueMap = record(row.valuemap)?.mappings
  return {
    id: decimalId(row.itemid),
    hostId: decimalId(row.hostid),
    key: str(row.key_),
    name: str(row.name),
    units: str(row.units),
    valueType: numericCode(row.value_type),
    lastValue: str(row.lastvalue),
    lastClock: seconds(row.lastclock),
    status: numericCode(row.status),
    state: numericCode(row.state),
    error: str(row.error),
    delay: str(row.delay),
    ...(masterItemId ? { masterItemId } : {}),
    preprocessing: list(row.preprocessing ?? []).map((step) => ({ type: numericCode(step.type), params: str(step.params) })),
    valueMap: list(valueMap ?? []).map((entry) => ({
      type: numericCode(entry.type), value: str(entry.value), newValue: str(entry.newvalue),
    })),
  }
}

function parseTrigger(row: Data): CatalogTrigger {
  return {
    id: decimalId(row.triggerid),
    name: str(row.description),
    status: numericCode(row.status),
    state: numericCode(row.state),
    value: numericCode(row.value),
    priority: numericCode(row.priority),
    lastChange: seconds(row.lastchange),
    hostIds: list(row.hosts ?? []).map((host) => decimalId(host.hostid)),
    itemIds: list(row.items ?? []).map((item) => decimalId(item.itemid)),
  }
}

function decimalId(raw: unknown): string {
  const value = str(raw)
  return isSourceId(value) ? value : ''
}

function numericCode(raw: unknown): string {
  const value = str(raw)
  return /^\d{1,3}$/.test(value) ? value : ''
}

function search(q: string, idField: 'hostids' | 'itemids' | 'triggerids', fields: string[]): Data {
  if (isSourceId(q)) return { [idField]: [q] }
  return q === '' ? {} : { search: Object.fromEntries(fields.map((field) => [field, q])), searchByAny: true }
}

function page<T>(values: T[], limit: number): CatalogPage<T> {
  return { results: values.slice(0, limit), hasMore: values.length > limit }
}

export function supported(item?: CatalogItem): boolean {
  return item?.status === '0' && item.state === '0'
}

function duration(input: string): number | undefined {
  const match = /^([1-9]\d{0,7})([smhdw])?$/.exec(input.trim())
  if (!match) return
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[match[2] as 's' | 'm' | 'h' | 'd' | 'w'] ?? 1
  return Number(match[1]) * multiplier
}

/** Resolve the slowest interval allowed by each step from the polling item to the stored sample. */
export function effectiveInterval(item: CatalogItem, items: ReadonlyMap<string, CatalogItem>): number | undefined {
  let current: CatalogItem | undefined = item
  let heartbeat = 0
  const seen = new Set<string>()
  while (current && !seen.has(current.id) && supported(current) && current.hostId === item.hostId) {
    seen.add(current.id)
    for (const step of current.preprocessing) {
      if (step.type === '19') return
      if (step.type === '20') {
        const period = duration(step.params)
        if (!period) return
        heartbeat += period
      }
    }
    if (!current.masterItemId) {
      const delay = duration(current.delay)
      if (delay) return delay + heartbeat
      return
    }
    current = items.get(current.masterItemId)
  }
}

export function suggestedStatusMapping(key: string): StatusMapping | undefined {
  if (/^icmpping(?:\[|$)/.test(key)) return { online: ['1'], offline: ['0'] }
  if (key === 'agent.ping') return { online: ['1'], offline: [] }
  if (/^net\.if\.status\[ifOperStatus(?:[.,\]]|$)/.test(key)) return { online: ['1'], offline: ['2', '7'] }
}

export type HistoryEntry = { clock: number; ns: number; value: string }
export const HISTORY_LIMIT = 512
export const SERIES_HISTORY_LIMIT = 12_000
const maxRpcBytes = 4 * 1024 * 1024
const maxBatch = 150
const maxMasterDepth = 8

type RequestOptions = { timeoutMs?: number; retries?: number; signal?: AbortSignal }

export class ZabbixClient {
  private readonly connection: StoredConnection
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly signal?: AbortSignal
  private nextId = 0

  constructor(connection: StoredConnection, options: RequestOptions = {}) {
    this.connection = connection
    this.timeoutMs = options.timeoutMs ?? 2500
    this.retries = options.retries ?? 1
    this.signal = options.signal
  }

  redacted(input: string, limit = 2400): string {
    const { token, url } = this.connection
    const safe = token ? input.split(token).join('[已隐藏]') : input
    return (url ? safe.split(url).join('[已隐藏]') : safe).slice(0, limit)
  }

  private async send(method: string, params: Data, authorized: boolean): Promise<unknown> {
    const { url, token } = this.connection
    if (!url) throw new ZabbixError('connection')
    if (authorized && !token) throw new ZabbixError('auth')
    const id = ++this.nextId
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const headers = { 'content-type': 'application/json-rpc', ...(authorized ? { Authorization: 'Bearer ' + token } : {}) }
    let response: Response
    let raw: string
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
        signal: this.signal ? AbortSignal.any([timeout, this.signal]) : timeout,
        redirect: 'error',
        cache: 'no-store',
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        if (response.status === 401) throw new ZabbixError('auth')
        if (response.status === 403) throw new ZabbixError('permission')
        throw new ZabbixError('connection', response.status >= 500 || response.status === 429)
      }
      raw = await readText(response.body, maxRpcBytes)
    } catch (error) {
      if (error instanceof ZabbixError) throw error
      throw new ZabbixError('connection', !this.signal?.aborted)
    }
    let envelope: Data | undefined
    try { envelope = record(JSON.parse(raw)) } catch { throw new ZabbixError('connection') }
    if (!envelope || envelope.jsonrpc !== '2.0' || envelope.id !== id) throw new ZabbixError('connection')
    if ('error' in envelope) throw classifyRpcError(envelope.error)
    if (!('result' in envelope)) throw new ZabbixError('connection')
    return envelope.result
  }

  private async rpc(method: string, params: Data, authorized = true): Promise<unknown> {
    let retries = this.retries
    while (true) {
      try {
        return await this.send(method, params, authorized)
      } catch (error) {
        if (!(error instanceof ZabbixError) || !error.retryable || retries <= 0 || this.signal?.aborted) throw error
        retries--
      }
    }
  }

  async test(): Promise<ConnectionTest> {
    let version: string | undefined
    let status: ConnectionResultCode
    try {
      const value = await this.rpc('apiinfo.version', {}, false)
      if (typeof value !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[a-z0-9.-]{0,20})?$/i.test(value)) {
        throw new ZabbixError('connection')
      }
      version = value
      const hosts = list(await this.rpc('host.get', { output: ['hostid'], limit: 25 }))
      if (!hosts.length) throw new ZabbixError('no_items')
      const items = list(await this.rpc('item.get', {
        hostids: hosts.map((host) => decimalId(host.hostid)),
        output: ['itemid', 'status', 'state', 'lastclock'],
        filter: { status: 0, state: 0 },
        monitored: true,
        limit: 100,
      }))
      if (!items.some((item) => str(item.status) === '0' && str(item.state) === '0' && seconds(item.lastclock) > 0)) {
        throw new ZabbixError('no_items')
      }
      status = 'success'
    } catch (error) {
      status = error instanceof ZabbixError ? error.code : 'connection'
    }
    return { status, message: SOURCE_MESSAGES[status], ...(version ? { version } : {}) }
  }

  async hostCatalog(q: string, limit: number): Promise<CatalogPage<CatalogHost>> {
    const result = list(await this.rpc('host.get', {
      output: ['hostid', 'host', 'name', 'status'],
      sortfield: ['name', 'hostid'],
      limit: limit + 1,
      ...search(q, 'hostids', ['host', 'name']),
    })).map((row) => ({
      id: decimalId(row.hostid), host: this.redacted(str(row.host)), name: this.redacted(str(row.name)), status: numericCode(row.status),
    }))
    return page(result, limit)
  }

  async itemCatalog(hostId: string, q: string, limit: number): Promise<CatalogPage<CatalogItem>> {
    const rows = list(await this.rpc('item.get', {
      ...itemSelection,
      hostids: [hostId],
      sortfield: ['name', 'itemid'],
      limit: limit + 1,
      ...search(q, 'itemids', ['key_', 'name']),
    })).map(parseItem)
    const result = page(rows, limit)
    const items = await this.withMasterItems(result.results)
    return {
      hasMore: result.hasMore,
      results: result.results.map((item) => ({
        ...item,
        key: this.redacted(item.key),
        name: this.redacted(item.name),
        lastValue: this.redacted(item.lastValue),
        error: this.redacted(item.error),
        units: this.redacted(item.units, 24),
        delay: this.redacted(item.delay),
        preprocessing: item.preprocessing.map((step) => ({ type: step.type, params: this.redacted(step.params) })),
        valueMap: item.valueMap.map((mapping) => ({
          ...mapping, value: this.redacted(mapping.value), newValue: this.redacted(mapping.newValue),
        })),
        effectiveIntervalSeconds: effectiveInterval(item, items),
        suggestedStatusMapping: suggestedStatusMapping(item.key),
      })),
    }
  }

  async triggerCatalog(hostId: string, q: string, limit: number): Promise<CatalogPage<CatalogTrigger>> {
    const rows = list(await this.rpc('trigger.get', {
      ...triggerSelection,
      hostids: [hostId],
      sortfield: ['description', 'triggerid'],
      limit: limit + 1,
      ...search(q, 'triggerids', ['description']),
    })).map(parseTrigger)
    return page(rows.map((trigger) => ({ ...trigger, name: this.redacted(trigger.name) })), limit)
  }

  private async eachBatch<T>(ids: Iterable<string>, load: (ids: string[]) => Promise<T[]>): Promise<T[]> {
    const all = [...new Set(ids)]
    const result: T[] = []
    for (let i = 0; i < all.length; i += maxBatch) {
      result.push(...await load(all.slice(i, i + maxBatch)))
    }
    return result
  }

  private async getItems(ids: Iterable<string>): Promise<CatalogItem[]> {
    return this.eachBatch(ids, async (itemids) =>
      list(await this.rpc('item.get', { ...itemSelection, itemids })).map(parseItem))
  }

  private async withMasterItems(items: CatalogItem[]): Promise<Map<string, CatalogItem>> {
    const index = new Map(items.map((item) => [item.id, item]))
    const seen = new Set(index.keys())
    let current = items
    for (let depth = 0; depth < maxMasterDepth; depth++) {
      const ids = current.flatMap((item) => item.masterItemId && !seen.has(item.masterItemId) ? [item.masterItemId] : [])
      if (!ids.length) break
      for (const id of ids) seen.add(id)
      current = await this.getItems(ids)
      for (const item of current) index.set(item.id, item)
    }
    return index
  }

  async itemIndex(ids: Iterable<string>): Promise<Map<string, CatalogItem>> {
    return this.withMasterItems(await this.getItems(ids))
  }

  async wanAddressItems(hostIds: Iterable<string>): Promise<Map<string, CatalogItem>> {
    const rows = await this.eachBatch(hostIds, async (hostids) => list(await this.rpc('item.get', {
      ...itemSelection, hostids, filter: { key_: WAN_ADDRESS_KEY },
    })).map(parseItem).filter((item) => hostids.includes(item.hostId) && item.key === WAN_ADDRESS_KEY))
    return this.withMasterItems(rows)
  }

  async triggerIndex(ids: Iterable<string>): Promise<Map<string, CatalogTrigger>> {
    const triggers = await this.eachBatch(ids, async (triggerids) =>
      list(await this.rpc('trigger.get', { ...triggerSelection, triggerids })).map(parseTrigger))
    return new Map(triggers.map((trigger) => [trigger.id, trigger]))
  }

  async history(item: CatalogItem, from: number): Promise<{ entries: HistoryEntry[]; truncated: boolean }> {
    return this.historyRows(item, from, item.lastClock, HISTORY_LIMIT, false)
  }

  async historyWindow(item: CatalogItem, from: number, to: number): Promise<{ entries: HistoryEntry[]; truncated: boolean }> {
    return this.historyRows(item, from, to, SERIES_HISTORY_LIMIT, true)
  }

  private async historyRows(
    item: CatalogItem, from: number, to: number, limit: number, lookAhead: boolean,
  ): Promise<{ entries: HistoryEntry[]; truncated: boolean }> {
    if (!['0', '1', '2', '3', '4'].includes(item.valueType)) return { entries: [], truncated: false }
    const rows = list(await this.rpc('history.get', {
      output: ['itemid', 'clock', 'ns', 'value'],
      history: Number(item.valueType),
      itemids: [item.id],
      time_from: from,
      time_till: to,
      sortfield: ['clock', 'ns'],
      sortorder: 'DESC',
      limit: limit + Number(lookAhead),
    }))
    return {
      entries: rows.slice(0, limit).filter((row) => decimalId(row.itemid) === item.id).map((row) => ({
        clock: seconds(row.clock), ns: seconds(row.ns), value: str(row.value),
      })),
      truncated: lookAhead ? rows.length > limit : rows.length >= limit,
    }
  }
}

export function belongsToProject(trigger: CatalogTrigger | undefined, items: ReadonlyMap<string, CatalogItem>, hostId: string): trigger is CatalogTrigger {
  return !!trigger && trigger.hostIds.length > 0 && trigger.hostIds.every((id) => id === hostId) &&
    trigger.itemIds.length > 0 && trigger.itemIds.every((id) => items.get(id)?.hostId === hostId)
}

export async function validateProjectBinding(client: ZabbixClient, project: MonitorProject): Promise<void> {
  const { hostId, statusItemId, valueItemId, triggerIds, metric } = project
  const triggers = await client.triggerIndex(triggerIds)
  const evidenceIds = [...triggers.values()].flatMap((trigger) => trigger.itemIds)
  const items = await client.itemIndex([...projectItemIds(project), ...evidenceIds])
  const status = projectItem(items, statusItemId, hostId)
  if (!status) invalid('statusItemId', '状态监控项不属于所选主机或不可访问。')
  if (metric.kind === 'traffic') {
    if (!rateItem(projectItem(items, metric.uploadItemId, hostId), status, 'upload')) {
      invalid('metric.uploadItemId', '请选择该主机对应接口的上传速率监控项。')
    }
    if (!rateItem(projectItem(items, metric.downloadItemId, hostId), status, 'download')) {
      invalid('metric.downloadItemId', '请选择该主机对应接口的下载速率监控项。')
    }
    if (metric.connectionsItemId && !countItem(projectItem(items, metric.connectionsItemId, hostId), status, metric.connectionsScope)) {
      invalid('metric.connectionsItemId', '请选择与连接统计范围匹配的计数监控项。')
    }
  }
  if (metric.kind === 'resources') {
    if (!resourceItemCandidate(projectItem(items, metric.cpuItemId, hostId), statusItemId)) {
      invalid('metric.cpuItemId', '请选择该主机独立的 CPU 使用率百分比监控项。')
    }
    if (!resourceItemCandidate(projectItem(items, metric.memoryItemId, hostId), statusItemId, metric.cpuItemId)) {
      invalid('metric.memoryItemId', '请选择该主机不同于 CPU 和状态的内存使用率百分比监控项。')
    }
  }
  if (valueItemId) {
    const item = items.get(valueItemId)
    if (item?.hostId !== hostId || !numericItem(item)) invalid('valueItemId', '请选择该主机的数值监控项。')
    if (metric.kind === 'percent' && !metric.capacity && item.units.trim() !== '%') {
      invalid('metric.capacity', '非百分比监控项需要真实容量才能换算为百分比。')
    }
  }
  if (triggerIds.some((id) => !belongsToProject(triggers.get(id), items, hostId))) {
    invalid('triggerIds', '关联的触发器须完全属于所选主机。')
  }
}

export function upstreamError(error: unknown): never {
  if (!(error instanceof ZabbixError)) throw error
  throw new MonitorError(502, 'zabbix_' + error.code, SOURCE_MESSAGES[error.code])
}
