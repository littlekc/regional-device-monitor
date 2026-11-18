const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { backup } = require('node:sqlite')
const { MonitorDatabase } = require('../lib/server/database.ts')
const { MonitorAuth } = require('../lib/server/auth.ts')
const { projectInput, settingsInput } = require('../lib/server/validation.ts')

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'regional-monitor-'))
  const open = () => new MonitorDatabase(join(dir, 'monitor.db'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { open, dir }
}

const region = { id: 'test-region', name: '区域', order: 4 }
const project = {
  id: 'test-project', name: '项目', type: 'server', regionId: region.id, order: 2,
  hidden: false, allowOffline: false, hostId: '10', statusItemId: '20',
  statusMapping: { online: ['1'], offline: ['0'] }, metric: { kind: 'none' }, triggerIds: [],
}
const settings = { columns: 8, gaugeSize: 100, palette: 'harbor', refreshSeconds: 5 }

test('empty initialization, sorted CRUD, transactional conflict and reopen', (t) => {
  const { open } = temporary(t)
  let db = open()
  let competing
  try {
    assert.deepEqual(db.readConfig(), {
      version: 0, regions: [], projects: [], settings, connection: { url: '', tokenConfigured: false },
    })
    assert.throws(() => db.createProject(0, project), { code: 'invalid_input' })
    assert.equal(db.readConfig().version, 0)
    competing = open()
    const attempts = [
      () => db.createRegion(0, region),
      () => competing.createRegion(0, { id: 'competing', name: '冲突', order: 1 }),
    ].map((write) => { try { write(); return 'ok' } catch (error) { return error.code } })
    assert.deepEqual(attempts, ['ok', 'version_conflict'])
    db.createRegion(1, { id: 'earlier', name: '前面', order: 1 })
    db.createProject(2, project)
    db.createProject(3, { ...project, id: 'another-project', order: 1 })
    db.updateProject(4, project.id, { ...project, hidden: true })
    assert.throws(() => db.deleteRegion(5, region.id), { code: 'region_not_empty' })
    assert.equal(db.readConfig().version, 5)
    db.close()
    db = open()
    const saved = db.readConfig()
    assert.deepEqual(saved.regions.map(({ id }) => id), ['earlier', region.id])
    assert.deepEqual(saved.projects.map(({ id, hidden }) => [id, hidden]), [['another-project', false], [project.id, true]])
    db.deleteProject(5, 'another-project')
    db.deleteProject(6, project.id)
    db.deleteRegion(7, region.id)
    db.deleteRegion(8, 'earlier')
    assert.deepEqual(db.readConfig().regions, [])
    assert.deepEqual(db.readConfig().projects, [])
  } finally {
    db.close()
    competing?.close()
  }
})

test('settings and connection secrets persist through SQLite backup and stay write-only', async (t) => {
  const { open, dir } = temporary(t)
  const db = open()
  try {
    const url = 'https://zabbix.example/api_jsonrpc.php'
    db.updateSettings(0, settings, { url, token: 'sensitive-bearer' })
    assert.deepEqual(db.readConfig().connection, { url, tokenConfigured: true })
    assert.doesNotMatch(JSON.stringify(db.readConfig()), /sensitive-bearer/)
    const generation = db.readState().sourceRevision
    db.updateSettings(1, { ...settings, columns: 6 }, { url, token: '' })
    assert.equal(db.readState().sourceRevision, generation)
    assert.equal(db.readState().connection.token, 'sensitive-bearer')
    const target = join(dir, 'backup.db')
    await backup(db.sqlite, target)
    const restored = new MonitorDatabase(target)
    try {
      assert.equal(restored.readConfig().version, 2)
      assert.equal(restored.readConfig().settings.columns, 6)
      assert.equal(restored.readState().connection.token, 'sensitive-bearer')
    } finally { restored.close() }
    db.updateSettings(2, settings, { url, clearToken: true })
    assert.equal(db.readConfig().connection.tokenConfigured, false)
    assert.equal(db.readState().sourceRevision, generation + 1)
  } finally { db.close() }
})

test('strict config validation rejects malformed nested values and runtime fields', () => {
  assert.deepEqual(projectInput(project), project)
  for (const bad of [
    { ...project, type: 'ghost' },
    { ...project, order: '2' },
    { ...project, hidden: 0 },
    { ...project, hostId: 'x10' },
    { ...project, triggerIds: ['20', '20'] },
    { ...project, reachable: true },
    { ...project, statusMapping: { online: ['1'], offline: [' 1 '] } },
    { ...project, statusMapping: { online: [], offline: ['0'] } },
    { ...project, metric: { kind: 'raw', max: Infinity }, valueItemId: '25' },
    { ...project, metric: { kind: 'power', max: 0 }, valueItemId: '25' },
    { ...project, metric: { kind: 'percent' } },
  ]) assert.throws(() => projectInput(bad), { code: 'invalid_input' })
  assert.throws(() => settingsInput({ ...settings, columns: 100 }), { code: 'invalid_input' })
  assert.throws(() => settingsInput({ ...settings, palette: 'arbitrary' }), { code: 'invalid_input' })
})

test('explicit bootstrap, expiring/revocable sessions and password change', async (t) => {
  const db = temporary(t).open()
  try {
    let now = 1_700_000_000_000
    const auth = new MonitorAuth(db, { now: () => now, sessionMs: 1_000 })
    const password = 'a valid test password'
    const changed = 'a changed test password'
    await assert.rejects(() => auth.login(password), { code: 'invalid_credentials' })
    await auth.bootstrap(password)
    await assert.rejects(() => auth.bootstrap(changed), { code: 'admin_exists' })
    await assert.rejects(() => auth.login(changed), { code: 'invalid_credentials' })
    const first = await auth.login(password)
    const second = await auth.login(password)
    assert.equal(auth.session(first.token).expiresAt, now + 1_000)
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(first.token).n, 0)
    auth.logout(first.token)
    assert.equal(auth.session(first.token), undefined)
    await assert.rejects(() => auth.changePassword(second.token, changed, 'a new valid password'), { code: 'invalid_credentials' })
    await auth.changePassword(second.token, password, changed)
    assert.equal(auth.session(second.token), undefined)
    await assert.rejects(() => auth.login(password), { code: 'invalid_credentials' })
    const latest = await auth.login(changed)
    now += 1_000
    assert.equal(auth.session(latest.token), undefined)
    assert.notEqual(db.sqlite.prepare('SELECT password_hash FROM administrator').get().password_hash, changed)
  } finally { db.close() }
})



test('bootstrap and backup CLI preserve data and keep password out of output', (t) => {
  const { open, dir } = temporary(t)
  const { spawnSync } = require('node:child_process')
  const root = join(__dirname, '..')
  const env = { ...process.env, MONITOR_DB_PATH: join(dir, 'monitor.db') }
  delete env.MONITOR_ADMIN_PASSWORD
  const password = 'a controlled test password'
  const backupPath = join(dir, 'online-backup.db')
  const run = (script, args = [], input) => spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
    cwd: root, env, input, encoding: 'utf8',
  })
  assert.equal(run('backup.mjs', [backupPath]).status, 1)
  const bootstrap = run('bootstrap.mjs', [], password + '\n')
  assert.equal(bootstrap.status, 0, bootstrap.stderr)
  assert.ok(!(bootstrap.stdout + bootstrap.stderr).includes(password))
  assert.equal(run('bootstrap.mjs', [], password + '\n').status, 1)
  const primary = open()
  try {
    primary.createRegion(0, region)
    const copy = run('backup.mjs', [backupPath])
    assert.equal(copy.status, 0, copy.stderr)
    assert.equal(run('backup.mjs', [backupPath]).status, 1)
    const restored = new MonitorDatabase(backupPath)
    try {
      assert.equal(restored.readConfig().version, 1)
      assert.deepEqual(restored.readConfig().regions, [region])
      assert.ok(restored.administratorHash())
    } finally {
      restored.close()
    }
  } finally {
    primary.close()
  }
})
