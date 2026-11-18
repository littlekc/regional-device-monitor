const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ZabbixClient, effectiveInterval, suggestedStatusMapping, validateProjectBinding } = require('../lib/server/zabbix.ts')
const { fixture, item, trigger, secret } = require('./server-fixture.cjs')

test('real JSON-RPC connection test authenticates host and item reads and reports categories', async (t) => {
  const source = await fixture(t)
  const client = new ZabbixClient(source.config, { retries: 0 })
  source.items.set('20', item('20'))
  assert.deepEqual(await client.test(), { status: 'success', version: '7.0.32', message: '已访问 Zabbix 主机和可用监控项。' })
  assert.deepEqual(source.calls.map((call) => call.method), ['apiinfo.version', 'host.get', 'item.get'])
  assert.deepEqual(source.calls.map((call) => call.authorization), [undefined, 'Bearer ' + secret, 'Bearer ' + secret])
  source.items.clear()
  assert.equal((await client.test()).status, 'no_items')
  source.hosts.length = 0
  assert.equal((await client.test()).status, 'no_items')
  source.handlers['host.get'] = () => ({ error: { code: -32602, data: 'Not authorized. ' + secret } })
  assert.equal((await client.test()).status, 'auth')
  source.handlers['host.get'] = () => ({ error: { code: -32500, data: 'No permissions to call "host.get". ' + secret } })
  const rejected = await client.test()
  assert.equal(rejected.status, 'permission')
  assert.doesNotMatch(JSON.stringify(rejected), new RegExp(secret))
  source.handlers['host.get'] = () => ({ error: { code: -32602, data: 'Unexpected parameter: ' + secret } })
  assert.equal((await client.test()).status, 'connection')
})

test('real hanging RPC aborts and retries within its bound', async (t) => {
  const source = await fixture(t)
  let calls = 0
  source.handlers['host.get'] = () => ++calls === 1 ? new Promise(() => {}) : source.hosts
  const client = new ZabbixClient(source.config, { timeoutMs: 150, retries: 1 })
  const page = await client.hostCatalog('router', 1)
  assert.equal(calls, 2)
  assert.equal(page.results.length, 1)
  assert.equal(page.hasMore, true)
  assert.equal(source.calls[0].params.limit, 2)
  assert.deepEqual(source.calls[0].params.search, { host: 'router', name: 'router' })
})

test('catalog includes dependent heartbeat and value map, bounds search, and redacts remote secrets', async (t) => {
  const source = await fixture(t)
  source.items.set('20', item('20', {
    key_: 'net.if.status[ifOperStatus.21]', delay: '0', master_itemid: '21',
    error: 'private ' + secret, preprocessing: [{ type: '20', params: '5m' }],
    valuemap: { mappings: [{ type: '0', value: '1', newvalue: 'Up' }] },
  }))
  source.items.set('21', item('21', { delay: '0', master_itemid: '22', lastclock: '0' }))
  source.items.set('22', item('22', { lastclock: '0' }))
  const client = new ZabbixClient(source.config, { retries: 0 })
  const page = await client.itemCatalog('10', 'status', 1)
  assert.equal(page.results.length, 1)
  assert.equal(page.hasMore, true)
  assert.equal(page.results[0].effectiveIntervalSeconds, 360)
  assert.deepEqual(page.results[0].suggestedStatusMapping, { online: ['1'], offline: ['2', '7'] })
  assert.equal(page.results[0].valueMap[0].newValue, 'Up')
  assert.doesNotMatch(JSON.stringify(page), new RegExp(secret))
  assert.deepEqual(source.calls[0].params.search, { key_: 'status', name: 'status' })
  assert.deepEqual(suggestedStatusMapping('icmpping[,1]'), { online: ['1'], offline: ['0'] })
  assert.deepEqual(suggestedStatusMapping('agent.ping'), { online: ['1'], offline: [] })
  assert.equal(suggestedStatusMapping('net.if.status[2]'), undefined)
  const indexed = await client.itemIndex(['20'])
  assert.equal(effectiveInterval(indexed.get('20'), indexed), 360)
  indexed.delete('22')
  assert.equal(effectiveInterval(indexed.get('20'), indexed), undefined)
})

test('project binding verifies live host ownership and numeric configuration', async (t) => {
  const source = await fixture(t)
  source.items.set('20', item('20'))
  source.items.set('21', item('21', { hostid: '11' }))
  source.items.set('22', item('22', { units: 'bps' }))
  source.triggers.set('30', trigger('30', { items: [{ itemid: '22', hostid: '10' }] }))
  source.triggers.set('31', trigger('31', { items: [{ itemid: '21', hostid: '11' }] }))
  const client = new ZabbixClient(source.config, { retries: 0 })
  const project = { hostId: '10', statusItemId: '20', metric: { kind: 'none' }, triggerIds: ['30'] }
  await validateProjectBinding(client, project)
  await assert.rejects(() => validateProjectBinding(client, { ...project, triggerIds: ['31'] }), { field: 'triggerIds' })
  await assert.rejects(() => validateProjectBinding(client, { ...project, statusItemId: '21' }), { field: 'statusItemId' })
  await assert.rejects(() => validateProjectBinding(client, { ...project, valueItemId: '22', metric: { kind: 'percent' } }), { field: 'metric.capacity' })
  await validateProjectBinding(client, { ...project, valueItemId: '22', metric: { kind: 'percent', capacity: 100 } })
})



test('catalog resolves exact bound IDs outside the first page', async (t) => {
  const source = await fixture(t)
  for (let id = 20; id <= 100; id++) source.items.set(String(id), item(String(id)))
  source.triggers.set('200', trigger('200'))
  const client = new ZabbixClient(source.config, { retries: 0 })
  assert.deepEqual((await client.hostCatalog('11', 1)).results.map(({ id }) => id), ['11'])
  assert.deepEqual((await client.itemCatalog('10', '100', 1)).results.map(({ id }) => id), ['100'])
  assert.deepEqual((await client.triggerCatalog('10', '200', 1)).results.map(({ id }) => id), ['200'])
  assert.deepEqual(source.calls.map(({ params }) => [params.hostids, params.itemids, params.triggerids]), [
    [['11'], undefined, undefined], [['10'], ['100'], undefined], [['10'], undefined, ['200']],
  ])
})
