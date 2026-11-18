import { request as httpsRequest } from 'node:https'
import { checkServerIdentity } from 'node:tls'
import { isIP } from 'node:net'
import type { MonitorProject, SnapshotDevice } from '../contracts.ts'

export type IkuaiBinding = { projectId: string; statusItemId: string; kind: 'traffic' | 'resources'; interface?: string }
export type IkuaiConfig = { url: string; token: string; tlsServerName: string; hostId: string; bindings: IkuaiBinding[] }
export type IkuaiPublicConfig = Omit<IkuaiConfig, 'token' | 'tlsServerName'> & { tokenConfigured: boolean }
type ObjectValue = Record<string, unknown>
export type IkuaiResult = { ok: boolean; checkedAt: number; data?: ObjectValue }
export type LiveData = { system?: IkuaiResult; interfaces?: IkuaiResult }
type RequestFn = (config: IkuaiConfig, path: string, signal: AbortSignal) => Promise<ObjectValue>
type Entry = { flight?: Promise<IkuaiResult>; result?: IkuaiResult; expires: number }
const LIVE_INTERVAL_MS = 5000

function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined
}

export function validIkuaiConfig(input: IkuaiConfig): IkuaiConfig {
  const url = new URL(input.url)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !/^[A-Za-z0-9.-]+$/.test(input.tlsServerName) || !/^\d+$/.test(input.hostId) ||
    typeof input.token !== 'string' || !input.token.trim() || /[\r\n]/.test(input.token) || input.token.length > 2048 ||
    !Array.isArray(input.bindings) || input.bindings.length > 64) throw Error('Invalid iKuai configuration.')
  const ids = new Set<string>()
  for (const b of input.bindings) {
    if (!b.projectId || ids.has(b.projectId) || !(b.statusItemId === '' && b.kind === 'traffic') && !/^\d+$/.test(b.statusItemId) ||
      !['traffic', 'resources'].includes(b.kind) || (b.kind === 'traffic' && !/^[a-zA-Z0-9_.-]{1,64}$/.test(b.interface ?? ''))) {
      throw Error('Invalid iKuai binding.')
    }
    ids.add(b.projectId)
  }
  return { url: url.origin, token: input.token.trim(), tlsServerName: input.tlsServerName, hostId: input.hostId,
    bindings: input.bindings.map(({ projectId, statusItemId, kind, interface: iface }) =>
      ({ projectId, statusItemId, kind, ...(kind === 'traffic' ? { interface: iface } : {}) })) }
}

export function publicIkuai(config: IkuaiConfig): IkuaiPublicConfig {
  return { url: config.url, hostId: config.hostId, bindings: config.bindings, tokenConfigured: Boolean(config.token) }
}

export function ikuaiBinding(config: IkuaiConfig | undefined, project: MonitorProject): IkuaiBinding | undefined {
  return config?.hostId === project.hostId ? config.bindings.find(b => b.projectId === project.id &&
    b.statusItemId === project.statusItemId && b.kind === project.metric.kind) : undefined
}

// The router serves a valid ikuai.work certificate on its LAN IP. Verify the CA chain AND
// configured certificate DNS name; never disable TLS verification or follow redirects with a token.
export const readIkuai: RequestFn = (config, path, signal) => new Promise((resolve, reject) => {
  const fail = () => reject(new Error('iKuai request failed.'))
  const req = httpsRequest(new URL(path, config.url), {
    method: 'GET', signal, servername: config.tlsServerName,
    checkServerIdentity: (_host, cert) => checkServerIdentity(config.tlsServerName, cert),
    headers: { Authorization: 'Bearer ' + config.token, Accept: 'application/json' },
  }, res => {
    if (res.statusCode !== 200) { res.resume(); fail(); return }
    const parts: Buffer[] = []; let size = 0
    res.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 2 * 1024 * 1024) { res.destroy(); fail() } else parts.push(chunk)
    })
    res.on('error', fail)
    res.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(parts).toString('utf8'))
        const result = object(body.results)
        if (body.code !== 0 || !result) { fail(); return }
        resolve(result)
      } catch { fail() }
    })
  })
  req.on('error', fail)
  req.end()
})

function number(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return
  const result = Number(value)
  return Number.isFinite(result) && result >= 0 ? result : undefined
}

function percent(value: unknown): number | undefined {
  const result = number(typeof value === 'string' ? value.trim().replace(/%$/, '') : value)
  return result !== undefined && result <= 100 ? result : undefined
}

function unique(rows: unknown, name: string): ObjectValue | undefined {
  if (!Array.isArray(rows)) return
  const found = rows.filter(row => object(row)?.interface === name)
  return found.length === 1 ? object(found[0]) : undefined
}

export class IkuaiService {
  private readonly now: () => number
  private readonly request: RequestFn
  private readonly timeoutMs: number

  private readonly cache = new Map<string, Entry>()

  constructor(options: { now?: () => number; request?: RequestFn; timeoutMs?: number } = {}) {
    this.now = options.now ?? Date.now
    this.request = options.request ?? readIkuai
    this.timeoutMs = options.timeoutMs ?? 2500
  }

  read(config: IkuaiConfig, path: string, cacheMs = LIVE_INTERVAL_MS): Promise<IkuaiResult> {
    const identity = JSON.stringify(config)
    const cacheKey = JSON.stringify([identity, path])
    const time = this.now()
    for (const [key, entry] of this.cache) if (!entry.flight && entry.expires <= time) this.cache.delete(key)
    let entry = this.cache.get(cacheKey)
    if (entry?.flight) return entry.flight
    if (entry?.result && time < entry.expires) return Promise.resolve(entry.result)
    if (this.cache.size >= 32) return Promise.resolve({ ok: false, checkedAt: time })
    entry = { expires: time + cacheMs }
    this.cache.set(cacheKey, entry)
    const current = entry
    const signal = AbortSignal.timeout(this.timeoutMs)
    current.flight = this.request(config, path, signal).then(data => ({ ok: true, data, checkedAt: this.now() }))
      .catch(() => ({ ok: false, checkedAt: this.now() }))
      .then(result => { current.result = result; return result })
      .finally(() => { current.flight = undefined })
    return current.flight
  }

  async live(config: IkuaiConfig | undefined, projects: MonitorProject[]): Promise<LiveData | undefined> {
    if (!config) return
    const bindings = projects.map(p => ikuaiBinding(config, p)).filter(Boolean)
    if (!bindings.length) return
    const [system, interfaces] = await Promise.all([
      bindings.some(b => b?.kind === 'resources') ? this.read(config, '/api/v4.0/monitoring/system') : undefined,
      bindings.some(b => b?.kind === 'traffic') ? this.read(config, '/api/v4.0/monitoring/interfaces-status') : undefined,
    ])
    return { system, interfaces }
  }

  diagnostics(live?: LiveData) {
    if (!live) return
    const parts = [live.system, live.interfaces].filter((v): v is IkuaiResult => !!v)
    return { status: parts.every(p => p.ok) ? 'ok' as const : 'unavailable' as const,
      checkedAt: Math.min(...parts.map(p => p.checkedAt)) }
  }

  overlay(config: IkuaiConfig | undefined, project: MonitorProject, original: SnapshotDevice, live?: LiveData): SnapshotDevice {
    const binding = ikuaiBinding(config, project)
    if (!binding) return original
    const sample = binding.kind === 'resources' ? live?.system : live?.interfaces
    const fresh = sample?.ok && this.now() - sample.checkedAt <= LIVE_INTERVAL_MS * 2 && sample.checkedAt <= this.now()
    // Construct from display metadata only: no stale Zabbix fault, value, IP or downtime may leak in.
    const base: SnapshotDevice = {
      id: project.id, name: project.name, regionId: project.regionId, type: project.type, order: project.order,
      allowOffline: project.allowOffline, ...(project.hidden ? { hidden: true } : {}), metricKind: project.metric.kind,
      liveSource: 'ikuai', clockBasis: 'received', sourceClock: fresh ? sample.checkedAt : undefined,
      reachable: false, statusAvailable: false, hasFault: false, faultAvailable: false,
      statusReason: sample?.ok ? fresh ? 'status_missing' : 'status_stale' : 'source_unavailable',
    }
    if (project.metric.kind === 'traffic') {
      base.uploadMax = project.metric.uploadMax; base.downloadMax = project.metric.downloadMax
      base.connectionsScope = 'port'; base.metricUnit = 'bps'
    }
    if (!fresh) return base
    if (binding.kind === 'resources') {
      const info = object(sample.data?.sysinfo)
      if (!info || number(info.uptime) === undefined) return base
      const cpu = percent(Array.isArray(info.cpu) ? info.cpu[0] : undefined)
      const memory = percent(object(info.memory)?.used)
      return { ...base, reachable: true, statusAvailable: true, faultAvailable: true, statusReason: 'online',
        statusClock: sample.checkedAt, cpuValue: cpu, memoryValue: memory,
        cpuClock: cpu === undefined ? undefined : sample.checkedAt, memoryClock: memory === undefined ? undefined : sample.checkedAt }
    }
    const check = unique(sample.data?.iface_check, binding.interface!)
    const stream = unique(sample.data?.iface_stream, binding.interface!)
    // Only explicit success/fail results establish link state.
    const failed = check?.result === 'fail'
    if (!failed && check?.result !== 'success') return { ...base, statusReason: check ? 'status_unmapped' : 'interface_missing' }
    const upload = number(stream?.upload); const download = number(stream?.download); const connections = number(stream?.connect_num)
    const ip = typeof stream?.ip_addr === 'string' && isIP(stream.ip_addr) && stream.ip_addr !== '0.0.0.0' ? stream.ip_addr : undefined
    return { ...base, reachable: true, statusAvailable: true, faultAvailable: true, statusReason: 'online',
      ...(failed ? { reachable: false, hasFault: !project.allowOffline, statusReason: 'link_check_failed' as const,
        ...(!project.allowOffline ? { faultMessage: '链路检测失败' } : {}) } : {}),
      statusClock: sample.checkedAt,
      uploadValue: upload !== undefined && Number.isFinite(upload * 8) ? upload * 8 : undefined,
      downloadValue: download !== undefined && Number.isFinite(download * 8) ? download * 8 : undefined,
      connections: connections !== undefined && Number.isSafeInteger(connections) ? connections : undefined,
      uploadClock: upload === undefined ? undefined : sample.checkedAt,
      downloadClock: download === undefined ? undefined : sample.checkedAt,
      connectionsClock: connections === undefined ? undefined : sample.checkedAt,
      wanIps: ip ? [ip] : undefined, wanIpClock: ip ? sample.checkedAt : undefined }
  }
}
