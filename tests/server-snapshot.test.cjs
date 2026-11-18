const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { MonitorDatabase } = require('../lib/server/database.ts')
const { MonitorEngine } = require('../lib/server/snapshot.ts')
const { DEFAULT_SETTINGS } = require('../lib/contracts.ts')
const { fixture, item, trigger, row, now, clock, secret } = require('./server-fixture.cjs')

const region = { id: 'r1', name: '区域', order: 1 }
const basic = {
  id: 'p1', name: '测试项目', type: 'router', regionId: region.id, order: 1, hidden: false,
  allowOffline: false, hostId: '10', statusItemId: '20', statusMapping: { online: ['1'], offline: ['0'] },
  metric: { kind: 'none' }, triggerIds: [],
}

async function setup(t) {
  const source = await fixture(t)
  const dir = mkdtempSync(join(tmpdir(), 'regional-monitor-snapshot-'))
  const dbPath = join(dir, 'monitor.db')
  const open = () => new MonitorDatabase(dbPath)
  let db = open()
  let time = now
  const createEngine = () => new MonitorEngine(db, { now: () => time, cacheMs: 10000, timeoutMs: 400, retries: 0 })
  let engine = createEngine()
  t.after(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  db.createRegion(0, region)
  db.updateSettings(1, DEFAULT_SETTINGS, source.config)
  return {
    ...source,
    db: () => db,
    read: (includeHidden) => engine.read(includeHidden),
    restart() { db.close(); db = open(); engine = createEngine() },
    setTime(offset) { time = now + offset * 1000 },
  }
}

test('empty and unconfigured projects are honest and public snapshots are display-only', async (t) => {
  const source = await setup(t)
  assert.deepEqual(await source.read(), {
    version: 2, settings: DEFAULT_SETTINGS, regions: [region], devices: [], source: { status: 'empty' }, serverTime: now,
  })
  source.db().createProject(2, basic)
  source.db().createProject(3, { ...basic, id: 'hidden-project', hidden: true })
  source.db().updateSettings(4, DEFAULT_SETTINGS, { clearToken: true })
  const snapshot = await source.read()
  assert.equal(snapshot.source.status, 'not_configured')
  assert.equal(snapshot.devices.length, 1)
  assert.equal(snapshot.devices[0].statusReason, 'not_configured')
  assert.equal(snapshot.devices[0].statusAvailable, false)
  assert.equal((await source.read(true)).devices.length, 2)
  const payload = JSON.stringify(snapshot)
  for (const text of [secret, 'api_jsonrpc.php', 'hostId', 'statusItemId', 'hidden-project']) assert.ok(!payload.includes(text))
})

test('status semantics, explicit faults, independent metrics and truthful clocks', async (t) => {
  const source = await setup(t)
  source.items.set('20', item('20', { lastvalue: '0' }))
  source.items.set('21', item('21', { lastvalue: '7' }))
  source.items.set('22', item('22', { lastvalue: '1.0' }))
  source.items.set('23', item('23', { lastvalue: '100', units: '%' }))
  source.items.set('24', item('24', { lastvalue: '80', units: 'W', lastclock: String(clock - 500) }))
  source.items.set('25', item('25', { lastvalue: '2' }))
  source.items.set('26', item('26', { lastvalue: '1', delay: '{$INTERVAL}' }))
  source.items.set('27', item('27', { lastvalue: '1', state: '1' }))
  source.items.set('28', item('28', { lastvalue: '1000', units: 'bps' }))
  source.triggers.set('30', trigger('30', { value: '1', description: source.config.url + ' ' + secret, items: [{ itemid: '22' }] }))
  source.triggers.set('31', trigger('31', { value: '1', items: [{ itemid: '24' }] }))
  source.triggers.set('32', trigger('32', { value: '1', hosts: [{ hostid: '11' }], items: [{ itemid: '22' }] }))
  const projects = [
    { ...basic, id: 'ping-down', allowOffline: true, metric: { kind: 'percent' }, valueItemId: '23' },
    { ...basic, id: 'if-down', statusItemId: '21', statusMapping: { online: ['1'], offline: ['2', '7'] } },
    { ...basic, id: 'if-unknown', statusItemId: '25', statusMapping: { online: ['1'], offline: ['7'] } },
    { ...basic, id: 'normal', statusItemId: '22', metric: { kind: 'percent' }, valueItemId: '23' },
    { ...basic, id: 'stale-value', statusItemId: '22', metric: { kind: 'power', max: 100 }, valueItemId: '24' },
    { ...basic, id: 'missing-status', statusItemId: '35' },
    { ...basic, id: 'unsupported', statusItemId: '27' },
    { ...basic, id: 'unknown-interval', statusItemId: '26' },
    { ...basic, id: 'override', statusItemId: '26', staleAfterSeconds: 300 },
    { ...basic, id: 'stale-status', statusItemId: '24' },
    { ...basic, id: 'fault', allowOffline: true, triggerIds: ['30'] },
    { ...basic, id: 'ambiguous-fault', statusItemId: '22', triggerIds: ['31', '32'] },
    { ...basic, id: 'rate', statusItemId: '22', metric: { kind: 'rate' }, valueItemId: '28' },
    { ...basic, id: 'capacity', statusItemId: '22', metric: { kind: 'percent', capacity: 2000 }, valueItemId: '28' },
    { ...basic, id: 'no-capacity', statusItemId: '22', metric: { kind: 'percent' }, valueItemId: '28' },
  ]
  projects.forEach((project, i) => source.db().createProject(i + 2, project))
  const snapshot = await source.read()
  const result = Object.fromEntries(snapshot.devices.map((device) => [device.id, device]))
  assert.equal(result['ping-down'].statusReason, 'offline')
  assert.equal(result['ping-down'].statusAvailable, true)
  assert.equal(result['ping-down'].reachable, false)
  assert.equal(result['ping-down'].allowOffline, true)
  assert.equal(result['ping-down'].metricValue, undefined)
  assert.equal(result['if-down'].statusReason, 'offline')
  assert.equal(result['if-down'].allowOffline, false)
  assert.equal(result['if-unknown'].statusReason, 'status_unmapped')
  assert.equal(result.normal.metricValue, 100)
  assert.equal(result.normal.hasFault, false)
  assert.equal(result.normal.statusReason, 'online')
  assert.equal(result.normal.sourceClock, now)
  assert.equal(result.normal.statusClock, now)
  assert.equal(result.normal.valueClock, now)
  assert.equal(result['stale-value'].statusReason, 'online')
  assert.equal(result['stale-value'].metricValue, undefined)
  assert.equal(result['stale-value'].valueClock, now - 500_000)
  assert.equal(result['missing-status'].statusReason, 'status_missing')
  assert.equal(result.unsupported.statusReason, 'status_unsupported')
  assert.equal(result['unknown-interval'].statusReason, 'status_interval_unknown')
  assert.equal(result.override.statusReason, 'online')
  assert.equal(result['stale-status'].statusReason, 'status_stale')
  assert.equal(result.fault.statusReason, 'active_fault')
  assert.equal(result.fault.hasFault, true)
  assert.equal(result.fault.offlineSince, undefined)
  assert.equal(result.fault.alarmSince, now - 60_000)
  assert.equal(result['ambiguous-fault'].hasFault, false)
  assert.equal(result['ambiguous-fault'].statusReason, 'trigger_unavailable')
  assert.equal(result.rate.metricValue, 1000)
  assert.equal(result.rate.metricMax, undefined)
  assert.equal(result.rate.metricUnit, 'bps')
  assert.equal(result.capacity.metricValue, 50)
  assert.equal(result['no-capacity'].metricValue, undefined)
  assert.doesNotMatch(JSON.stringify(snapshot), /private-zabbix-test-token|api_jsonrpc\.php/)
  assert.equal(source.calls.filter(({ method }) => method === 'item.get').length, 1)
  assert.deepEqual(source.calls.find(({ method }) => method === 'trigger.get').params.triggerids.sort(), ['30', '31', '32'])
  source.setTime(11)
  source.handlers['item.get'] = () => ({ error: { code: -1, data: secret + ' raw error' } })
  const failed = await source.read()
  assert.equal(failed.source.status, 'unavailable')
  assert.ok(failed.devices.every((device) => device.statusReason === 'source_unavailable' && device.metricValue === undefined))
  assert.doesNotMatch(JSON.stringify(failed), /raw error|private-zabbix-test-token/)
})

test('concurrent requests singleflight, layout version updates immediately, source generation wins race', async (t) => {
  const source = await setup(t)
  source.db().createProject(2, basic)
  let reached
  const started = new Promise((resolve) => { reached = resolve })
  let release
  const wait = new Promise((resolve) => { release = resolve })
  source.handlers['item.get'] = async ({ itemids }) => {
    if (itemids.includes('20')) {
      reached()
      await wait
      return [item('20', { lastvalue: '0' })]
    }
    return [item('21', { lastvalue: '1' })]
  }
  const old = source.read()
  const same = source.read(true)
  await started
  assert.equal(source.calls.length, 1)
  source.db().updateProject(3, basic.id, { ...basic, statusItemId: '21' })
  const fresh = await source.read()
  assert.equal(fresh.devices[0].statusReason, 'online')
  assert.equal(fresh.version, 4)
  release()
  const [first, second] = await Promise.all([old, same])
  assert.deepEqual([first.version, second.version], [4, 4])
  assert.equal(first.devices[0].statusReason, 'online')
  assert.equal(second.devices[0].statusReason, 'online')
  source.db().updateSettings(4, { ...DEFAULT_SETTINGS, columns: 5 })
  source.db().updateProject(5, basic.id, { ...basic, statusItemId: '21', name: '重命名' })
  const layout = await source.read()
  assert.equal(layout.version, 6)
  assert.equal(layout.settings.columns, 5)
  assert.equal(layout.devices[0].name, '重命名')
  assert.equal(source.calls.length, 2)
})

test('history proves offline transition, survives restart, and requires a bridge after a gap', async (t) => {
  const source = await setup(t)
  source.db().createProject(2, basic)
  const downAt = (delta) => item('20', { lastvalue: '0', lastclock: String(clock + delta) })
  const setHistory = (...rows) => source.histories.set('20', rows.map(([delta, val]) => row('20', clock + delta, val)))
  source.items.set('20', downAt(0))
  setHistory([0, 0], [-60, 0], [-120, 1])
  let first = await source.read()
  assert.equal(first.devices[0].offlineSince, now - 60_000)
  assert.equal(first.devices[0].alarmSince, undefined)
  assert.equal(source.db().readCheckpoints().get(basic.id).lastEvidenceClock, clock)
  source.restart()
  source.setTime(10)
  first = await source.read()
  assert.equal(first.devices[0].offlineSince, now - 60_000)
  source.setTime(60)
  source.items.set('20', downAt(60))
  setHistory([60, 0], [0, 0])
  assert.equal((await source.read()).devices[0].offlineSince, now - 60_000)
  source.setTime(120)
  source.handlers['item.get'] = () => ({ error: { code: -1, data: 'source down' } })
  assert.equal((await source.read()).devices[0].statusReason, 'source_unavailable')
  assert.equal(source.db().readCheckpoints().get(basic.id).needsBridge, true)
  delete source.handlers['item.get']
  source.setTime(130)
  source.items.set('20', downAt(120))
  setHistory([120, 0])
  assert.equal((await source.read()).devices[0].offlineSince, undefined)
  source.restart()
  source.setTime(140)
  setHistory([120, 0], [60, 0])
  assert.equal((await source.read()).devices[0].offlineSince, now - 60_000)
  source.setTime(300)
  source.items.set('20', downAt(300))
  setHistory([300, 0], [120, 0], [60, 0])
  assert.equal((await source.read()).devices[0].offlineSince, undefined)
  source.setTime(370)
  source.items.set('20', downAt(360))
  setHistory([360, 0], [300, 1], [120, 0])
  assert.equal((await source.read()).devices[0].offlineSince, now + 360_000)
  const edit = { ...basic, statusMapping: { online: ['1'], offline: ['0', '2'] } }
  source.db().updateProject(3, basic.id, edit)
  assert.equal(source.db().readCheckpoints().has(basic.id), false)
  setHistory([360, 0])
  assert.equal((await source.read()).devices[0].offlineSince, undefined)
})

test('missing, excessively spaced and capped history never establishes offline start', async (t) => {
  const source = await setup(t)
  source.db().createProject(2, basic)
  source.items.set('20', item('20', { lastvalue: '0' }))
  source.histories.set('20', [row('20', clock - 60, '0'), row('20', clock - 120, '1')])
  assert.equal((await source.read()).devices[0].offlineSince, undefined)
  source.setTime(11)
  source.histories.set('20', [row('20', clock, '0'), row('20', clock - 121, '1')])
  assert.equal((await source.read()).devices[0].offlineSince, undefined)
  source.setTime(22)
  source.histories.set('20', Array.from({ length: 520 }, (_, i) => row('20', clock - i, i > 1 ? '1' : '0')))
  assert.equal((await source.read()).devices[0].offlineSince, undefined)
})
