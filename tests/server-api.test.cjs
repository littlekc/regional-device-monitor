const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MonitorDatabase } = require('../lib/server/database.ts')
const { MonitorApi } = require('../lib/server/api.ts')
const { DEFAULT_SETTINGS } = require('../lib/contracts.ts')
const { fixture, item, trigger, secret, now } = require('./server-fixture.cjs')

const origin = 'https://monitor.example'
const password = 'a strong test password'
const region = { id: 'r1', name: 'First region', order: 1 }
const project = {
  id: 'p1', name: 'Device 1', type: 'router', regionId: 'r1', order: 1,
  allowOffline: false, hidden: false, hostId: '10', statusItemId: '20',
  statusMapping: { online: ['1'], offline: [] }, metric: { kind: 'none' }, triggerIds: [],
}

async function setup(t) {
  const db = new MonitorDatabase(':memory:')
  const api = new MonitorApi(db, { allowedOrigins: [origin], now: () => now })
  t.after(() => db.close())
  await api.auth.bootstrap(password)
  function call(path, { method = 'GET', body, cookie, from, host } = {}) {
    const headers = {}
    if (cookie) headers.cookie = cookie
    if (from !== undefined) headers.origin = from
    if (host) headers.host = host
    if (body !== undefined) headers['content-type'] = 'application/json'
    return api.handle(new Request(origin + '/api/' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }))
  }
  async function login(from = origin) {
    const response = await call('admin/login', { method: 'POST', body: { password }, from })
    assert.equal(response.status, 200)
    const cookie = response.headers.get('set-cookie')
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Strict/)
    assert.match(cookie, /Secure/)
    assert.doesNotMatch(JSON.stringify(await response.json()), /token|password/)
    return cookie.split(';')[0]
  }
  return { db, api, call, login }
}

test('public health and snapshot, authenticated admin reads and mutation origin controls', async (t) => {
  const { call, login } = await setup(t)
  const health = await call('health')
  assert.deepEqual(await health.json(), { ok: true })
  assert.match(health.headers.get('cache-control'), /no-store/)
  const snapshot = await call('snapshot')
  assert.equal(snapshot.status, 200)
  assert.match(snapshot.headers.get('cache-control'), /no-store/)
  for (const path of ['config', 'snapshot', 'session', 'zabbix/hosts', 'zabbix/items?hostId=10', 'zabbix/triggers?hostId=10']) {
    assert.equal((await call('admin/' + path)).status, 401)
  }
  assert.equal((await call('admin/zabbix/test', { method: 'POST', body: {}, from: origin })).status, 401)
  assert.equal((await call('admin/login', { method: 'POST', body: { password } })).status, 403)
  assert.equal((await call('admin/login', { method: 'POST', body: { password }, from: 'https://attacker.example', host: 'attacker.example' })).status, 403)
  const cookie = await login()
  for (const from of [undefined, 'null', 'https://monitor.example.attacker.example']) {
    assert.equal((await call('admin/regions', { method: 'POST', body: { version: 0, region }, cookie, from })).status, 403)
  }
  const config = await call('admin/config', { cookie })
  assert.equal(config.status, 200)
  assert.equal((await config.json()).version, 0)
  assert.equal((await call('admin/session', { cookie })).status, 200)
  assert.equal((await call('admin/logout', { method: 'POST', cookie })).status, 403)
  const logout = await call('admin/logout', { method: 'POST', from: origin, cookie })
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal((await call('admin/config', { cookie })).status, 401)
})

test('admin config writes validate, version conflicts roll back, and catalog is real and secret-free', async (t) => {
  const source = await fixture(t)
  const { call, login } = await setup(t)
  const cookie = await login()
  const opts = { cookie, from: origin }
  const send = (path, method, body) => call('admin/' + path, { ...opts, method, body })
  source.items.set('20', item('20'))
  source.items.set('21', item('21', { hostid: '11' }))
  source.triggers.set('30', trigger('30', { description: secret, hosts: [{ hostid: '11' }], items: [{ itemid: '21' }] }))
  let response = await send('settings', 'PUT', { version: 0, settings: DEFAULT_SETTINGS, connection: source.config })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).connection.tokenConfigured, true)
  response = await send('zabbix/test', 'POST', {})
  assert.equal((await response.json()).status, 'success')
  assert.equal((await call('admin/zabbix/hosts?q=Lab&limit=1', { cookie })).status, 200)
  for (const path of ['zabbix/hosts?limit=-1', 'zabbix/hosts?limit=1&limit=9', 'zabbix/items?hostId=bad']) {
    assert.equal((await call('admin/' + path, { cookie })).status, 400)
  }
  response = await send('regions', 'POST', { version: 1, region })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).version, 2)
  response = await send('projects', 'POST', { version: 2, project: { ...project, triggerIds: ['30'] } })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.field, 'triggerIds')
  response = await send('projects', 'POST', { version: 2, project })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).version, 3)
  const stale = await send('projects/p1', 'PUT', { version: 2, project: { ...project, name: 'Rejected' } })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error.code, 'version_conflict')
  assert.equal((await send('regions/r1', 'DELETE', { version: 3 })).status, 409)
  const hidden = await send('projects/p1', 'PUT', { version: 3, project: { ...project, hidden: true } })
  assert.equal(hidden.status, 200)
  const config = await (await call('admin/config', { cookie })).text()
  assert.doesNotMatch(config, new RegExp(secret))
  assert.deepEqual(JSON.parse(config).projects, [{ ...project, hidden: true }])
  assert.equal((await (await call('snapshot')).json()).devices.length, 0)
  assert.equal((await (await call('admin/snapshot', { cookie })).json()).devices.length, 1)
  assert.equal((await send('projects/p1', 'DELETE', { version: 4 })).status, 200)
  assert.equal((await send('regions/r1', 'DELETE', { version: 5 })).status, 200)
})

test('password route validates existing password, revokes other sessions, and clears cookie', async (t) => {
  const { call, login } = await setup(t)
  const cookie = await login()
  const other = await login()
  const changed = 'a different test password'
  const update = (currentPassword) => call('admin/password', {
    method: 'PUT', cookie, from: origin, body: { currentPassword, newPassword: changed },
  })
  assert.equal((await update('incorrect')).status, 401)
  const response = await update(password)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal((await call('admin/session', { cookie: other })).status, 401)
  const correct = await call('admin/login', { method: 'POST', from: origin, body: { password: changed } })
  assert.equal(correct.status, 200)
})

test('login attempts are throttled per instance', async (t) => {
  const { call } = await setup(t)
  const attempt = () => call('admin/login', { method: 'POST', from: origin, body: { password: 'wrong password' } })
  for (let i = 0; i < 10; i++) assert.equal((await attempt()).status, 401)
  const limited = await attempt()
  assert.equal(limited.status, 429)
  assert.ok(limited.headers.get('retry-after'))
})



test('simultaneous HTTP writes with one version commit exactly one mutation', async (t) => {
  const { call, login } = await setup(t)
  const cookie = await login()
  const submit = (value) => call('admin/regions', {
    method: 'POST', cookie, from: origin, body: { version: 0, region: value },
  })
  const writes = await Promise.all([submit(region), submit({ ...region, id: 'second' })])
  assert.deepEqual(writes.map(({ status }) => status).sort(), [201, 409])
  const current = await (await call('admin/config', { cookie })).json()
  assert.equal(current.version, 1)
  assert.equal(current.regions.length, 1)
})
