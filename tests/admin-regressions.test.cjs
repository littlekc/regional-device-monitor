const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args)
}
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const data = require('../lib/monitor-data.ts')
const gauge = require('../components/device-gauge.tsx')
const { renderToStaticMarkup } = require('react-dom/server')
const React = require('react')
const mock = require('../lib/zabbix-mock.ts')
const base = { id: 'test', name: '测试', regionId: 'a', type: 'power', reachable: false, allowOffline: true, hasFault: true, statusAvailable: true, faultMessage: '供电异常', offlineSince: 1000 }
function store(initial = {}) {
  const values = new Map(Object.entries(initial))
  global.window = { localStorage: { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) }, addEventListener() {}, removeEventListener() {}, setTimeout }
  const reload = () => { delete require.cache[require.resolve('../lib/demo-store.ts')]; return require('../lib/demo-store.ts') }
  return { values, reload }
}

test('empty saved collections remain empty after reload', async () => {
  const s = store({ 'region-monitor-demo-data': '[]', 'region-monitor-regions': '[]' })
  await s.reload().demoApi.saveSettings({ zabbixUrl: '', apiToken: '', refreshSeconds: 10 })
  assert.deepEqual(JSON.parse(s.values.get('region-monitor-demo-data')), [])
  assert.deepEqual(JSON.parse(s.values.get('region-monitor-regions')), [])
})
test('deleting the last items persists through a fresh module load', async () => {
  const s = store({ 'region-monitor-demo-data': JSON.stringify([{...base, hasFault:false}]), 'region-monitor-regions': JSON.stringify([{id:'a',name:'A',order:1}]) })
  const api = s.reload().demoApi
  await api.deleteDevice('test'); await api.deleteRegion('a')
  await s.reload().demoApi.saveSettings({ zabbixUrl:'', apiToken:'', refreshSeconds:10 })
  assert.equal(JSON.parse(s.values.get('region-monitor-demo-data')).length, 0)
  assert.equal(JSON.parse(s.values.get('region-monitor-regions')).length, 0)
})
test('current independent fault outranks allowed offline in status and display', () => {
  assert.equal(data.getDeviceStatus(base), 'error')
  assert.match(renderToStaticMarkup(React.createElement(gauge.DeviceUnit,{device:base,now:61000})), /tone-error/)
  assert.match(gauge.getStatusText(base,'error',61000), /供电异常/)
  assert.match(gauge.getStatusText(base,'error',61000), /离线/)
  assert.equal(gauge.getReading(base).kind, 'offline')
})
test('explicitly stale/unavailable fault is not a current alarm', () => {
  const d = {...base, faultAvailable:false}
  assert.equal(data.getDeviceStatus(d), 'offline')
  assert.doesNotMatch(gauge.getStatusText(d,'offline',61000), /供电异常/)
})
test('unknown status always wins over allowed offline and fault', () => {
  const d = {...base, statusAvailable:false}
  assert.equal(data.getDeviceStatus(d), 'unknown')
  assert.equal(gauge.getStatusText(d,'unknown',61000), '状态未知')
})
test('demo counts and cache edits/offline timestamps remain unchanged', () => {
  const seed=data.createDemoDevices(1000000000)
  const counts=seed.reduce((c,d)=>(c[data.getDeviceStatus(d)]++,c), {normal:0,error:0,offline:0,unknown:0})
  assert.deepEqual(counts,{normal:71,error:6,offline:11,unknown:1})
  const edited={...seed[0],name:'用户编辑',offlineSince:12345,hidden:true,metricValue:undefined}
  assert.deepEqual(data.migrateCachedDevices([edited]),[edited])
})
test('renaming an offline bound project preserves its offline start', () => {
  const d={...base,hasFault:false,hostId:'h-term-02',statusItemId:'i-term02-ping'}
  const draft=mock.draftFromDevice(d); draft.name='新名称'
  assert.equal(mock.resolveDraft(draft,d.id,999999,d).offlineSince,1000)
})
test('fault and order controls live in initially collapsed more settings', () => {
  const {ProjectForm}=require('../components/admin/project-form.tsx')
  const html=renderToStaticMarkup(React.createElement(ProjectForm,{device:{...base,hostId:'h-pdu-02',statusItemId:'i-pdu02-ping'},regions:[{id:'a',name:'A',order:1}],defaultRegionId:'a',onDone(){},onCancel(){}}))
  const more=html.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/)
  assert.ok(more,'more settings disclosure exists')
  assert.doesNotMatch(more[1], /\bopen\b/)
  assert.match(more[2], /pf-order/); assert.match(more[2], /pf-faultItemId/)
})
test('shared summary counts fault as error and hidden projects are excluded', () => {
  const {countStatuses}=require('../components/monitor-dashboard.tsx')
  assert.deepEqual(countStatuses(data.getVisibleDevices([base,{...base,id:'hidden',hidden:true},{...base,id:'unknown',statusAvailable:false} ])),{normal:0,error:1,offline:0,unknown:1})
})
test('CRUD, hiding and region guard persist without duplicating hosts', async () => {
  const s=store({'region-monitor-demo-data':'[]','region-monitor-regions':'[]'})
  const api=s.reload().demoApi
  await api.saveRegion({id:'a',name:'区域',order:1})
  await api.saveDevice({...base,hostId:'same-host'})
  await api.saveDevice({...base,id:'second',hostId:'same-host'})
  await api.setDeviceHidden('test',true)
  assert.equal((await api.deleteRegion('a')).ok,false)
  await s.reload().demoApi.saveSettings({zabbixUrl:'demo',apiToken:'demo',refreshSeconds:10})
  const saved=JSON.parse(s.values.get('region-monitor-demo-data'))
  assert.equal(saved.length,2); assert.equal(saved[0].hidden,true); assert.equal(saved[0].offlineSince,1000)
})
test('new mock bindings retain fault availability and correct zero/100 readings', () => {
  for (const [hostId,statusItemId,valueItemId,mode,value] of [['h-pdu-01','i-pdu01-ping','i-pdu01-power','power','0.0'],['h-srv-db','i-db-agent','i-db-cpu','percent','100']]) {
    const draft={...mock.draftFromDevice(undefined,'a'),name:'测试',hostId,statusItemId,valueItemId,mode}
    const device=mock.resolveDraft(draft,'new',1000)
    assert.equal(data.getDeviceStatus(device),'normal')
    assert.equal(gauge.getReading(device).value,value)
  }
})
test('project list has exactly the requested six columns', () => {
  const {ProjectsPage}=require('../components/admin/projects-page.tsx')
  const html=renderToStaticMarkup(React.createElement(ProjectsPage))
  const headers=[...html.matchAll(/<th scope="col">(.*?)<\/th>/g)].map(m=>m[1])
  assert.deepEqual(headers,['项目名称','区域','类型','当前状态','当前读数','操作'])
})
