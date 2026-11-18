export type DeviceType = 'server' | 'line' | 'router' | 'power' | 'terminal' | 'battery'
export type Region = { id: string; name: string; order: number }

export const PALETTE_IDS = ['harbor', 'titanium', 'jade'] as const
export type PaletteId = (typeof PALETTE_IDS)[number]

export type MonitorSettings = {
  columns: number
  gaugeSize: number
  palette: PaletteId
  refreshSeconds: number
}

export const DEFAULT_SETTINGS: MonitorSettings = {
  columns: 8,
  gaugeSize: 100,
  palette: 'harbor',
  refreshSeconds: 5,
}

export type ConnectionsScope = 'host' | 'port'
export type TrafficMetric = {
  kind: 'traffic'
  uploadItemId: string
  downloadItemId: string
  uploadMax?: number
  downloadMax?: number
} & ({ connectionsItemId?: undefined; connectionsScope?: undefined } | {
  connectionsItemId: string
  connectionsScope: ConnectionsScope
})

export type ResourcesMetric = { kind: 'resources'; cpuItemId: string; memoryItemId: string }

export type ProjectMetric =
  | { kind: 'none' }
  | { kind: 'percent'; label?: string; capacity?: number }
  | { kind: 'power'; label?: string; unit?: string; max: number }
  | { kind: 'raw' | 'rate'; label?: string; unit?: string; max?: number }
  | TrafficMetric
  | ResourcesMetric

export function isScalarMetric(kind: ProjectMetric['kind']): boolean {
  return kind === 'percent' || kind === 'power' || kind === 'raw' || kind === 'rate'
}

export type StatusMapping = { online: string[]; offline: string[] }
export type MonitorProject = {
  displayGroup?: string
  onlineAddress?: string
  deviceName?: string
  id: string
  name: string
  type: DeviceType
  regionId: string
  order: number
  hidden: boolean
  allowOffline: boolean
  hostId: string
  statusItemId: string
  statusMapping: StatusMapping
  valueItemId?: string
  metric: ProjectMetric
  triggerIds: string[]
  staleAfterSeconds?: number
}

export type ConnectionConfig = { url: string; tokenConfigured: boolean }
export type ConnectionInput = { url?: string; token?: string; clearToken?: boolean }
export type MonitorConfig = {
  version: number
  regions: Region[]
  projects: MonitorProject[]
  settings: MonitorSettings
  connection: ConnectionConfig
  routers?: Array<{ url: string; hostId: string; tokenConfigured: boolean; bindings: { projectId: string; statusItemId: string; kind: 'traffic' | 'resources'; interface?: string }[] }>
}

export type StatusReason =
  | 'online'
  | 'offline'
  | 'active_fault'
  | 'not_configured'
  | 'source_unavailable'
  | 'status_missing'
  | 'status_unsupported'
  | 'status_stale'
  | 'status_interval_unknown'
  | 'interface_missing'
  | 'link_check_failed'
  | 'status_unmapped'
  | 'trigger_unavailable'

export type SnapshotDevice = {
  onlineAddress?: string
  deviceGroup?: string
  deviceName?: string
  liveSource?: 'ikuai'
  clockBasis?: 'received'
  id: string
  name: string
  regionId: string
  type: DeviceType
  order: number
  hidden?: boolean
  allowOffline: boolean
  reachable: boolean
  statusAvailable: boolean
  hasFault: boolean
  faultAvailable: boolean
  faultMessage?: string
  statusReason: StatusReason
  sourceClock?: number
  statusClock?: number
  valueClock?: number
  alarmSince?: number
  offlineSince?: number
  metricKind: ProjectMetric['kind']
  metricLabel?: string
  metricValue?: number
  metricUnit?: string
  metricMax?: number
  cpuValue?: number
  memoryValue?: number
  cpuClock?: number
  memoryClock?: number
  uploadValue?: number
  downloadValue?: number
  connections?: number
  uploadMax?: number
  downloadMax?: number
  uploadClock?: number
  downloadClock?: number
  connectionsClock?: number
  connectionsScope?: ConnectionsScope
  wanIps?: string[]
  wanIpClock?: number
}

export const HISTORY_RANGES = ['1h', '24h', '7d'] as const
export type HistoryRange = (typeof HISTORY_RANGES)[number]
export type HistoryCoverage = 'complete' | 'partial' | 'empty' | 'unavailable'
export type HistoryNote = 'gaps' | 'truncated' | 'unavailable' | 'connections_unbound' | 'ikuai_live_only' | 'connectivity_unavailable' | 'router_retention'
export type HistorySummary = {
  min: number
  max: number
  average: number
  sampleCount: number
  firstClock: number
  lastClock: number
  peakClock: number
}
type HistorySamples<T> = {
  values: (T | null)[]
  sampleClocks: (number | null)[]
  breaks: boolean[]
  coverage: HistoryCoverage
  truncated: boolean
}
export type HistorySeries = HistorySamples<number> & {
  key: 'upload' | 'download' | 'connections' | 'value' | 'cpu' | 'memory'
  role: 'rate' | 'count' | 'value'
  label: string
  unit: string
  connectionsScope?: ConnectionsScope
  summary?: HistorySummary
}
export type HistoryConnectivity = HistorySamples<'online' | 'offline' | 'mixed'> & {
  role: 'connectivity'
}
export type DeviceHistory = {
  projectId: string
  version: number
  range: HistoryRange
  from: number
  to: number
  bucketMs: number
  timestamps: number[]
  metricKind: ProjectMetric['kind']
  source: {
    provider?: 'ikuai' | 'zabbix'
    status: 'ok' | 'partial' | 'empty' | 'unavailable' | 'not_configured'
    checkedAt: number
    notes: HistoryNote[]
  }
  series: HistorySeries[]
  connectivity: HistoryConnectivity
}

export type AdminSession = { authenticated: true; expiresAt: number }
export type ApiError = { error: { code: string; message: string; field?: string } }

export type ConnectionResultCode = 'success' | 'connection' | 'auth' | 'permission' | 'no_items'
export type ConnectionTest = { status: ConnectionResultCode; message: string; version?: string }
export type SourceDiagnostics = {
  ikuai?: { status: 'ok' | 'unavailable'; checkedAt: number }
  status: 'empty' | 'not_configured' | 'ok' | 'unavailable'
  checkedAt?: number
  code?: Exclude<ConnectionResultCode, 'success'>
}

export type MonitorSnapshot = {
  version: number
  regions: Region[]
  settings: MonitorSettings
  devices: SnapshotDevice[]
  source: SourceDiagnostics
  serverTime: number
}

export type CatalogHost = { id: string; host: string; name: string; status: string }
export type CatalogPreprocessing = { type: string; params: string }
export type CatalogValueMapping = { type: string; value: string; newValue: string }
export type CatalogItem = {
  id: string
  hostId: string
  key: string
  name: string
  units: string
  valueType: string
  lastValue: string
  lastClock: number
  status: string
  state: string
  error: string
  delay: string
  masterItemId?: string
  preprocessing: CatalogPreprocessing[]
  valueMap: CatalogValueMapping[]
  effectiveIntervalSeconds?: number
  suggestedStatusMapping?: StatusMapping
}
export type CatalogTrigger = {
  id: string
  name: string
  status: string
  state: string
  value: string
  priority: string
  lastChange: number
  hostIds: string[]
  itemIds: string[]
}
export type CatalogPage<T> = { results: T[]; hasMore: boolean }
