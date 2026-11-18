import type {
  AdminSession, ApiError, CatalogHost, CatalogItem, CatalogPage, CatalogTrigger, ConnectionInput,
  ConnectionTest, DeviceHistory, HistoryRange, MonitorConfig, MonitorProject, MonitorSettings, Region,
} from '@/lib/contracts'

export class MonitorRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly field?: string) {
    super(message)
    this.name = 'MonitorRequestError'
  }
}

export async function requestJson<T>(
  path: string,
  { method = 'GET', body, signal }: { method?: string; body?: object; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(12_000)
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (response.ok) return await response.json() as T
  const data: ApiError | null = await response.json().catch(() => null)
  throw new MonitorRequestError(data?.error?.code ?? 'request_failed', data?.error?.message ?? '请求失败，请重试。', data?.error?.field)
}

export function requestErrorMessage(error: unknown): string {
  if (error instanceof MonitorRequestError) return error.message
  if (error instanceof DOMException && error.name === 'TimeoutError') return '请求超时，请重试。'
  return '无法连接监控服务，请重试。'
}

export function loadDeviceHistory(projectId: string, range: HistoryRange, signal: AbortSignal) {
  const query = new URLSearchParams({ projectId, range })
  return requestJson<DeviceHistory>(`/api/history?${query}`, { signal })
}

type ConfigCollection = 'regions' | 'projects'

function saveEntry<T extends { id: string }>(
  collection: ConfigCollection, version: number, key: 'region' | 'project', entry: T, existing: boolean,
) {
  const base = `/api/admin/${collection}`
  return requestJson<MonitorConfig>(existing ? `${base}/${encodeURIComponent(entry.id)}` : base, {
    method: existing ? 'PUT' : 'POST',
    body: { version, [key]: entry },
  })
}

function deleteEntry(collection: ConfigCollection, version: number, id: string) {
  return requestJson<MonitorConfig>(`/api/admin/${collection}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: { version },
  })
}

function catalog<T>(selection: 'hosts' | 'items' | 'triggers', query: string, signal: AbortSignal, hostId?: string) {
  const params = new URLSearchParams({ q: query })
  if (hostId) params.set('hostId', hostId)
  return requestJson<CatalogPage<T>>(`/api/admin/zabbix/${selection}?${params}`, { signal })
}

export const adminApi = {
  session: (signal?: AbortSignal) => requestJson<AdminSession>('/api/admin/session', { signal }),
  config: (signal?: AbortSignal) => requestJson<MonitorConfig>('/api/admin/config', { signal }),
  login: (password: string) => requestJson<AdminSession>('/api/admin/login', { method: 'POST', body: { password } }),
  logout: () => requestJson<{ authenticated: false }>('/api/admin/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    requestJson<{ authenticated: false }>('/api/admin/password', { method: 'PUT', body: { currentPassword, newPassword } }),
  saveRegion: (version: number, region: Region, existing: boolean) => saveEntry('regions', version, 'region', region, existing),
  saveProject: (version: number, project: MonitorProject, existing: boolean) => saveEntry('projects', version, 'project', project, existing),
  deleteRegion: (version: number, id: string) => deleteEntry('regions', version, id),
  deleteProject: (version: number, id: string) => deleteEntry('projects', version, id),
  saveSettings: (version: number, settings: MonitorSettings, connection: ConnectionInput) =>
    requestJson<MonitorConfig>('/api/admin/settings', { method: 'PUT', body: { version, settings, connection } }),
  testConnection: (body: ConnectionInput) => requestJson<ConnectionTest>('/api/admin/zabbix/test', { method: 'POST', body }),
  hosts: (q: string, signal: AbortSignal) => catalog<CatalogHost>('hosts', q, signal),
  items: (hostId: string, q: string, signal: AbortSignal) => catalog<CatalogItem>('items', q, signal, hostId),
  triggers: (hostId: string, q: string, signal: AbortSignal) => catalog<CatalogTrigger>('triggers', q, signal, hostId),
}

export async function loadAdminConfig(signal?: AbortSignal): Promise<MonitorConfig | null> {
  try {
    await adminApi.session(signal)
    return await adminApi.config(signal)
  } catch (error) {
    if (error instanceof MonitorRequestError && error.code === 'unauthorized') return null
    throw error
  }
}
