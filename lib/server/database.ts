import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import {
  DEFAULT_SETTINGS,
  type ConnectionInput,
  type MonitorConfig,
  type MonitorProject,
  type MonitorSettings,
  type Region,
} from '../contracts.ts'
import { MonitorError, invalid } from './errors.ts'
import { normalizeStatus } from './validation.ts'
import { publicIkuai, validIkuaiConfig, type IkuaiConfig } from './ikuai.ts'

export const DEFAULT_DB_PATH = '/var/lib/regional-device-monitor/monitor.db'

export type StoredConnection = { url: string; token: string }
export type DatabaseState = {
  routers: IkuaiConfig[]
  config: MonitorConfig
  sourceRevision: number
  connection: StoredConnection
}

export type OfflineCheckpoint = {
  projectId: string
  fingerprint: string
  offlineSince: number
  lastEvidenceClock: number
  observedAt: number
  needsBridge: boolean
}

export type CheckpointUpdate =
  | { kind: 'record'; checkpoint: OfflineCheckpoint }
  | { kind: 'clear' | 'invalidate'; projectId: string }

export function statusFingerprint(project: MonitorProject): string {
  const { hostId, statusItemId, statusMapping, staleAfterSeconds } = project
  const sets = [statusMapping.online, statusMapping.offline].map((values) => values.map(normalizeStatus).sort())
  return createHash('sha256').update(JSON.stringify([hostId, statusItemId, sets, staleAfterSeconds])).digest('hex')
}

export function sameBindings(first: MonitorProject, second: MonitorProject): boolean {
  const channelBindings = ({ metric }: MonitorProject) => {
    if (metric.kind === 'traffic') return [metric.kind, metric.uploadItemId, metric.downloadItemId, metric.connectionsItemId, metric.connectionsScope].join(':')
    if (metric.kind === 'resources') return [metric.kind, metric.cpuItemId, metric.memoryItemId].join(':')
    return ''
  }
  return statusFingerprint(first) === statusFingerprint(second) &&
    first.valueItemId === second.valueItemId &&
    channelBindings(first) === channelBindings(second) &&
    [...first.triggerIds].sort().join(',') === [...second.triggerIds].sort().join(',')
}

export function resolveConnection(existing: StoredConnection, input: ConnectionInput): StoredConnection {
  return {
    url: input.url ?? existing.url,
    token: input.clearToken ? '' : input.token || existing.token,
  }
}

export function databasePath(): string {
  return resolve(/* turbopackIgnore: true */ process.env.MONITOR_DB_PATH || DEFAULT_DB_PATH)
}

function missing(): never {
  throw new MonitorError(404, 'not_found', '找不到指定记录。')
}

function duplicate(field: string): never {
  throw new MonitorError(409, 'already_exists', '该 ID 已存在。', field)
}

export class MonitorDatabase {
  readonly sqlite: DatabaseSync

  constructor(path = databasePath()) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      try {
        closeSync(openSync(/* turbopackIgnore: true */ path, 'ax', 0o600))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }

    this.sqlite = new DatabaseSync(path)
    try {
      this.sqlite.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
      this.sqlite.exec('PRAGMA journal_mode = WAL;')
      this.transaction(() => this.migrate())
    } catch (error) {
      this.sqlite.close()
      throw error
    }
  }

  private migrate(): void {
    const version = this.sqlite.prepare('PRAGMA user_version').get()?.user_version
    // Additive extension keeps older application releases able to read the existing v1 data.
    if (version === 0 || version === 1) this.sqlite.exec('CREATE TABLE IF NOT EXISTS ikuai_connection (id INTEGER PRIMARY KEY CHECK(id = 1), config TEXT NOT NULL) STRICT;')
    if (version === 1) return
    if (version !== 0) throw new Error('Unsupported monitoring database schema.')
    this.sqlite.exec(
      "CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL, source_revision INTEGER NOT NULL) STRICT;" +
      "CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), config TEXT NOT NULL) STRICT;" +
      "CREATE TABLE connection (id INTEGER PRIMARY KEY CHECK(id = 1), url TEXT NOT NULL, token TEXT NOT NULL) STRICT;" +
      "CREATE TABLE regions (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL) STRICT;" +
      "CREATE TABLE projects (id TEXT PRIMARY KEY, region_id TEXT NOT NULL REFERENCES regions(id), sort_order INTEGER NOT NULL, config TEXT NOT NULL) STRICT;" +
      "CREATE INDEX projects_region ON projects(region_id);" +
      "CREATE TABLE administrator (id INTEGER PRIMARY KEY CHECK(id = 1), password_hash TEXT NOT NULL) STRICT;" +
      "CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL) STRICT;" +
      "CREATE INDEX sessions_expires ON sessions(expires_at);" +
      "CREATE TABLE offline_checkpoints (" +
      "project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL, " +
      "offline_since INTEGER NOT NULL, last_evidence_clock INTEGER NOT NULL, observed_at INTEGER NOT NULL, " +
      "needs_bridge INTEGER NOT NULL CHECK(needs_bridge IN (0,1))) STRICT;" +
      "INSERT INTO metadata VALUES (1, 0, 0);" +
      "INSERT INTO connection VALUES (1, '', '');" +
      "PRAGMA user_version = 1;"
    )
    this.sqlite.prepare('INSERT INTO settings VALUES (1, ?)').run(JSON.stringify(DEFAULT_SETTINGS))
  }

  close(): void {
    this.sqlite.close()
  }

  private transaction<T>(work: () => T, write = true): T {
    this.sqlite.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN')
    try {
      const result = work()
      this.sqlite.exec('COMMIT')
      return result
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }

  private metadata() {
    return this.sqlite.prepare('SELECT version, source_revision FROM metadata WHERE id = 1').get() as {
      version: number
      source_revision: number
    }
  }

  private connection(): StoredConnection {
    return this.sqlite.prepare('SELECT url, token FROM connection WHERE id = 1').get() as StoredConnection
  }

  private stateFromRows(): DatabaseState {
    const { version, source_revision } = this.metadata()
    const connection = this.connection()
    const native = this.sqlite.prepare('SELECT config FROM ikuai_connection WHERE id = 1').get()
    const stored = native ? JSON.parse(String(native.config)) : []
    const routers: IkuaiConfig[] = Array.isArray(stored) ? stored : [stored]
    const regions = this.sqlite.prepare('SELECT id, name, sort_order AS "order" FROM regions ORDER BY sort_order, id')
      .all().map(({ id, name, order }) => ({ id: String(id), name: String(name), order: Number(order) }))
    const projects = this.sqlite.prepare('SELECT config FROM projects ORDER BY sort_order, id')
      .all().map(({ config }) => JSON.parse(String(config)) as MonitorProject)
    const settings = JSON.parse(String(this.sqlite.prepare('SELECT config FROM settings WHERE id = 1').get()?.config)) as MonitorSettings
    return {
      routers,
      sourceRevision: source_revision,
      connection,
      config: { version, regions, projects, settings, connection: { url: connection.url, tokenConfigured: Boolean(connection.token) },
        ...(routers.length ? { routers: routers.map(publicIkuai) } : {}) },
    }
  }

  readState(): DatabaseState {
    return this.transaction(() => this.stateFromRows(), false)
  }

  readConfig(): MonitorConfig {
    return this.readState().config
  }

  // Server-side provisioning only. Normal configuration reads never return the secret.
  configureIkuai(version: number, input: IkuaiConfig): MonitorConfig {
    const config = validIkuaiConfig(input)
    return this.write(version, () => {
      for (const binding of config.bindings) {
        const project = this.project(binding.projectId)
        if (!project || project.hostId !== config.hostId || project.statusItemId !== binding.statusItemId || project.metric.kind !== binding.kind) {
          invalid('ikuai', '爱快 API 绑定与项目不匹配。')
        }
      }
      this.sqlite.prepare('INSERT INTO ikuai_connection VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config').run(JSON.stringify([...this.stateFromRows().routers.filter(router => router.hostId !== config.hostId), config]))
      return true
    })
  }

  private write(version: number, update: () => boolean): MonitorConfig {
    return this.transaction(() => {
      if (this.metadata().version !== version) {
        throw new MonitorError(409, 'version_conflict', '配置已更新，请重新加载后再保存。')
      }
      const sourceChanged = update()
      this.sqlite.prepare('UPDATE metadata SET version = version + 1, source_revision = source_revision + ? WHERE id = 1')
        .run(sourceChanged ? 1 : 0)
      return this.stateFromRows().config
    })
  }

  createRegion(version: number, region: Region): MonitorConfig {
    return this.write(version, () => {
      const inserted = this.sqlite.prepare('INSERT INTO regions VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .run(region.id, region.name, region.order)
      if (!inserted.changes) duplicate('region.id')
      return false
    })
  }

  updateRegion(version: number, id: string, region: Region): MonitorConfig {
    if (region.id !== id) invalid('region.id')
    return this.write(version, () => {
      const updated = this.sqlite.prepare('UPDATE regions SET name = ?, sort_order = ? WHERE id = ?')
        .run(region.name, region.order, id)
      if (!updated.changes) missing()
      return false
    })
  }

  deleteRegion(version: number, id: string): MonitorConfig {
    return this.write(version, () => {
      if (this.sqlite.prepare('SELECT 1 FROM projects WHERE region_id = ? LIMIT 1').get(id)) {
        throw new MonitorError(409, 'region_not_empty', '请先移走或删除该区域内的项目。')
      }
      if (!this.sqlite.prepare('DELETE FROM regions WHERE id = ?').run(id).changes) missing()
      return false
    })
  }

  private requireRegion(id: string): void {
    if (!this.sqlite.prepare('SELECT 1 FROM regions WHERE id = ?').get(id)) invalid('regionId', '该区域不存在。')
  }

  project(id: string): MonitorProject | undefined {
    const row = this.sqlite.prepare('SELECT config FROM projects WHERE id = ?').get(id)
    return row ? JSON.parse(String(row.config)) as MonitorProject : undefined
  }

  createProject(version: number, project: MonitorProject): MonitorConfig {
    return this.write(version, () => {
      this.requireRegion(project.regionId)
      const inserted = this.sqlite.prepare('INSERT INTO projects VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .run(project.id, project.regionId, project.order, JSON.stringify(project))
      if (!inserted.changes) duplicate('project.id')
      return true
    })
  }

  updateProject(version: number, id: string, project: MonitorProject): MonitorConfig {
    if (project.id !== id) invalid('project.id')
    return this.write(version, () => {
      const previous = this.project(id) ?? missing()
      this.requireRegion(project.regionId)
      this.sqlite.prepare('UPDATE projects SET region_id = ?, sort_order = ?, config = ? WHERE id = ?')
        .run(project.regionId, project.order, JSON.stringify(project), id)
      if (statusFingerprint(previous) !== statusFingerprint(project)) {
        this.sqlite.prepare('DELETE FROM offline_checkpoints WHERE project_id = ?').run(id)
      }
      return !sameBindings(previous, project)
    })
  }

  deleteProject(version: number, id: string): MonitorConfig {
    return this.write(version, () => {
      if (!this.sqlite.prepare('DELETE FROM projects WHERE id = ?').run(id).changes) missing()
      return true
    })
  }

  updateSettings(version: number, settings: MonitorSettings, input: ConnectionInput = {}): MonitorConfig {
    return this.write(version, () => {
      const previous = this.connection()
      const next = resolveConnection(previous, input)
      this.sqlite.prepare('UPDATE settings SET config = ? WHERE id = 1').run(JSON.stringify(settings))
      if (previous.url === next.url && previous.token === next.token) return false
      this.sqlite.prepare('UPDATE connection SET url = ?, token = ? WHERE id = 1').run(next.url, next.token)
      this.sqlite.exec('DELETE FROM offline_checkpoints')
      return true
    })
  }

  readCheckpoints(): Map<string, OfflineCheckpoint> {
    const result = new Map<string, OfflineCheckpoint>()
    for (const row of this.sqlite.prepare('SELECT * FROM offline_checkpoints').all()) {
      const projectId = String(row.project_id)
      result.set(projectId, {
        projectId,
        fingerprint: String(row.fingerprint),
        offlineSince: Number(row.offline_since),
        lastEvidenceClock: Number(row.last_evidence_clock),
        observedAt: Number(row.observed_at),
        needsBridge: row.needs_bridge === 1,
      })
    }
    return result
  }

  applyCheckpoints(sourceRevision: number, updates: CheckpointUpdate[]): void {
    if (!updates.length) return
    this.transaction(() => {
      if (this.metadata().source_revision !== sourceRevision) return
      const remove = this.sqlite.prepare('DELETE FROM offline_checkpoints WHERE project_id = ?')
      const invalidate = this.sqlite.prepare('UPDATE offline_checkpoints SET needs_bridge = 1 WHERE project_id = ?')
      const record = this.sqlite.prepare(
        "INSERT INTO offline_checkpoints VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(project_id) DO UPDATE SET " +
        "fingerprint = excluded.fingerprint, offline_since = excluded.offline_since, " +
        "last_evidence_clock = excluded.last_evidence_clock, observed_at = excluded.observed_at, needs_bridge = 0 " +
        "WHERE excluded.observed_at >= offline_checkpoints.observed_at"
      )
      for (const update of updates) {
        if (update.kind === 'clear') remove.run(update.projectId)
        if (update.kind === 'invalidate') invalidate.run(update.projectId)
        if (update.kind === 'record') {
          const { projectId, fingerprint, offlineSince, lastEvidenceClock, observedAt } = update.checkpoint
          record.run(projectId, fingerprint, offlineSince, lastEvidenceClock, observedAt)
        }
      }
    })
  }

  administratorHash(): string | undefined {
    const hash = this.sqlite.prepare('SELECT password_hash FROM administrator WHERE id = 1').get()?.password_hash
    return typeof hash === 'string' ? hash : undefined
  }

  createAdministrator(hash: string): boolean {
    return Boolean(this.sqlite.prepare('INSERT INTO administrator VALUES (1, ?) ON CONFLICT(id) DO NOTHING').run(hash).changes)
  }

  createSession(tokenHash: string, expiresAt: number, now: number, passwordHash: string): boolean {
    return this.transaction(() => {
      if (this.administratorHash() !== passwordHash) return false
      this.sqlite.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
      this.sqlite.prepare('INSERT INTO sessions VALUES (?, ?)').run(tokenHash, expiresAt)
      return true
    })
  }

  sessionExpiration(tokenHash: string, now: number): number | undefined {
    const row = this.sqlite.prepare('SELECT expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, now)
    return typeof row?.expires_at === 'number' ? row.expires_at : undefined
  }

  deleteSession(tokenHash: string): void {
    this.sqlite.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
  }

  updatePassword(originalHash: string, nextHash: string, tokenHash: string, now: number): boolean {
    return this.transaction(() => {
      if (!this.sessionExpiration(tokenHash, now)) return false
      const changed = this.sqlite.prepare('UPDATE administrator SET password_hash = ? WHERE id = 1 AND password_hash = ?')
        .run(nextHash, originalHash)
      if (!changed.changes) return false
      this.sqlite.exec('DELETE FROM sessions')
      return true
    })
  }
}
