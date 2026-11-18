const { createServer } = require('node:http')
const { once } = require('node:events')
const assert = require('node:assert/strict')

const secret = 'private-zabbix-test-token'
const now = 1_794_766_080_000
const clock = now / 1000

function item(id, options = {}) {
  return {
    itemid: id, hostid: '10', name: 'Item ' + id, key_: 'key.' + id, units: '', value_type: '3',
    status: '0', state: '0', error: '', delay: '1m', master_itemid: '0',
    lastvalue: '1', lastclock: String(clock), preprocessing: [], valuemap: [],
    ...options,
  }
}

function trigger(id, options = {}) {
  return {
    triggerid: id, description: 'Independent fault', value: '0', status: '0', state: '0',
    priority: '3', lastchange: String(clock - 60), hosts: [{ hostid: '10' }], items: [{ itemid: '20', hostid: '10' }],
    ...options,
  }
}

function row(itemid, time, value, ns = 0) {
  return { itemid, clock: String(time), value: String(value), ns: String(ns) }
}

async function fixture(t) {
  const calls = []
  const items = new Map()
  const triggers = new Map()
  const histories = new Map()
  const hosts = [
    { hostid: '10', host: 'local', name: 'Lab router', status: '0' },
    { hostid: '11', host: 'second', name: 'Second server', status: '0' },
  ]
  const handlers = {}
  const server = createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const { jsonrpc, method, params, id, ...rest } = JSON.parse(Buffer.concat(chunks).toString())
      calls.push({ method, params, authorization: req.headers.authorization })
      assert.equal(req.method, 'POST')
      assert.equal(req.url, '/api_jsonrpc.php')
      assert.equal(req.headers['content-type'], 'application/json-rpc')
      assert.equal(jsonrpc, '2.0')
      assert.deepEqual(rest, {})
      assert.ok(Number.isSafeInteger(id))
      assert.equal(req.headers.authorization, method === 'apiinfo.version' ? undefined : 'Bearer ' + secret)
      let result
      if (handlers[method]) result = await handlers[method](params)
      else if (method === 'apiinfo.version') result = '7.0.32'
      else if (method === 'host.get') result = hosts.filter((host) => !params.hostids || params.hostids.includes(host.hostid))
      else if (method === 'item.get') {
        result = [...items.values()].filter((entry) =>
          (!params.itemids || params.itemids.includes(entry.itemid)) &&
          (!params.hostids || params.hostids.includes(entry.hostid)))
      } else if (method === 'trigger.get') {
        result = [...triggers.values()].filter((entry) =>
          (!params.triggerids || params.triggerids.includes(entry.triggerid)) &&
          (!params.hostids || entry.hosts.some((host) => params.hostids.includes(host.hostid))))
      } else if (method === 'history.get') {
        result = (histories.get(params.itemids[0]) ?? []).filter((entry) => Number(entry.clock) >= params.time_from && Number(entry.clock) <= params.time_till)
      } else throw Error('Unexpected method ' + method)
      if (Array.isArray(result) && params.limit) result = result.slice(0, params.limit)
      if (res.destroyed) return
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ jsonrpc, id, ...(result?.error ? result : { result }) }))
    } catch (error) {
      res.statusCode = 500
      res.end(error.stack)
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  const url = 'http://127.0.0.1:' + server.address().port + '/api_jsonrpc.php'
  return { config: { url, token: secret }, calls, items, triggers, histories, hosts, handlers }
}

module.exports = { fixture, item, trigger, row, now, clock, secret }
