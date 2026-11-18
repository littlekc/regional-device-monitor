const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MonitorDatabase } = require('../lib/server/database.ts')
const { MonitorApi } = require('../lib/server/api.ts')
const { projectInput } = require('../lib/server/validation.ts')
const { validateProjectBinding, ZabbixClient } = require('../lib/server/zabbix.ts')
const { DEFAULT_SETTINGS } = require('../lib/contracts.ts')
const { fixture, item, row, now, clock, secret } = require('./server-fixture.cjs')

const origin = 'https://monitor.example'
const region = { id: 'r1', name: '区域', order: 1 }
const project = {
  id: 'wan', name: 'WAN 1', type: 'line', regionId: 'r1', order: 1,
  allowOffline: false, hidden: false, hostId: '10', statusItemId: '20',
  statusMapping: { online: ['1'], offline: ['2', '7'] }, triggerIds: [],
  metric: { kind: 'traffic', uploadItemId: '21', downloadItemId: '22' },
}

function withMetric(delta) { return { ...project, metric: { ...project.metric, ...delta } } }

test('WAN IP follows the exact interface and fresh complete address table, never a sibling or old address', async (t) => {
  const s = await setup(t)
  const { MonitorEngine } = require('../lib/server/snapshot.ts')
  const engine = new MonitorEngine(s.db, { now: () => now, cacheMs: 0 })
  s.db.createProject(2, project)
  const table = {
    '1.3.6.1.2.1.4.20.1.1.203.0.113.2': ['t', '203.0.113.2'],
    '1.3.6.1.2.1.4.20.1.2.203.0.113.2': ['f', '4'],
    '1.3.6.1.2.1.4.20.1.1.203.0.113.3': ['t', '203.0.113.3'],
    '1.3.6.1.2.1.4.20.1.2.203.0.113.3': ['f', '5'],
  }
  const address = item('80', { key_: 'ikuai.full.json[ip_20]', value_type: '4', lastvalue: JSON.stringify(table), master_itemid: '81', delay: '0' })
  s.items.set('80', address)
  s.items.set('81', item('81', { delay: '5m' }))
  const read = async () => (await engine.read()).devices[0]
  assert.deepEqual((await read()).wanIps, ['203.0.113.2'])
  assert.equal((await read()).wanIpClock, now)
  address.lastclock = String(clock - 601)
  assert.equal((await read()).wanIps, undefined)
  address.lastclock = String(clock)
  address.lastvalue = '{}'
  assert.deepEqual((await read()).wanIps, [])
  address.lastvalue = JSON.stringify(table)
  address.hostid = '11'
  assert.equal((await read()).wanIps, undefined)
  address.hostid = '10'
  address.lastvalue = '{bad json'
  assert.equal((await read()).wanIps, undefined)
  address.lastvalue = JSON.stringify(table)
  s.items.get('20').lastvalue = '2'
  assert.equal((await read()).wanIps, undefined)
  s.items.get('20').lastvalue = '1'
  address.state = '1'
  assert.equal((await read()).wanIps, undefined)
  address.state = '0'
  s.handlers['item.get'] = (params) => params.filter
    ? { error: { code: -32500, message: 'No permissions' } }
    : [...s.items.values()].filter((entry) => params.itemids.includes(entry.itemid))
  const unavailableAddress = await read()
  assert.equal(unavailableAddress.wanIps, undefined)
  assert.equal(unavailableAddress.statusReason, 'online')
})

async function setup(t, options = {}) {
  const source = await fixture(t)
  const db = new MonitorDatabase(':memory:')
  t.after(() => db.close())
  let time = now
  const api = new MonitorApi(db, { allowedOrigins: [origin], now: () => time, ...options })
  db.createRegion(0, region)
  db.updateSettings(1, DEFAULT_SETTINGS, source.config)
  source.items.set('20', item('20', { key_: 'net.if.status[ifOperStatus.4]' }))
  source.items.set('21', item('21', { key_: 'net.if.out[ifOutOctets.4]', units: 'Bps', lastvalue: '125' }))
  source.items.set('22', item('22', { key_: 'net.if.in[ifInOctets.4]', units: 'bps', lastvalue: '2000' }))
  source.items.set('23', item('23', { key_: 'router.port.connections[4]', units: 'connections', lastvalue: '0' }))
  source.items.set('24', item('24', { key_: 'ikuai.metric[connections]', lastvalue: '401' }))
  const call = (path) => api.handle(new Request(origin + '/api/' + path))
  return {
    ...source, db, call,
    history: (range = '1h') => call('history?projectId=wan&range=' + range),
    setTime: (seconds) => { time = now + seconds * 1000 },
  }
}

test('traffic config is compatible with scalar modes and rejects ambiguous bindings', () => {
  assert.deepEqual(projectInput(project), project)
  const bound = withMetric({ connectionsItemId: '23', connectionsScope: 'port', uploadMax: 100_000_000 })
  assert.deepEqual(projectInput(bound), bound)
  for (const [candidate, field] of [
    [{ ...project, valueItemId: '21' }, 'valueItemId'],
    [withMetric({ uploadItemId: undefined }), 'metric.uploadItemId'],
    [withMetric({ downloadItemId: '21' }), 'metric.downloadItemId'],
    [withMetric({ connectionsItemId: '23' }), 'metric.connectionsScope'],
    [withMetric({ connectionsScope: 'port' }), 'metric.connectionsScope'],
    [withMetric({ downloadMax: 0 }), 'metric.downloadMax'],
  ]) assert.throws(() => projectInput(candidate), { code: 'invalid_input', field })
  const scalar = { ...project, metric: { kind: 'rate', max: 100 }, valueItemId: '21' }
  assert.deepEqual(projectInput(scalar), scalar)
})

test('bindings reject cross-host, wrong direction or port, non-rates and known host counters labeled as port counts', async (t) => {
  const source = await setup(t)
  const client = new ZabbixClient(source.config)
  source.items.set('25', item('25', { hostid: '11', units: 'bps' }))
  source.items.set('26', item('26', { units: 'B' }))
  source.items.set('27', item('27', { key_: 'net.if.out[ifOutOctets.7]', units: 'bps' }))
  source.items.set('28', item('28', { units: 'bps', value_type: '1' }))
  for (const [metric, field] of [
    [{ uploadItemId: '25' }, 'metric.uploadItemId'],
    [{ downloadItemId: '26' }, 'metric.downloadItemId'],
    [{ uploadItemId: '22' }, 'metric.uploadItemId'],
    [{ uploadItemId: '27' }, 'metric.uploadItemId'],
    [{ downloadItemId: '28' }, 'metric.downloadItemId'],
    [{ connectionsItemId: '24', connectionsScope: 'port' }, 'metric.connectionsItemId'],
    [{ connectionsItemId: '21', connectionsScope: 'port' }, 'metric.connectionsItemId'],
  ]) await assert.rejects(validateProjectBinding(client, withMetric(metric)), { field, code: 'invalid_input' })
  await validateProjectBinding(client, withMetric({ connectionsItemId: '23', connectionsScope: 'port' }))
  await validateProjectBinding(client, withMetric({ connectionsItemId: '24', connectionsScope: 'host' }))
})

test('live traffic converts only rate channels and keeps independent clocks and missing values', async (t) => {
  const source = await setup(t)
  source.db.createProject(2, withMetric({ connectionsItemId: '23', connectionsScope: 'port', downloadMax: 2e9 }))
  source.items.get('22').lastclock = String(clock - 180)
  let snapshot = await (await source.call('snapshot')).json()
  let live = snapshot.devices[0]
  assert.equal(live.uploadValue, 1000)
  assert.equal(live.uploadClock, now)
  assert.equal(live.downloadValue, undefined)
  assert.equal(live.downloadClock, now - 180_000)
  assert.equal(live.connections, 0)
  assert.equal(live.connectionsClock, now)
  assert.equal(live.connectionsScope, 'port')
  assert.equal(live.uploadMax, undefined)
  assert.equal(live.downloadMax, 2e9)
  assert.equal(live.metricUnit, 'bps')
  source.db.updateProject(3, 'wan', project)
  source.items.get('22').lastclock = String(clock - 1)
  live = (await (await source.call('snapshot')).json()).devices[0]
  assert.equal(live.downloadValue, 2000)
  assert.equal(live.connections, undefined)
  assert.equal(live.connectionsClock, undefined)
  assert.equal(live.connectionsScope, undefined)
  source.setTime(11)
  source.items.get('20').lastvalue = '2'
  live = (await (await source.call('snapshot')).json()).devices[0]
  assert.equal(live.reachable, false)
  assert.equal(live.uploadValue, undefined)
  assert.equal(live.downloadValue, undefined)
  assert.equal(live.uploadClock, now)
})

test('history aggregates actual samples and gaps independently of stale live status', async (t) => {
  const source = await setup(t)
  source.db.createProject(2, project)
  source.items.get('20').lastclock = String(clock - 900)
  source.items.get('20').state = '1'
  source.histories.set('20', [row('20', clock - 181, 2), row('20', clock - 132, 1), row('20', clock - 13, 7)])
  source.histories.set('21', [
    row('21', clock - 190, 25), row('21', clock - 180, 100), row('21', clock - 5, 0),
    row('21', clock - 1, -3), row('21', clock - 30, 'not-a-rate'), row('999', clock - 40, 1000),
  ])
  source.histories.set('22', [row('22', clock - 5, 200), row('22', clock - 4, 400)])
  const response = await source.history()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /no-store/)
  const history = await response.json()
  assert.equal(history.source.status, 'partial')
  assert.equal(history.metricKind, 'traffic')
  assert.equal(history.to, now)
  assert.equal(history.from, now - 3600_000)
  assert.equal(history.timestamps.length, 60)
  assert.equal(history.bucketMs, 60_000)
  assert.deepEqual(history.series.map(({ key, role, unit }) => [key, role, unit]), [
    ['upload', 'rate', 'bps'], ['download', 'rate', 'bps'],
  ])
  const [upload, download] = history.series
  assert.deepEqual(upload.values.slice(-4), [200, 800, null, 0])
  assert.deepEqual(upload.sampleClocks.slice(-4), [now - 190_000, now - 180_000, null, now - 5000])
  assert.equal(upload.breaks.at(-1), true)
  assert.deepEqual(upload.summary, {
    min: 0, max: 800, average: 1000 / 3, sampleCount: 3,
    firstClock: now - 190_000, lastClock: now - 5000, peakClock: now - 180_000,
  })
  assert.equal(download.values.at(-1), 300)
  assert.equal(download.summary.peakClock, now - 4000)
  assert.deepEqual(history.connectivity.values.slice(-4), ['offline', 'online', null, 'offline'])
  assert.equal(history.connectivity.role, 'connectivity')
  assert.doesNotMatch(JSON.stringify(history), /hostId|itemId|fault|trigger|private-zabbix-test-token|api_jsonrpc\.php/)
})

test('numeric history breaks adjacent populated buckets when the receiving bucket has a sample gap', async (t) => {
  const source = await setup(t)
  source.db.createProject(2, project)
  for (const id of ['21', '22']) source.items.get(id).delay = '5s'
  source.histories.set('21', [row('21', clock - 62, 25), row('21', clock - 58, 50), row('21', clock - 8, 100)])
  source.histories.set('22', [row('22', clock - 62, 10), row('22', clock - 58, 20), row('22', clock - 54, 30)])
  const { series: [upload, download] } = await (await source.history()).json()
  assert.deepEqual(upload.values.slice(-2), [200, 600])
  assert.deepEqual(upload.sampleClocks.slice(-2), [now - 62_000, now - 8_000])
  assert.equal(upload.summary.sampleCount, 3)
  assert.equal(upload.summary.max, 800)
  assert.deepEqual(upload.breaks.slice(-2), [false, true])
  assert.deepEqual(download.breaks.slice(-2), [false, false])
})

test('connectivity breaks adjacent populated buckets when the receiving bucket has unmapped evidence', async (t) => {
  const source = await setup(t)
  source.db.createProject(2, project)
  source.items.get('20').delay = '5s'
  source.histories.set('20', [
    row('20', clock - 62, 1), row('20', clock - 58, 1), row('20', clock - 52, 4), row('20', clock - 50, 2),
  ])
  const { connectivity } = await (await source.history()).json()
  assert.deepEqual(connectivity.values.slice(-2), ['online', 'mixed'])
  assert.deepEqual(connectivity.sampleClocks.slice(-2), [now - 62_000, now - 50_000])
  assert.deepEqual(connectivity.breaks.slice(-2), [false, true])
})

test('scalar history uses the live percent conversion and status-only history still has link evidence', async (t) => {
  const source = await setup(t)
  source.histories.set('20', [row('20', clock - 20, 1), row('20', clock - 10, 2), row('20', clock - 8, 4)])
  source.histories.set('22', [row('22', clock - 10, 650)])
  source.db.createProject(2, { ...project, metric: { kind: 'percent', capacity: 1000 }, valueItemId: '22' })
  let history = await (await source.history('24h')).json()
  assert.equal(history.timestamps.length, 288)
  assert.equal(history.series[0].unit, '%')
  assert.equal(history.series[0].values.at(-1), 65)
  assert.equal(history.connectivity.values.at(-1), 'mixed')
  source.db.updateProject(3, 'wan', { ...project, metric: { kind: 'none' } })
  history = await (await source.history('7d')).json()
  assert.equal(history.timestamps.length, 336)
  assert.deepEqual(history.series, [])
  assert.equal(history.connectivity.values.at(-1), 'mixed')
})

test('history accepts only a range and visible project, including after a cached response', async (t) => {
  const source = await setup(t)
  assert.equal((await source.history()).status, 404)
  source.db.createProject(2, { ...project, hidden: true })
  assert.equal((await source.history()).status, 404)
  assert.equal(source.calls.length, 0)
  for (const query of [
    'projectId=wan', 'projectId=wan&range=2h', 'projectId=wan&range=1h&range=24h',
    'projectId=wan&range=1h&itemId=22', 'projectId=wan&projectId=other&range=1h',
  ]) assert.equal((await source.call('history?' + query)).status, 400)
  source.db.updateProject(3, 'wan', project)
  const visible = await source.history()
  assert.equal(visible.status, 200)
  assert.equal((await visible.json()).source.status, 'empty')
  source.db.updateProject(4, 'wan', { ...project, hidden: true })
  assert.equal((await source.history()).status, 404)
})

test('concurrent history requests share reads and never return a superseded binding', async (t) => {
  const source = await setup(t)
  source.items.set('25', item('25', { units: 'bps' }))
  source.db.createProject(2, project)
  let reached, release
  const started = new Promise((resolve) => { reached = resolve })
  const wait = new Promise((resolve) => { release = resolve })
  source.handlers['history.get'] = async ({ itemids: [id] }) => {
    if (id === '21') {
      reached()
      await wait
      return [row(id, clock - 10, 999)]
    }
    if (id === '25') return [row(id, clock - 10, 5)]
    return []
  }
  const first = source.history()
  const second = source.history()
  assert.equal(await Promise.race([started.then(() => 'started'), first.then(() => 'finished')]), 'started')
  source.db.updateProject(3, 'wan', withMetric({ uploadItemId: '25' }))
  release()
  for (const response of await Promise.all([first, second])) {
    assert.equal(response.status, 200)
    const history = await response.json()
    assert.equal(history.version, 4)
    assert.equal(history.series[0].summary.max, 5)
  }
  assert.equal((await (await source.history()).json()).series[0].summary.max, 5)
  for (const id of ['21', '25']) {
    assert.equal(source.calls.filter(({ method, params }) => method === 'history.get' && params.itemids.includes(id)).length, 1)
  }
})

test('history denied if a visible project is hidden or deleted while reading', async (t) => {
  const source = await setup(t)
  source.db.createProject(2, project)
  for (const action of ['hide', 'delete']) {
    let reached, release
    const started = new Promise((resolve) => { reached = resolve })
    const wait = new Promise((resolve) => { release = resolve })
    source.handlers['history.get'] = async ({ itemids: [id] }) => {
      reached()
      await wait
      return [row(id, clock - 10, 1)]
    }
    const pending = source.history()
    assert.equal(await Promise.race([started.then(() => 'started'), pending.then(() => 'finished')]), 'started')
    if (action === 'hide') source.db.updateProject(3, 'wan', { ...project, hidden: true })
    else source.db.deleteProject(5, 'wan')
    release()
    assert.equal((await pending).status, 404)
    if (action === 'hide') {
      source.db.updateProject(4, 'wan', project)
      source.setTime(11)
    }
  }
})

test('capped series never claim full coverage or contaminate summaries with discarded samples', async (t) => {
  const source = await setup(t)
  source.db.createProject(2, project)
  source.histories.set('21', Array.from({ length: 12001 }, (_, index) =>
    row('21', clock - Math.floor(index / 20), index < 12000 ? 1 : 999, 999 - (index % 20))))
  const history = await (await source.history('7d')).json()
  const [upload] = history.series
  assert.equal(upload.truncated, true)
  assert.equal(upload.coverage, 'partial')
  assert.equal(upload.summary.sampleCount, 12000)
  assert.equal(upload.summary.max, 8)
  assert.equal(upload.values[0], null)
  assert.equal(history.source.status, 'partial')
})

test('one timed-out channel leaves real history visible, and cache expiry lets it recover', async (t) => {
  const source = await setup(t, { historyTimeoutMs: 300 })
  source.db.createProject(2, project)
  source.handlers['history.get'] = ({ itemids: [id] }) =>
    id === '22' ? new Promise((resolve) => setTimeout(() => resolve([row(id, clock - 4, 123)]), 900)) : [row(id, clock - 4, 1)]
  let history = await (await source.history()).json()
  assert.equal(history.source.status, 'partial')
  assert.equal(history.series[1].coverage, 'unavailable')
  assert.equal(history.series[0].values.at(-1), 8)
  source.handlers['history.get'] = ({ itemids: [id] }) => [row(id, clock - 4, id === '22' ? 123 : 1)]
  source.setTime(11)
  history = await (await source.history()).json()
  assert.equal(history.series[1].values.at(-1), 123)
  assert.doesNotMatch(JSON.stringify(history), new RegExp(secret))
})
