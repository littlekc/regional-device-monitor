const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MonitorDatabase } = require('../lib/server/database.ts')
const { MonitorApi } = require('../lib/server/api.ts')
const { projectInput } = require('../lib/server/validation.ts')
const { validateProjectBinding, ZabbixClient } = require('../lib/server/zabbix.ts')
const { DEFAULT_SETTINGS } = require('../lib/contracts.ts')
const { fixture, item, row, now, clock } = require('./server-fixture.cjs')

const project = {
  id: 'resources', name: '测试主机', type: 'server', regionId: 'r1', order: 1,
  allowOffline: true, hidden: false, hostId: '10', statusItemId: '20',
  statusMapping: { online: ['1'], offline: ['0'] }, triggerIds: [],
  metric: { kind: 'resources', cpuItemId: '21', memoryItemId: '22' },
}
const withMetric = (delta) => ({ ...project, metric: { ...project.metric, ...delta } })

async function setup(t) {
  const source = await fixture(t)
  const db = new MonitorDatabase(':memory:')
  t.after(() => db.close())
  let time = now
  const api = new MonitorApi(db, { now: () => time, cacheMs: 10000, historyCacheMs: 10000 })
  db.createRegion(0, { id: 'r1', name: '区域', order: 1 })
  db.updateSettings(1, DEFAULT_SETTINGS, source.config)
  db.createProject(2, project)
  source.items.set('20', item('20'))
  source.items.set('21', item('21', { key_: 'system.cpu.util', units: '%', lastvalue: '100', value_type: '0' }))
  source.items.set('22', item('22', { key_: 'vm.memory.size[pused]', units: '%', lastvalue: '27.5', value_type: '0' }))
  const call = (path) => api.handle(new Request('https://monitor.example/api/' + path))
  return {
    ...source, db,
    device: async () => (await (await call('snapshot')).json()).devices[0],
    history: () => call('history?projectId=resources&range=1h'),
    advance(seconds) {
      time = now + seconds * 1000
      for (const entry of source.items.values()) entry.lastclock = String(clock + seconds)
    },
  }
}

test('resource input uses only two distinct nested bindings', () => {
  assert.deepEqual(projectInput(project), project)
  assert.throws(() => projectInput(withMetric({ memoryItemId: '21' })), { field: 'metric.memoryItemId' })
  assert.throws(() => projectInput({ ...project, valueItemId: '21' }), { field: 'valueItemId' })
  assert.throws(() => projectInput(withMetric({ uploadItemId: '23' })), { field: 'metric' })
  assert.throws(() => projectInput(withMetric({ memoryItemId: undefined })), { field: 'metric.memoryItemId' })
})

test('authoritative resource binding requires local numeric percent items distinct from status', async (t) => {
  const source = await setup(t)
  source.items.get('20').units = '%'
  source.items.set('23', item('23', { hostid: '11', units: '%' }))
  source.items.set('24', item('24', { units: 'B' }))
  source.items.set('25', item('25', { units: '%', value_type: '1' }))
  const client = new ZabbixClient(source.config)
  await validateProjectBinding(client, project)
  for (const [metric, field] of [
    [{ cpuItemId: '23' }, 'metric.cpuItemId'],
    [{ memoryItemId: '24' }, 'metric.memoryItemId'],
    [{ cpuItemId: '25' }, 'metric.cpuItemId'],
    [{ memoryItemId: '20' }, 'metric.memoryItemId'],
    [{ cpuItemId: '20' }, 'metric.cpuItemId'],
    [{ memoryItemId: '21' }, 'metric.memoryItemId'],
  ]) await assert.rejects(validateProjectBinding(client, withMetric(metric)), { field, code: 'invalid_input' })
})

test('resource readings have independent freshness and bounds, and clear on offline and source outage', async (t) => {
  const source = await setup(t)
  source.items.get('22').lastclock = String(clock - 181)
  let device = await source.device()
  assert.equal(device.cpuValue, 100)
  assert.equal(device.cpuClock, now)
  assert.equal(device.memoryValue, undefined)
  assert.equal(device.memoryClock, now - 181_000)
  assert.equal(device.statusReason, 'online')
  assert.equal(device.hasFault, false)

  source.advance(11)
  source.items.delete('21')
  device = await source.device()
  assert.equal(device.cpuValue, undefined)
  assert.equal(device.memoryValue, 27.5)
  assert.equal(device.memoryClock, now + 11_000)
  assert.equal(device.statusReason, 'online')

  source.advance(22)
  source.items.set('21', item('21', { units: '%', lastvalue: '0', lastclock: String(clock + 22) }))
  source.items.get('22').lastvalue = '101'
  device = await source.device()
  assert.equal(device.cpuValue, 0)
  assert.equal(device.memoryValue, undefined)
  assert.equal(device.statusReason, 'online')

  source.advance(33)
  source.items.get('22').lastvalue = '50'
  source.items.get('20').lastvalue = '0'
  device = await source.device()
  assert.equal(device.statusReason, 'offline')
  assert.equal(device.cpuValue, undefined)
  assert.equal(device.memoryValue, undefined)

  source.advance(44)
  source.handlers['item.get'] = () => ({ error: { code: -32602, message: 'Unavailable' } })
  device = await source.device()
  assert.equal(device.statusReason, 'source_unavailable')
  assert.equal(device.cpuValue, undefined)
  assert.equal(device.memoryValue, undefined)
})

test('resource history shares the percent contract, filters invalid samples and refreshes both caches on each rebind', async (t) => {
  const source = await setup(t)
  source.histories.set('21', [row('21', clock - 10, 100), row('21', clock - 12, 101)])
  source.histories.set('22', [row('22', clock - 7, 27.5), row('22', clock - 9, -1)])
  const read = async () => {
    const response = await source.history()
    assert.equal(response.status, 200)
    return response.json()
  }
  let data = await read()
  assert.equal(data.metricKind, 'resources')
  assert.deepEqual(data.series.map(({ key, role, unit, summary }) => [key, role, unit, summary?.sampleCount, summary?.max]),
    [['cpu', 'value', '%', 1, 100], ['memory', 'value', '%', 1, 27.5]])
  assert.equal(data.series[0].sampleClocks.at(-1), now - 10_000)
  assert.equal(data.series[1].sampleClocks.at(-1), now - 7_000)
  await source.device()
  for (const [index, id, key, value] of [[0, '23', 'cpu', 44], [1, '24', 'memory', 55]]) {
    source.items.set(id, item(id, { units: '%', lastvalue: String(value) }))
    source.histories.set(id, [row(id, clock - 5, value)])
    const change = index === 0 ? { cpuItemId: id } : { cpuItemId: '23', memoryItemId: id }
    source.db.updateProject(3 + index, project.id, withMetric(change))
    data = await read()
    assert.equal(data.series[index].summary.max, value)
    assert.equal((await source.device())[key + 'Value'], value)
    assert.equal(source.calls.filter(({ method, params }) => method === 'history.get' && params.itemids.includes(id)).length, 1)
  }
  source.db.updateProject(5, project.id, { ...withMetric({ cpuItemId: '23', memoryItemId: '24' }), hidden: true })
  assert.equal((await source.history()).status, 404)
})
