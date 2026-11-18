const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MonitorDatabase } = require('../lib/server/database.ts')
const { MonitorEngine } = require('../lib/server/snapshot.ts')
const { HistoryService } = require('../lib/server/history-series.ts')
const { DEFAULT_SETTINGS } = require('../lib/contracts.ts')
const { fixture, item, now, clock } = require('./server-fixture.cjs')

const wan = { id: 'wan', name: 'WAN', type: 'line', regionId: 'r', order: 0, hidden: false, allowOffline: false,
  hostId: '10', statusItemId: '20', statusMapping: { online: ['1'], offline: ['2'] },
  metric: { kind: 'traffic', uploadItemId: '21', downloadItemId: '22', uploadMax: 10000000, downloadMax: 10000000 }, triggerIds: [] }
const router = { ...wan, id: 'router', type: 'router', statusItemId: '23', metric: { kind: 'resources', cpuItemId: '24', memoryItemId: '25' } }
const config = { url: 'https://192.0.2.11', token: 'private-ikuai-test-token', tlsServerName: 'ikuai.work', hostId: '10',
  bindings: [{ projectId: 'wan', statusItemId: '20', kind: 'traffic', interface: 'wan1' }, { projectId: 'router', statusItemId: '23', kind: 'resources' }] }
const interfaces = { iface_check: [{ interface: 'wan1', result: 'success' }],
  iface_stream: [{ interface: 'wan1', upload: 125000, download: 250000, connect_num: '42', ip_addr: '198.51.100.2' }] }

test('two routers using the same path and interface keep independent samples and failures', async () => {
  const { IkuaiService } = require('../lib/server/ikuai.ts')
  const second = { ...config, hostId: '11', url: 'https://192.0.2.12', token: 'second-test-token' }
  const calls = []
  const service = new IkuaiService({ request: async c => {
    calls.push(c.hostId)
    return c.hostId === '10' ? interfaces : { iface_check: [{ interface: 'wan1', result: 'fail' }],
      iface_stream: [{ interface: 'wan1', upload: 0, download: 0, connect_num: 0 }] }
  } })
  const projects = [wan, { ...wan, hostId: '11' }]
  const sources = [config, second]
  const read = () => Promise.all(sources.map(c => service.live(c, projects)))
  const [samples] = await Promise.all([read(), read()])
  const devices = projects.map((p, i) => service.overlay(sources[i], p, {}, samples[i]))
  assert.deepEqual(calls.sort(), ['10', '11'])
  assert.equal(devices[0].connections, 42)
  assert.equal(devices[1].connections, 0)
  assert.equal(devices[1].statusReason, 'link_check_failed')
})
const system = { sysinfo: { uptime: 120, cpu: ['32.01%', '22.45%', '34.31%'], memory: { used: '34%' } } }

async function setup(t) {
  const source = await fixture(t)
  const db = new MonitorDatabase(':memory:'); t.after(() => db.close())
  db.createRegion(0, { id: 'r', name: 'r', order: 0 })
  db.updateSettings(1, { ...DEFAULT_SETTINGS, refreshSeconds: 1 }, source.config)
  db.createProject(2, wan); db.createProject(3, router)
  for (const id of ['20','21','22','23','24','25']) source.items.set(id, item(id))
  assert.equal(typeof db.configureIkuai, 'function', 'server-only SQLite iKuai configuration must exist')
  db.configureIkuai(4, config)
  const { IkuaiService } = require('../lib/server/ikuai.ts')
  let time = now; const calls = []
  let response = structuredClone(interfaces); let sys = structuredClone(system); let fail = false
  const native = new IkuaiService({ now: () => time, request: async (_config, path) => {
    calls.push(path)
    if (fail) throw Error('upstream secret ' + config.token)
    if (path.includes('/monitoring/cpu?')) return { cpu: [{ timestamp: clock - 60, cpu: 25 }, { timestamp: clock, cpu: 40 }] }
    if (path.includes('/monitoring/memory?')) return { memory: [{ timestamp: clock - 60, memory_use: 34 }, { timestamp: clock, memory_use: 35 }] }
    return path.endsWith('/system') ? sys : response
  } })
  const engine = new MonitorEngine(db, { now: () => time, timeoutMs: 300, retries: 0, ikuai: native })
  return { source, db, engine, native, calls, time: (delta) => { time = now + delta },
    fail: () => { fail = true }, recover: () => { fail = false }, interfaces: (v) => { response = v }, system: (v) => { sys = v } }
}

test('native live source supplies per-WAN bps/count/IP and aggregate CPU/memory, coalesces and redacts', async (t) => {
  const s = await setup(t)
  const both = await Promise.all([s.engine.read(), s.engine.read()])
  assert.equal(s.calls.length, 2, 'one request per endpoint for all cards and browsers')
  const w = both[0].devices.find(d => d.id === 'wan'); const r = both[0].devices.find(d => d.id === 'router')
  assert.equal(w.liveSource, 'ikuai'); assert.equal(w.uploadValue, 1000000); assert.equal(w.downloadValue, 2000000)
  assert.equal(w.connections, 42); assert.equal(w.connectionsScope, 'port'); assert.deepEqual(w.wanIps, ['198.51.100.2'])
  assert.equal(w.statusReason, 'online'); assert.equal(w.offlineSince, undefined)
  assert.equal(r.cpuValue, 32.01); assert.equal(r.memoryValue, 34); assert.equal(r.statusReason, 'online')
  assert.equal(w.statusClock, now); assert.equal(w.clockBasis, 'received')
  assert.ok(!JSON.stringify(both).includes(config.token)); assert.ok(!JSON.stringify(s.db.readConfig()).includes(config.token))
  assert.equal(s.db.readState().routers[0].token, config.token)
  s.time(4999); const cached = await s.engine.read(); assert.equal(s.calls.length, 2)
  assert.ok(cached.devices.every(d => d.statusReason === 'online'), 'five-second cache remains fresh')
  s.time(5000); await s.engine.read(); assert.equal(s.calls.length, 4)
})

test('native failure clears values without Zabbix fallback and permits recovery; missing values stay missing', async (t) => {
  const s = await setup(t); await s.engine.read()
  s.fail(); s.time(5001)
  const down = await s.engine.read()
  for (const d of down.devices) { assert.equal(d.statusReason, 'source_unavailable'); assert.equal(d.reachable, false); assert.equal(d.uploadValue, undefined); assert.equal(d.cpuValue, undefined) }
  assert.ok(!JSON.stringify(down).includes(config.token))
  s.recover(); s.interfaces({ ...interfaces, iface_stream: [{ interface: 'wan1', connect_num: '--', upload: null, download: -1 }] })
  s.system({ sysinfo: { uptime: 125, cpu: ['100%'], memory: { used: '--' } } }); s.time(10002)
  const back = await s.engine.read(); const w = back.devices.find(d=>d.id==='wan'); const r=back.devices.find(d=>d.id==='router')
  assert.equal(w.statusReason, 'online'); assert.equal(w.uploadValue, undefined); assert.equal(w.connections, undefined)
  assert.equal(r.cpuValue, 100); assert.equal(r.memoryValue, undefined); assert.equal(r.hasFault, false)
})

test('missing or duplicate interfaces never borrow another line and changed binding ceases native override', async (t) => {
  const s = await setup(t)
  s.interfaces({ ...interfaces, iface_check: [{ interface: 'wan2', result: 'success' }], iface_stream: [{ interface: 'wan2', upload: 1, download: 2, connect_num: 300 }] })
  let w=(await s.engine.read()).devices.find(d=>d.id==='wan')
  assert.equal(w.statusAvailable, false); assert.equal(w.connections, undefined)
  s.time(5001); s.interfaces({ ...interfaces, iface_stream: [...interfaces.iface_stream, ...interfaces.iface_stream] })
  w=(await s.engine.read()).devices.find(d=>d.id==='wan'); assert.equal(w.connections, undefined)
  s.db.updateProject(s.db.readConfig().version, 'wan', { ...wan, statusItemId: '99' })
  w=(await s.engine.read()).devices.find(d=>d.id==='wan'); assert.equal(w.liveSource, undefined)
})

test('native resource history uses timestamped API percentages, not current values or Zabbix history', async (t) => {
  const s=await setup(t); const history=new HistoryService(s.db, () => now, 300, s.native)
  const result=await history.read('router','24h')
  assert.equal(result.source.provider,'ikuai'); assert.equal(result.series.length,2)
  assert.equal(result.series[0].summary.max,40); assert.equal(result.series[1].summary.max,35)
  assert.ok(result.series[0].values.includes(null)); assert.equal(result.connectivity.coverage,'unavailable')
  assert.ok(s.calls.some(x=>x.includes('datetype=day')))
  assert.equal(s.source.calls.filter(x=>x.method==='history.get').length,0)
  assert.ok(!JSON.stringify(result).includes(config.token))
})

test('slow Zabbix refresh cannot delay native live updates after initial snapshot', async (t) => {
  const s = await setup(t); await s.engine.read()
  s.source.handlers['item.get'] = async () => { await new Promise(r => setTimeout(r, 200)); return [...s.source.items.values()] }
  s.time(10001)
  const read = s.engine.read()
  const ready = await Promise.race([read.then(() => true), new Promise(r => setTimeout(() => r(false), 80))])
  await read
  assert.equal(ready, true, 'native live data must not wait for slow cached-source refresh')
  await new Promise(r => setTimeout(r, 450))
})

test('native deadline releases in-flight reads, coalesces failure and recovers', async () => {
  const { IkuaiService } = require('../lib/server/ikuai.ts')
  let time=now, stall=true, calls=0
  const service=new IkuaiService({ now:()=>time, timeoutMs:30, request: async (_c,_p,signal) => {
    calls++; if (!stall) return interfaces
    return new Promise((_resolve,reject) => signal.addEventListener('abort',()=>reject(Error('private upstream error')), {once:true}))
  } })
  const keepAlive=setTimeout(()=>{},200)
  try {
    const reads=await Promise.all([service.read(config,'/test'),service.read(config,'/test')])
    assert.equal(calls,1); assert.ok(reads.every(r=>!r.ok)); assert.ok(!JSON.stringify(reads).includes('private'))
    stall=false;time+=5001
    assert.equal((await service.read(config,'/test')).ok,true); assert.equal(calls,2)
  } finally {clearTimeout(keepAlive)}
})

test('native SQLite extension survives close, reopen and backup without exposing token in config', async (t) => {
  const { mkdtempSync, rmSync } = require('node:fs'); const { tmpdir } = require('node:os'); const { join } = require('node:path')
  const { backup } = require('node:sqlite')
  const dir=mkdtempSync(join(tmpdir(),'ikuai-persistence-')); const path=join(dir,'monitor.db'); const copy=join(dir,'backup.db')
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let db=new MonitorDatabase(path)
  try {
    db.createRegion(0,{id:'r',name:'r',order:0}); db.createProject(1,wan); db.createProject(2,router)
    db.configureIkuai(3,config); await backup(db.sqlite,copy); db.close(); db=new MonitorDatabase(path)
    assert.equal(db.readState().routers[0].token,config.token); assert.ok(!JSON.stringify(db.readConfig()).includes(config.token))
    const restored=new MonitorDatabase(copy)
    try {assert.deepEqual(restored.readState().routers[0],config)} finally {restored.close()}
  } finally {db.close()}
})
