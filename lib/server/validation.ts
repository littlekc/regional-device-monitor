import {
  PALETTE_IDS,
  isScalarMetric,
  type ConnectionInput,
  type MonitorProject,
  type MonitorSettings,
  type ProjectMetric,
  type Region,
  type StatusMapping,
} from '../contracts.ts'
import { invalid } from './errors.ts'
import { isIP } from 'node:net'

const types = ['server', 'line', 'router', 'power', 'terminal'] as const
const metricKinds = ['none', 'percent', 'power', 'raw', 'rate', 'traffic', 'resources'] as const
const trafficFields = ['uploadItemId', 'downloadItemId', 'connectionsItemId', 'connectionsScope', 'uploadMax', 'downloadMax'] as const
const resourceFields = ['cpuItemId', 'memoryItemId'] as const
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/
const sourceIdPattern = /^[1-9][0-9]{0,19}$/
const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

export function object(input: unknown, keys: readonly string[], field = 'body'): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid(field)
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid(field, '请求包含未定义字段。')
  return value
}

function text(input: unknown, field: string, max: number): string {
  if (typeof input !== 'string' || input.length > max || /[\u0000-\u001f\u007f]/.test(input)) invalid(field)
  const value = input.trim()
  if (!value) invalid(field)
  return value
}

function optionalText(input: unknown, field: string, max: number): string | undefined {
  return input === undefined ? undefined : text(input, field, max)
}

function choice<const T extends readonly string[]>(input: unknown, field: string, values: T): T[number] {
  if (typeof input !== 'string' || !values.includes(input)) invalid(field)
  return input as T[number]
}

function bool(input: unknown, field: string): boolean {
  if (typeof input !== 'boolean') invalid(field)
  return input
}

export function integer(input: unknown, field: string, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) invalid(field)
  return input
}

function positive(input: unknown, field: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0 || input > 1e18) invalid(field)
  return input
}

export function versionInput(input: unknown): number {
  return integer(input, 'version', 0, Number.MAX_SAFE_INTEGER - 1)
}

export function idInput(input: unknown, field = 'id'): string {
  if (typeof input !== 'string' || !idPattern.test(input)) invalid(field)
  return input
}

export function isSourceId(input: unknown): input is string {
  return typeof input === 'string' && sourceIdPattern.test(input) &&
    (input.length < 20 || input <= '18446744073709551615')
}

export function sourceId(input: unknown, field: string): string {
  if (!isSourceId(input)) invalid(field)
  return input
}

export function isNumeric(input: string): boolean {
  return numericPattern.test(input) && Number.isFinite(Number(input))
}

/** Normalize numeric spellings without rounding large integer counters to the same value. */
export function normalizeStatus(input: string): string {
  const value = input.trim()
  const match = numericPattern.exec(value)
  if (!match) return value
  const [coefficient, rawExponent = '0'] = value.toLowerCase().split('e')
  const exponent = Number(rawExponent)
  if (!Number.isSafeInteger(exponent)) return value
  const negative = coefficient.startsWith('-')
  const [whole, fraction = ''] = coefficient.replace(/^[+-]/, '').split('.')
  const significant = (whole + fraction).replace(/^0+/, '')
  if (!significant) return '0'
  const digits = significant.replace(/0+$/, '')
  const power = exponent - fraction.length + significant.length - digits.length
  if (!Number.isSafeInteger(power)) return value
  const sign = negative ? '-' : ''
  return power === 0 ? sign + digits : sign + digits + 'e' + power
}

function unique<T>(input: unknown, field: string, min: number, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(input) || input.length < min || input.length > max) invalid(field)
  const items = input.map(parse)
  if (new Set(items).size !== items.length) invalid(field, '列表中包含重复值。')
  return items
}

function mapping(input: unknown): StatusMapping {
  const value = object(input, ['online', 'offline'], 'statusMapping')
  const parse = (item: unknown) => text(item, 'statusMapping', 120)
  const online = unique(value.online, 'statusMapping.online', 1, 20, parse)
  const offline = unique(value.offline, 'statusMapping.offline', 0, 20, parse)
  const normalized = [...online, ...offline].map(normalizeStatus)
  if (new Set(normalized).size !== normalized.length) invalid('statusMapping', '在线和离线值不得重复或重叠。')
  return { online, offline }
}

function metricInput(input: unknown, nativeOnly = false): ProjectMetric {
  const { kind } = object(input, ['kind', 'label', 'unit', 'max', 'capacity', ...trafficFields, ...resourceFields], 'metric')
  const mode = choice(kind, 'metric.kind', metricKinds)
  if (mode === 'resources') {
    const value = object(input, ['kind', ...resourceFields], 'metric')
    const cpuItemId = sourceId(value.cpuItemId, 'metric.cpuItemId')
    const memoryItemId = sourceId(value.memoryItemId, 'metric.memoryItemId')
    if (cpuItemId === memoryItemId) invalid('metric.memoryItemId', 'CPU 和内存须使用不同监控项。')
    return { kind: mode, cpuItemId, memoryItemId }
  }
  if (mode === 'traffic') {
    const value = object(input, ['kind', ...trafficFields], 'metric')
    if (nativeOnly && value.uploadItemId === '' && value.downloadItemId === '') {
      return { kind: mode, uploadItemId: '', downloadItemId: '', uploadMax: positive(value.uploadMax, 'metric.uploadMax'), downloadMax: positive(value.downloadMax, 'metric.downloadMax') }
    }
    const uploadItemId = sourceId(value.uploadItemId, 'metric.uploadItemId')
    const downloadItemId = sourceId(value.downloadItemId, 'metric.downloadItemId')
    if (uploadItemId === downloadItemId) invalid('metric.downloadItemId', '上传和下载须使用不同监控项。')
    const rates = {
      kind: mode, uploadItemId, downloadItemId,
      ...(value.uploadMax === undefined ? {} : { uploadMax: positive(value.uploadMax, 'metric.uploadMax') }),
      ...(value.downloadMax === undefined ? {} : { downloadMax: positive(value.downloadMax, 'metric.downloadMax') }),
    } as const
    if (value.connectionsItemId === undefined) {
      if (value.connectionsScope !== undefined) invalid('metric.connectionsScope', '未绑定连接数时请留空。')
      return rates
    }
    const connectionsItemId = sourceId(value.connectionsItemId, 'metric.connectionsItemId')
    if (connectionsItemId === uploadItemId || connectionsItemId === downloadItemId) {
      invalid('metric.connectionsItemId', '连接数须使用独立的监控项。')
    }
    return {
      ...rates, connectionsItemId,
      connectionsScope: choice(value.connectionsScope, 'metric.connectionsScope', ['port', 'host'] as const),
    }
  }
  if (mode === 'none') {
    object(input, ['kind'], 'metric')
    return { kind: mode }
  }
  if (mode === 'percent') {
    const { label: rawLabel, capacity } = object(input, ['kind', 'label', 'capacity'], 'metric')
    const label = optionalText(rawLabel, 'metric.label', 40)
    return {
      kind: mode,
      ...(label === undefined ? {} : { label }),
      ...(capacity === undefined ? {} : { capacity: positive(capacity, 'metric.capacity') }),
    }
  }
  const value = object(input, ['kind', 'label', 'unit', 'max'], 'metric')
  const label = optionalText(value.label, 'metric.label', 40)
  const unit = optionalText(value.unit, 'metric.unit', 24)
  const labels = { ...(label === undefined ? {} : { label }), ...(unit === undefined ? {} : { unit }) }
  if (mode === 'power') return { kind: mode, ...labels, max: positive(value.max, 'metric.max') }
  return { kind: mode, ...labels, ...(value.max === undefined ? {} : { max: positive(value.max, 'metric.max') }) }
}

export function regionInput(input: unknown): Region {
  const value = object(input, ['id', 'name', 'order'], 'region')
  return {
    id: idInput(value.id, 'region.id'),
    name: text(value.name, 'region.name', 64),
    order: integer(value.order, 'region.order', 0, 1_000_000),
  }
}

export function projectInput(input: unknown, nativeOnly = false): MonitorProject {
  const value = object(input, [
    'id', 'name', 'deviceName', 'displayGroup', 'onlineAddress', 'type', 'regionId', 'order', 'hidden', 'allowOffline', 'hostId',
    'statusItemId', 'statusMapping', 'valueItemId', 'metric', 'triggerIds', 'staleAfterSeconds',
  ], 'project')
  const displayGroup = optionalText(value.displayGroup, 'displayGroup', 64)
  const onlineAddress = optionalText(value.onlineAddress, 'onlineAddress', 64)
  if (onlineAddress && !isIP(onlineAddress)) invalid('onlineAddress', '请填写有效的 IP 地址。')
  const metric = metricInput(value.metric, nativeOnly)
  const valueItemId = value.valueItemId === undefined ? undefined : sourceId(value.valueItemId, 'valueItemId')
  const scalar = isScalarMetric(metric.kind)
  if (!scalar && valueItemId) invalid('valueItemId', '此显示模式不使用单项数值绑定。')
  if (scalar && !valueItemId) invalid('valueItemId', '请选择数值监控项。')
  const staleAfterSeconds = value.staleAfterSeconds === undefined
    ? undefined : integer(value.staleAfterSeconds, 'staleAfterSeconds', 5, 604_800)
  return {
    id: idInput(value.id, 'project.id'),
    name: text(value.name, 'project.name', 64),
    ...(displayGroup ? { displayGroup } : {}),
    ...(onlineAddress ? { onlineAddress } : {}),
    ...(value.deviceName ? { deviceName: text(value.deviceName, 'deviceName', 255) } : {}),
    type: choice(value.type, 'type', types),
    regionId: idInput(value.regionId, 'regionId'),
    order: integer(value.order, 'project.order', 0, 1_000_000),
    hidden: bool(value.hidden, 'hidden'),
    allowOffline: bool(value.allowOffline, 'allowOffline'),
    hostId: sourceId(value.hostId, 'hostId'),
    statusItemId: nativeOnly && value.statusItemId === '' ? '' : sourceId(value.statusItemId, 'statusItemId'),
    statusMapping: mapping(value.statusMapping),
    metric,
    triggerIds: unique(value.triggerIds, 'triggerIds', 0, 20, (item) => sourceId(item, 'triggerIds')),
    ...(valueItemId ? { valueItemId } : {}),
    ...(staleAfterSeconds === undefined ? {} : { staleAfterSeconds }),
  }
}

export function settingsInput(input: unknown): MonitorSettings {
  const value = object(input, ['columns', 'gaugeSize', 'palette', 'refreshSeconds'], 'settings')
  return {
    columns: integer(value.columns, 'columns', 1, 16),
    gaugeSize: integer(value.gaugeSize, 'gaugeSize', 50, 160),
    palette: choice(value.palette, 'palette', PALETTE_IDS),
    refreshSeconds: integer(value.refreshSeconds, 'refreshSeconds', 1, 3600),
  }
}

export function connectionInput(input: unknown): ConnectionInput {
  const value = object(input, ['url', 'token', 'clearToken'], 'connection')
  const result: ConnectionInput = {}
  if (value.url !== undefined) {
    if (typeof value.url !== 'string' || value.url.length > 2048 || /[\u0000-\u0020\u007f]/.test(value.url)) invalid('url')
    if (value.url === '') result.url = ''
    else {
      let url: URL
      try { url = new URL(value.url) } catch { invalid('url') }
      if (
        (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password ||
        url.href.includes('?') || url.href.includes('#') || !url.pathname.endsWith('/api_jsonrpc.php')
      ) invalid('url', '请输入 Zabbix API 的 HTTP(S) 地址，结尾应为 /api_jsonrpc.php。')
      result.url = url.href
    }
  }
  if (value.token !== undefined) {
    if (typeof value.token !== 'string' || value.token.length > 512 || /[^\x21-\x7e]/.test(value.token)) invalid('token')
    result.token = value.token
  }
  if (value.clearToken !== undefined) result.clearToken = bool(value.clearToken, 'clearToken')
  if (result.clearToken && result.token) invalid('token', '清除令牌时请留空。')
  return result
}

export function passwordInput(input: unknown, field: string, creating = false): string {
  if (typeof input !== 'string' || input.length < (creating ? 12 : 1) || input.length > 256 || /[\u0000\r\n]/.test(input)) {
    invalid(field, creating ? '新密码长度应为 12–256 个字符。' : '请输入密码。')
  }
  return input
}
