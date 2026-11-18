import { HISTORY_RANGES, type ConnectionInput, type HistoryRange, type MonitorProject } from '../contracts.ts'
import { MonitorAuth } from './auth.ts'
import { readText } from './body.ts'
import { MonitorDatabase, resolveConnection, sameBindings, type DatabaseState } from './database.ts'
import { invalid, MonitorError } from './errors.ts'
import { HistoryService } from './history-series.ts'
import { MonitorEngine } from './snapshot.ts'
import { IkuaiService } from './ikuai.ts'
import {
  connectionInput, idInput, integer, object, projectInput, regionInput, settingsInput, sourceId, versionInput,
} from './validation.ts'
import { upstreamError, validateProjectBinding, ZabbixClient } from './zabbix.ts'

const sessionCookie = 'monitor_admin'
const maxBody = 32 * 1024
const defaultOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']

function response(data: unknown, status = 200, headers?: HeadersInit): Response {
  const all = new Headers(headers)
  all.set('Cache-Control', 'no-store, max-age=0')
  return Response.json(data, { status, headers: all })
}

function responseError(error: unknown): Response {
  if (!(error instanceof MonitorError)) return response({ error: { code: 'internal_error', message: '服务器暂时无法完成请求。' } }, 500)
  return response({
    error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) },
  }, error.status, error.status === 429 ? { 'Retry-After': '60' } : undefined)
}

function notFound(): never {
  throw new MonitorError(404, 'not_found', '找不到指定记录。')
}

function methodNotAllowed(): never {
  throw new MonitorError(405, 'method_not_allowed', '此接口不支持该请求方法。')
}

function unauthenticated(): never {
  throw new MonitorError(401, 'unauthorized', '请先登录。')
}

function configuredOrigins(): string[] {
  const extra = (process.env.MONITOR_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
  return extra.length ? extra : defaultOrigins
}

function validOrigins(origins: string[]): Set<string> {
  return new Set(origins.map((origin) => {
    const url = new URL(origin)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password ||
      url.pathname !== '/' || url.href.includes('?') || url.href.includes('#')
    ) throw new Error('Invalid monitor origin configuration.')
    return url.origin
  }))
}

function tokenFromCookie(request: Request): string | undefined {
  const matches = (request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(sessionCookie + '='))
  return matches.length === 1 ? matches[0].slice(sessionCookie.length + 1) : undefined
}

function cookie(token: string, origin: string, maxAge: number): string {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=' + maxAge]
  if (origin.startsWith('https://')) attributes.push('Secure')
  return [sessionCookie + '=' + token, ...attributes].join('; ')
}

async function json(request: Request, keys: string[]): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    invalid('body', '请发送 JSON 请求。')
  }
  let input: unknown
  try { input = JSON.parse(await readText(request.body, maxBody)) } catch { invalid('body', '无法读取 JSON 请求。') }
  return object(input, keys)
}

function query(url: URL, forHost: boolean): { hostId?: string; q: string; limit: number } {
  const allowed = forHost ? ['hostId', 'q', 'limit'] : ['q', 'limit']
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) invalid('query')
  }
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length > 120 || /[\u0000-\u001f\u007f]/.test(q)) invalid('q')
  const raw = url.searchParams.get('limit') ?? '50'
  if (!/^\d{1,3}$/.test(raw)) invalid('limit')
  return {
    q,
    limit: integer(Number(raw), 'limit', 1, 100),
    ...(forHost ? { hostId: sourceId(url.searchParams.get('hostId'), 'hostId') } : {}),
  }
}

function sourceClient(state: DatabaseState, input: ConnectionInput = {}): ZabbixClient {
  return new ZabbixClient(resolveConnection(state.connection, input), { signal: AbortSignal.timeout(9000) })
}

function historyQuery(url: URL): { projectId: string; range: HistoryRange } {
  for (const key of url.searchParams.keys()) {
    if ((key !== 'projectId' && key !== 'range') || url.searchParams.getAll(key).length !== 1) invalid('query')
  }
  const projectId = idInput(url.searchParams.get('projectId'), 'projectId')
  const range = HISTORY_RANGES.find((value) => value === url.searchParams.get('range'))
  if (!range) invalid('range')
  return { projectId, range }
}

function needsBindingValidation(previous: MonitorProject | undefined, project: MonitorProject): boolean {
  if (!previous || !sameBindings(previous, project)) return true
  // An existing non-percent item needs explicit capacity when changing its metric mode.
  return project.metric.kind === 'percent' && project.metric.capacity === undefined &&
    (previous.metric.kind !== 'percent' || previous.metric.capacity !== undefined)
}

export class MonitorApi {
  readonly auth: MonitorAuth
  private readonly db: MonitorDatabase
  private readonly engine: MonitorEngine
  private readonly history: HistoryService
  private readonly allowedOrigins: Set<string>
  private readonly clock: () => number

  constructor(db: MonitorDatabase, options: { allowedOrigins?: string[]; now?: () => number; historyTimeoutMs?: number } = {}) {
    this.db = db
    this.clock = options.now ?? Date.now
    this.allowedOrigins = validOrigins(options.allowedOrigins ?? configuredOrigins())
    this.auth = new MonitorAuth(db, { now: this.clock })
    const ikuai = new IkuaiService({ now: this.clock })
    this.engine = new MonitorEngine(db, { now: this.clock, ikuai })
    this.history = new HistoryService(db, this.clock, options.historyTimeoutMs, ikuai)
  }

  private origin(request: Request): string {
    const origin = request.headers.get('Origin')
    if (!origin || !this.allowedOrigins.has(origin)) {
      throw new MonitorError(403, 'origin_forbidden', '请求来源未经授权。')
    }
    return origin
  }

  private session(token?: string): { expiresAt: number } {
    return this.auth.session(token) ?? unauthenticated()
  }

  private async login(request: Request): Promise<Response> {
    const origin = this.origin(request)
    const input = await json(request, ['password'])
    const { token, expiresAt } = await this.auth.login(input.password)
    const maxAge = Math.max(0, Math.floor((expiresAt - this.clock()) / 1000))
    return response({ authenticated: true, expiresAt }, 200, { 'Set-Cookie': cookie(token, origin, maxAge) })
  }

  private async catalog(url: URL, selection: string): Promise<Response> {
    const { q, limit, hostId } = query(url, selection !== 'hosts')
    const client = sourceClient(this.db.readState())
    try {
      if (selection === 'hosts') return response(await client.hostCatalog(q, limit))
      if (selection === 'items') return response(await client.itemCatalog(hostId!, q, limit))
      return response(await client.triggerCatalog(hostId!, q, limit))
    } catch (error) {
      upstreamError(error)
    }
  }

  private async regions(request: Request, token: string, id?: string): Promise<Response> {
    const { method } = request
    if ((!id && method !== 'POST') || (id && method !== 'PUT' && method !== 'DELETE')) methodNotAllowed()
    const body = await json(request, method === 'DELETE' ? ['version'] : ['version', 'region'])
    const version = versionInput(body.version)
    this.session(token)
    if (method === 'DELETE') return response(this.db.deleteRegion(version, id!))
    const region = regionInput(body.region)
    return id ? response(this.db.updateRegion(version, id, region)) : response(this.db.createRegion(version, region), 201)
  }

  private async projects(request: Request, token: string, id?: string): Promise<Response> {
    const { method } = request
    if ((!id && method !== 'POST') || (id && method !== 'PUT' && method !== 'DELETE')) methodNotAllowed()
    const body = await json(request, method === 'DELETE' ? ['version'] : ['version', 'project'])
    const version = versionInput(body.version)
    this.session(token)
    if (method === 'DELETE') return response(this.db.deleteProject(version, id!))
    const nativeOnly = !!id && this.db.project(id)?.statusItemId === ''
    const project = projectInput(body.project, nativeOnly)
    if (id && id !== project.id) invalid('project.id')
    const state = this.db.readState()
    if (state.config.version !== version) throw new MonitorError(409, 'version_conflict', '配置已更新，请重新加载后再保存。')
    if (!state.config.regions.some((region) => region.id === project.regionId)) invalid('regionId', '该区域不存在。')
    const previous = state.config.projects.find((candidate) => candidate.id === project.id)
    if (id && !previous) notFound()
    if (!id && previous) throw new MonitorError(409, 'already_exists', '该 ID 已存在。', 'project.id')
    if (needsBindingValidation(previous, project)) {
      try { await validateProjectBinding(sourceClient(state), project) } catch (error) { upstreamError(error) }
      this.session(token)
    }
    return id ? response(this.db.updateProject(version, id, project)) : response(this.db.createProject(version, project), 201)
  }

  async handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      const { pathname } = url
      const { method } = request
      if (pathname === '/api/health' && method === 'GET') {
        this.db.sqlite.prepare('SELECT 1').get()
        return response({ ok: true })
      }
      if (pathname === '/api/snapshot' && method === 'GET') return response(await this.engine.read())
      if (pathname === '/api/history') {
        if (method !== 'GET') methodNotAllowed()
        const { projectId, range } = historyQuery(url)
        return response(await this.history.read(projectId, range))
      }
      if (pathname === '/api/admin/login' && method === 'POST') return await this.login(request)
      if (!pathname.startsWith('/api/admin/')) notFound()
      const token = tokenFromCookie(request)
      const session = this.session(token)
      const path = pathname.slice('/api/admin/'.length)
      if (method === 'GET') {
        if (path === 'config') return response(this.db.readConfig())
        if (path === 'snapshot') return response(await this.engine.read(true))
        if (path === 'session') return response({ authenticated: true, expiresAt: session.expiresAt })
        const selection = /^zabbix\/(hosts|items|triggers)$/.exec(path)
        if (selection) return await this.catalog(url, selection[1])
        notFound()
      }
      if (!['POST', 'PUT', 'DELETE'].includes(method)) methodNotAllowed()
      const origin = this.origin(request)
      if (path === 'logout' && method === 'POST') {
        this.auth.logout(token!)
        return response({ authenticated: false }, 200, { 'Set-Cookie': cookie('', origin, 0) })
      }
      if (path === 'password' && method === 'PUT') {
        const body = await json(request, ['currentPassword', 'newPassword'])
        this.session(token)
        await this.auth.changePassword(token!, body.currentPassword, body.newPassword)
        return response({ authenticated: false }, 200, { 'Set-Cookie': cookie('', origin, 0) })
      }
      if (path === 'settings' && method === 'PUT') {
        const body = await json(request, ['version', 'settings', 'connection'])
        const version = versionInput(body.version)
        const settings = settingsInput(body.settings)
        const connection = body.connection === undefined ? undefined : connectionInput(body.connection)
        this.session(token)
        return response(this.db.updateSettings(version, settings, connection))
      }
      if (path === 'zabbix/test' && method === 'POST') {
        const input = connectionInput(await json(request, ['url', 'token', 'clearToken']))
        this.session(token)
        return response(await sourceClient(this.db.readState(), input).test())
      }
      const target = /^(regions|projects)(?:\/([^/]+))?$/.exec(path)
      if (!target) notFound()
      const id = target[2] && idInput(target[2])
      return target[1] === 'regions'
        ? await this.regions(request, token!, id)
        : await this.projects(request, token!, id)
    } catch (error) {
      return responseError(error)
    }
  }
}

const shared = globalThis as typeof globalThis & { regionalMonitorApi?: MonitorApi }

function createApi(): MonitorApi {
  const db = new MonitorDatabase()
  try { return new MonitorApi(db) } catch (error) {
    db.close()
    throw error
  }
}

export async function handleMonitorRequest(request: Request): Promise<Response> {
  try {
    shared.regionalMonitorApi ??= createApi()
    return await shared.regionalMonitorApi.handle(request)
  } catch (error) {
    return responseError(error)
  }
}
