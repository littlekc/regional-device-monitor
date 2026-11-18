const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args)
}
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename)
}

const settings = { columns: 8, gaugeSize: 100, palette: 'harbor', refreshSeconds: 5 }
const region = { id: 'area', name: '测试区域', order: 0 }
const config = { version: 5, regions: [region], projects: [], settings, connection: { url: '', tokenConfigured: false } }
const online = {
  id: 'p1', name: '测试设备', type: 'line', regionId: region.id, order: 0,
  reachable: true, statusAvailable: true, allowOffline: false, hasFault: false, faultAvailable: true,
  statusReason: 'online', metricKind: 'percent', metricLabel: '负荷', metricValue: 100, metricUnit: '%', statusClock: 60000,
}
const snapshot = { version: 5, regions: [region], settings, devices: [online], source: { status: 'ok' }, serverTime: 61000 }
const element = React.createElement
const render = (component, props) => renderToStaticMarkup(element(component, props))

test('compact Mbps gauges use four places with integer hundreds and keep semantic labels outside the circle', () => {
  const { formatGaugeRate, rateScale } = require('../lib/monitor-data.ts')
  for (const [value, expected] of [[0, '0.00'], [1.234, '1.23'], [9.999, '10.0'], [12.34, '12.3'], [99.99, '100'], [123.9, '124'], [9999, '9999'], [10000, '超限']]) {
    assert.equal(formatGaugeRate(value * 1e6), expected)
  }
  assert.deepEqual(rateScale(123), { unit: 'Mbps', divisor: 1e6 })
  const { DeviceUnit, getStatusText } = require('../components/device-gauge.tsx')
  const traffic = { ...online, metricKind: 'traffic', uploadValue: 1234000, downloadValue: 123000000, wanIps: ['203.0.113.2'] }
  const html = render(DeviceUnit, { device: traffic, now: 61000 })
  const center = html.split('class="gauge-center"')[1].split('class="gauge-badge"')[0]
  assert.match(center, /1\.23/)
  assert.match(center, /123/)
  assert.doesNotMatch(center, /Mbps|kbps|CPU|内存/)
  assert.equal(getStatusText(traffic, 'normal', 61000), '203.0.113.2')
  assert.equal(getStatusText({ ...traffic, wanIps: [] }, 'normal', 61000), 'IP 未获取')
  assert.match(getStatusText({ ...traffic, reachable: false }, 'error', 61000), /离线/)
  const resource = render(DeviceUnit, { device: { ...online, metricKind: 'resources', cpuValue: 12, memoryValue: 34 }, now: 61000 })
  const resourceCenter = resource.split('class="gauge-center"')[1].split('class="gauge-badge"')[0]
  assert.doesNotMatch(resourceCenter, /CPU|内存/)
  assert.match(resource, /CPU 12\.0%.*内存 34\.0%/)
})

test('scalar rate units and empty history axes also use Mbps, and missing scalar labels stay outside', () => {
  const { DeviceUnit, getReading } = require('../components/device-gauge.tsx')
  for (const [value, unit] of [[1.234, 'Mbps'], [1234, 'kbps'], [154250, 'Bps']]) {
    const reading = getReading({ ...online, metricKind: 'rate', metricValue: value, metricUnit: unit })
    assert.equal(reading.value, '1.23')
    assert.equal(reading.unit, 'Mbps')
  }
  const html = render(DeviceUnit, { device: { ...online, metricValue: undefined, metricLabel: 'CPU' }, now: 61000 })
  assert.doesNotMatch(html.split('class="gauge-center"')[1].split('class="gauge-badge"')[0], /CPU/)
  const { buildHistoryAxes } = require('../lib/history-chart.ts')
  assert.equal(buildHistoryAxes('traffic', []).left.unit, 'Mbps')
  const axis = buildHistoryAxes('rate', [{ role: 'value', unit: 'Bps', values: [125000] }]).left
  assert.equal(axis.unit, 'Mbps')
  assert.equal(axis.divisor, 125000)
})

test('missing metrics stay independent of status and 100% is normal', () => {
  const { getDeviceStatus } = require('../lib/monitor-data.ts')
  const { DeviceUnit, getReading } = require('../components/device-gauge.tsx')
  const missing = { ...online, metricValue: undefined }
  assert.equal(getDeviceStatus(missing), 'normal')
  assert.equal(getReading(missing).kind, 'missing')
  assert.match(render(DeviceUnit, { device: missing, now: 61000 }), /gs-normal gr-missing/)
  assert.equal(getReading(online).value, '100')
  assert.equal(getReading(online).progress, 1)
  assert.equal(getDeviceStatus(online), 'normal')
  const rate = getReading({ ...online, metricKind: 'rate', metricValue: 125000000, metricUnit: 'bps' })
  assert.deepEqual(rate, { kind: 'value', value: '125', unit: 'Mbps', label: '负荷', progress: 0 })
  assert.equal(getReading({ ...online, metricKind: 'power', metricValue: 0, metricUnit: 'W', metricMax: 200 }).value, '0.0')
})

test('independent current fault outranks allowed offline and has separate alarm time', () => {
  const { getDeviceStatus } = require('../lib/monitor-data.ts')
  const { DeviceUnit, getStatusText, getReading } = require('../components/device-gauge.tsx')
  const alarm = { ...online, reachable: false, allowOffline: true, hasFault: true, faultMessage: '供电异常', alarmSince: 59000 }
  assert.equal(getDeviceStatus(alarm), 'error')
  assert.equal(getReading(alarm).kind, 'offline')
  assert.match(getStatusText(alarm, 'error', 61000), /供电异常.*离线，时长未知/)
  const html = render(DeviceUnit, { device: alarm, now: 61000 })
  assert.match(html, /gs-error-offline gr-offline/)
  assert.match(html, /告警开始/)
  assert.match(html, /状态采样/)
  assert.equal(getDeviceStatus({ ...alarm, faultAvailable: false }), 'offline')
  assert.equal(getDeviceStatus({ ...alarm, statusAvailable: false }), 'unknown')
})

test('empty dashboard uses its actual configuration and contains no sample gauges', () => {
  const { DashboardView } = require('../components/monitor-dashboard.tsx')
  const empty = { ...snapshot, settings: { columns: 3, gaugeSize: 125, palette: 'jade', refreshSeconds: 10 }, devices: [], source: { status: 'empty' } }
  const html = render(DashboardView, { snapshot: empty, now: 61000, failed: false })
  assert.match(html, /暂无监控项目/)
  assert.match(html, /data-palette="jade"/)
  assert.doesNotMatch(html, /--gauge-scale:/)
  assert.match(html, /href="\/admin\/projects"/)
  assert.doesNotMatch(html, /class="device-unit|演示数据|样例/)
})

test('the dashboard clock waits for server time and advances its date across midnight', () => {
  const { default: MonitorDashboard, DashboardView } = require('../components/monitor-dashboard.tsx')
  const prerenderedClock = render(MonitorDashboard).match(/class="clock"[^>]*>(.*?)<\/div>/)[1]
  assert.doesNotMatch(prerenderedClock, /\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/)

  const beforeMidnight = new Date(2026, 10, 16, 23, 59, 59).getTime()
  const first = render(DashboardView, { snapshot: { ...snapshot, serverTime: beforeMidnight }, failed: false })
  const rollover = render(DashboardView, { snapshot: { ...snapshot, serverTime: beforeMidnight }, now: beforeMidnight + 1000, failed: false })
  assert.match(first, /class="clock"[^>]*>.*2026-11-16.*23:59:59/)
  assert.match(rollover, /class="clock"[^>]*>.*2026-11-17.*00:00:00/)
})

test('split traffic readings retain zero and independent channels without invented capacity or a count', () => {
  const { DeviceUnit, getReading } = require('../components/device-gauge.tsx')
  const traffic = { ...online, metricKind: 'traffic', uploadValue: 0, downloadValue: 4200000, downloadClock: 61000 }
  const reading = getReading(traffic)
  assert.equal(reading.kind, 'traffic')
  assert.deepEqual(reading.upload, { value: '0.00', unit: 'Mbps', progress: undefined })
  assert.deepEqual(reading.download, { value: '4.20', unit: 'Mbps', progress: undefined })
  const html = render(DeviceUnit, { device: traffic, now: 61000 })
  assert.match(html, /上传 0\.00 Mbps.*连接数 无读数.*下载 4\.20 Mbps/)
  assert.match(html, /下载采样/)
  assert.doesNotMatch(html, /gauge-split(?:-track)? is-/)
  const withCapacity = { ...traffic, uploadValue: undefined, uploadMax: 10000, downloadMax: 2000000, connectionsScope: 'port', connections: 0 }
  assert.equal(getReading(withCapacity).upload.progress, undefined)
  assert.equal(getReading(withCapacity).download.progress, 1)
  assert.match(render(DeviceUnit, { device: withCapacity, now: 61000 }), /上传 无读数.*端口连接数 0 个.*下载 4\.20 Mbps/)
  assert.match(render(DeviceUnit, { device: { ...withCapacity, connectionsScope: 'host' }, now: 61000 }), /主机连接数 0 个/)
  assert.equal(getReading({ ...traffic, reachable: false }).kind, 'offline')
  assert.equal(getReading({ ...traffic, statusAvailable: false }).kind, 'unknown')
})

test('traffic editor converts independent capacities and requires a scope for a bound count', () => {
  const { buildTrafficMetric, draftTrafficMetric } = require('../lib/traffic-form.ts')
  const draft = { uploadItemId: '101', downloadItemId: '102', connectionsItemId: '', connectionsScope: '', uploadMbps: '12.5', downloadMbps: '' }
  const metric = { kind: 'traffic', uploadItemId: '101', downloadItemId: '102', uploadMax: 12500000 }
  assert.deepEqual(buildTrafficMetric(draft), { metric })
  assert.deepEqual(draftTrafficMetric(metric), draft)
  assert.match(buildTrafficMetric({ ...draft, downloadItemId: '101' }).error, /不同/)
  assert.match(buildTrafficMetric({ ...draft, uploadMbps: '0' }).error, /正数/)
  assert.match(buildTrafficMetric({ ...draft, connectionsItemId: '103' }).error, /范围/)
  assert.match(buildTrafficMetric({ ...draft, connectionsScope: 'port' }).error, /请选择连接数监控项/)
  assert.deepEqual(buildTrafficMetric({ ...draft, connectionsItemId: '103', connectionsScope: 'port' }), {
    metric: { ...metric, connectionsItemId: '103', connectionsScope: 'port' },
  })
})

test('traffic editor excludes the whole-router iKuai count from the port picker', () => {
  const { trafficCountCandidate } = require('../lib/traffic-form.ts')
  const item = { id: '103', key: 'ikuai.metric["connections"]', units: '', valueType: '3' }
  assert.equal(trafficCountCandidate(item, 'port'), false)
  assert.equal(trafficCountCandidate(item, 'host'), true)
  assert.equal(trafficCountCandidate({ ...item, key: 'router.port.connections[wan1]' }, 'port'), true)
  assert.equal(trafficCountCandidate({ ...item, key: 'net.if.in[wan1]', units: 'bps' }, 'port'), false)
})

test('traffic editor filters other WAN interfaces and flags a draft after its status binding changes', () => {
  const { trafficRateCandidate } = require('../lib/traffic-catalog.ts')
  const { draftRateIssue } = require('../lib/traffic-form.ts')
  const statusOne = { id: '100', key: 'net.if.status[ifOperStatus.1]' }
  const statusTwo = { id: '200', key: 'net.if.status[ifOperStatus,2]' }
  const wanOneUpload = { id: '101', key: 'net.if.out[ifHCOutOctets.1]', units: 'bps', valueType: '3' }
  const wanTwoUpload = { ...wanOneUpload, id: '201', key: 'net.if.out[ifHCOutOctets.2]' }
  const wanTwoDownload = { ...wanTwoUpload, id: '202', key: 'net.if.in[ifInOctets,2]' }
  assert.equal(trafficRateCandidate(wanOneUpload, 'upload', statusOne), true)
  assert.equal(trafficRateCandidate(wanTwoUpload, 'upload', statusOne), false)
  assert.equal(trafficRateCandidate(wanTwoDownload, 'download', statusTwo), true)
  assert.equal(trafficRateCandidate(wanTwoDownload, 'upload', statusTwo), false)
  assert.equal(trafficRateCandidate(wanTwoUpload, 'upload', { id: '300', key: 'agent.ping' }), true)
  assert.match(draftRateIssue(statusOne, wanTwoUpload, wanTwoDownload), /上传.*下载/)
  assert.equal(draftRateIssue(statusTwo, wanTwoUpload, wanTwoDownload), undefined)
})

test('compatible scalar modes retain source and display fields while traffic clears scalar bindings', () => {
  const { metricModeChange } = require('../lib/traffic-form.ts')
  const draft = { mode: 'rate', valueItemId: '12', label: '写入速率', unit: 'Bps', max: '200', capacity: '' }
  assert.deepEqual({ ...draft, ...metricModeChange('rate', 'raw') }, { ...draft, mode: 'raw' })
  assert.deepEqual({ ...draft, ...metricModeChange('rate', 'percent') }, { ...draft, mode: 'percent', unit: '', max: '' })
  const traffic = { ...draft, ...metricModeChange('rate', 'traffic') }
  assert.equal(traffic.valueItemId, '')
  assert.equal(traffic.label, '')
  assert.equal(traffic.uploadItemId, '')
})

test('history chart separates the rate and count scales and preserves zero, null and explicit breaks', () => {
  const { buildHistoryAxes, historySegments } = require('../lib/history-chart.ts')
  const upload = { key: 'upload', role: 'rate', unit: 'bps', values: [0, 2500000, null, 2000000, 1000000], breaks: [false, false, false, true, true] }
  const download = { key: 'download', role: 'rate', unit: 'bps', values: [5000000], breaks: [false] }
  const connections = { key: 'connections', role: 'count', unit: '个', values: [4], breaks: [false] }
  const axes = buildHistoryAxes('traffic', [upload, download, connections])
  assert.equal(axes.left.unit, 'Mbps')
  assert.equal(axes.left.max, 5000000)
  assert.equal(axes.right.unit, '个')
  assert.equal(axes.right.min, 0)
  assert.equal(axes.right.max, 4)
  assert.deepEqual(historySegments(upload), [
    [{ index: 0, value: 0 }, { index: 1, value: 2500000 }],
    [{ index: 3, value: 2000000 }], [{ index: 4, value: 1000000 }],
  ])
  assert.equal(buildHistoryAxes('traffic', [upload]).right.max, undefined)
  assert.equal(buildHistoryAxes('traffic', [{ ...upload, values: [0] }]).left.min, 0)
})

test('stale status warns in the source badge without changing an unrelated online project', () => {
  const { DashboardView } = require('../components/monitor-dashboard.tsx')
  const stale = {
    ...online, id: 'stale', name: '过期项目', statusAvailable: false, reachable: false,
    statusReason: 'status_stale', metricValue: undefined,
  }
  const missing = { ...online, metricValue: undefined }
  const renderDashboard = (devices) => render(DashboardView, { snapshot: { ...snapshot, devices }, now: 61000, failed: false })
  const html = renderDashboard([stale, missing])
  assert.match(html, /class="monitor-warning"[^>]*>采集数据过期/)
  assert.match(html, /过期项目.*gs-unknown gr-unknown/)
  assert.match(html, /测试设备.*gs-normal gr-missing/)

  const hiddenStale = renderDashboard([{ ...stale, hidden: true }, missing])
  assert.doesNotMatch(hiddenStale, /monitor-warning|source-badge/)
  assert.doesNotMatch(hiddenStale, /采集数据过期|过期项目/)
})


test('native gauge evidence labels API receipt times rather than device sample times', () => {
  const { DeviceUnit } = require('../components/device-gauge.tsx')
  const html = renderToStaticMarkup(React.createElement(DeviceUnit, { device: { ...online,
    liveSource: 'ikuai', clockBasis: 'received', metricKind: 'resources', cpuValue: 31, cpuClock: 60000, memoryValue: 34, memoryClock: 60000 }, now: 60000 }))
  assert.match(html, /API 接收/); assert.match(html, /服务端接收时间/); assert.doesNotMatch(html, /状态采样|CPU 采样|内存采样/)
})

test('five-second polling accounts for response duration and never overlaps slow requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 60000 })
  const { startSnapshotPolling } = require('../lib/snapshot-polling.ts')
  const pending = []
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal })))
  const visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const poll = startSnapshotPolling('/api/snapshot', () => {}, visibility); t.after(poll.stop)
  t.mock.timers.tick(400)
  pending[0].resolve(Response.json({ ...snapshot, settings: { ...settings, refreshSeconds: 5 } }))
  await new Promise(setImmediate)
  t.mock.timers.tick(4599); assert.equal(pending.length, 1)
  t.mock.timers.tick(1); assert.equal(pending.length, 2)
  t.mock.timers.tick(6000); visibility.dispatchEvent(new Event('visibilitychange')); assert.equal(pending.length, 2)
  pending[1].resolve(Response.json({ ...snapshot, settings: { ...settings, refreshSeconds: 5 } }))
  await new Promise(setImmediate)
  t.mock.timers.tick(50); assert.equal(pending.length, 3)
})

test('snapshot polling is sequential across timers and visibility, retries and aborts on cleanup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 60000 })
  const { startSnapshotPolling } = require('../lib/snapshot-polling.ts')
  const pending = []
  const updates = []
  const visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const mockedFetch = t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(url, '/api/snapshot')
    assert.equal(options.cache, 'no-store')
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject, signal: options.signal })
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
  })
  const poll = startSnapshotPolling('/api/snapshot', (state) => updates.push(state), visibility)
  t.after(poll.stop)
  const flush = () => new Promise(setImmediate)
  visibility.dispatchEvent(new Event('visibilitychange'))
  t.mock.timers.tick(400)
  assert.equal(mockedFetch.mock.callCount(), 1)
  pending[0].resolve(Response.json({ ...snapshot, devices: [{ ...online, metricKind: 'traffic', uploadValue: 1, downloadValue: 2, connectionsScope: 'port', connections: 3 }, { ...online, id: 'p2', metricKind: 'resources', cpuValue: 100, memoryValue: 0 }] }))
  await flush()
  assert.equal(updates.at(-1).snapshot.version, 5)
  assert.equal(updates.at(-1).clockOffset, 600)
  t.mock.timers.tick(4599)
  assert.equal(mockedFetch.mock.callCount(), 1)
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(mockedFetch.mock.callCount(), 2)
  t.mock.timers.tick(10000)
  await flush()
  assert.ok(pending[1].signal.aborted)
  assert.equal(updates.at(-1).failed, true)
  assert.equal(updates.at(-1).snapshot.devices[0].statusAvailable, false)
  assert.equal(updates.at(-1).snapshot.devices[0].metricValue, undefined)
  assert.equal(updates.at(-1).snapshot.devices[0].uploadValue, undefined)
  assert.equal(updates.at(-1).snapshot.devices[0].downloadValue, undefined)
  assert.equal(updates.at(-1).snapshot.devices[0].connections, undefined)
  assert.equal(updates.at(-1).snapshot.devices[1].statusAvailable, false)
  assert.equal(updates.at(-1).snapshot.devices[1].cpuValue, undefined)
  assert.equal(updates.at(-1).snapshot.devices[1].memoryValue, undefined)
  t.mock.timers.tick(5000)
  assert.equal(mockedFetch.mock.callCount(), 3)
  pending[2].resolve(Response.json({ ...snapshot, version: 6, settings: { ...settings, refreshSeconds: 10 } }))
  await flush()
  assert.equal(updates.at(-1).snapshot.version, 6)
  assert.equal(updates.at(-1).failed, false)
  t.mock.timers.tick(9999)
  assert.equal(mockedFetch.mock.callCount(), 3)
  t.mock.timers.tick(1)
  assert.equal(mockedFetch.mock.callCount(), 4)
  poll.stop()
  assert.ok(pending[3].signal.aborted)
  visibility.dispatchEvent(new Event('visibilitychange'))
  await flush()
  assert.equal(mockedFetch.mock.callCount(), 4)
  assert.equal(updates.length, 3)
})

test('an in-flight admin snapshot coalesces explicit refreshes into one immediate follow-up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { startSnapshotPolling } = require('../lib/snapshot-polling.ts')
  const visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const updates = []
  const pending = []
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(url, '/api/admin/snapshot')
    return new Promise((resolve, reject) => {
      pending.push({ resolve, signal: options.signal })
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
  })
  const poll = startSnapshotPolling('/api/admin/snapshot', (state) => updates.push(state), visibility)
  t.after(poll.stop)
  const flush = () => new Promise(setImmediate)
  const slowSettings = { ...settings, refreshSeconds: 3600 }

  pending[0].resolve(Response.json({ ...snapshot, settings: slowSettings }))
  await flush()
  t.mock.timers.tick(3_600_000)
  assert.equal(pending.length, 2)

  poll.refresh()
  poll.refresh()
  visibility.dispatchEvent(new Event('visibilitychange'))
  assert.equal(pending.length, 2, 'the request started before the save is still in flight')
  pending[1].resolve(Response.json({ ...snapshot, settings: slowSettings }))
  await flush()
  assert.equal(pending.length, 3, 'start one replacement request without waiting another hour')

  pending[2].resolve(Response.json({ ...snapshot, version: 7, settings: slowSettings }))
  await flush()
  assert.equal(updates.at(-1).snapshot.version, 7)
  assert.equal(pending.length, 3, 'repeated requests were coalesced')

  poll.refresh()
  poll.refresh()
  poll.stop()
  assert.ok(pending[3].signal.aborted)
  await flush()
  t.mock.timers.tick(3_600_000)
  assert.equal(pending.length, 4, 'cleanup cancels the queued refresh')
})

test('admin checks the session before config and signs in with the password only', async (t) => {
  const { loadAdminConfig, adminApi } = require('../lib/monitor-client.ts')
  const responses = [
    Response.json({ error: { code: 'unauthorized', message: 'Expired' } }, { status: 401 }),
    Response.json({ authenticated: true, expiresAt: 1000 }),
    Response.json({ authenticated: true, expiresAt: 1000 }),
    Response.json(config),
  ]
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options.method, options.credentials, options.body && JSON.parse(options.body)])
    return responses.shift()
  })
  assert.equal(await loadAdminConfig(), null)
  assert.equal(calls.length, 1)
  await adminApi.login('test-only-password')
  assert.deepEqual(await loadAdminConfig(), config)
  assert.deepEqual(calls, [
    ['/api/admin/session', 'GET', 'same-origin', undefined],
    ['/api/admin/login', 'POST', 'same-origin', { password: 'test-only-password' }],
    ['/api/admin/session', 'GET', 'same-origin', undefined],
    ['/api/admin/config', 'GET', 'same-origin', undefined],
  ])
})

test('version conflict leaves the draft alone and requires an explicit reload before retry', async (t) => {
  const { createConfigEdit } = require('../lib/config-edit.ts')
  const { adminApi } = require('../lib/monitor-client.ts')
  const draft = { ...region, name: '未保存草稿' }
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = options.body && JSON.parse(options.body)
    calls.push([url, options.method, body])
    if (options.method === 'GET') return Response.json({ ...config, version: 6 })
    if (body.version === 5) return Response.json({ error: { code: 'version_conflict', message: '配置已更新' } }, { status: 409 })
    return Response.json({ ...config, version: 7, regions: [draft] })
  })
  const edit = createConfigEdit(5)
  const submit = () => edit.save((version) => adminApi.saveRegion(version, draft, true))
  await assert.rejects(submit, { code: 'version_conflict' })
  assert.ok(edit.needsReload)
  await assert.rejects(submit, { code: 'version_conflict' })
  assert.equal(calls.length, 1)
  assert.deepEqual(draft, { ...region, name: '未保存草稿' })
  await edit.reload(adminApi.config)
  assert.equal(edit.needsReload, false)
  assert.deepEqual((await submit()).regions, [draft])
  assert.deepEqual(calls, [
    ['/api/admin/regions/area', 'PUT', { version: 5, region: draft }],
    ['/api/admin/config', 'GET', undefined],
    ['/api/admin/regions/area', 'PUT', { version: 6, region: draft }],
  ])
})

test('fault and order controls remain in initially collapsed more settings', () => {
  const { ProjectForm } = require('../components/admin/project-form.tsx')
  const project = {
    ...region, name: '测试项目', regionId: region.id, type: 'line', hostId: '10', statusItemId: '20',
    statusMapping: { online: ['1'], offline: [] }, metric: { kind: 'none' }, triggerIds: ['30'],
    allowOffline: false, hidden: false,
  }
  const html = render(ProjectForm, { project, regions: [region], version: 5, defaultRegionId: region.id, onSaved() {}, reload() {}, onCancel() {} })
  const more = html.match(/<details\b([^>]*class="form-section more-settings"[^>]*)>([\s\S]*?)<\/details>/)
  assert.ok(more, 'more settings disclosure exists')
  assert.doesNotMatch(more[1], /\bopen\b/)
  assert.match(more[2], /pf-order/)
  assert.match(more[2], /pf-triggerIds/)
})

test('project list retains exactly the approved six columns', () => {
  const { AdminConfigContext } = require('../components/admin/admin-config.tsx')
  const { ProjectsPage } = require('../components/admin/projects-page.tsx')
  const html = renderToStaticMarkup(element(AdminConfigContext.Provider, {
    value: { config, snapshotFailed: false, applyConfig() {}, reloadConfig() {}, signOut() {} },
  }, element(ProjectsPage)))
  const headers = [...html.matchAll(/<th scope="col">(.*?)<\/th>/g)].map((m) => m[1])
  assert.deepEqual(headers, ['项目名称', '区域', '类型', '当前状态', '当前读数', '操作'])
})

test('authenticated tools search the real catalog and can use the stored token in a connection test', async (t) => {
  const { adminApi } = require('../lib/monitor-client.ts')
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options.method, options.credentials, options.body && JSON.parse(options.body)])
    return url.endsWith('/test')
      ? Response.json({ status: 'no_items', message: '没有可用样本。' })
      : Response.json({ results: [], hasMore: false })
  })
  const signal = new AbortController().signal
  await adminApi.hosts('core switch', signal)
  await adminApi.items('100', 'agent.ping', signal)
  await adminApi.triggers('100', '102', signal)
  assert.equal((await adminApi.testConnection({})).status, 'no_items')
  assert.deepEqual(calls, [
    ['/api/admin/zabbix/hosts?q=core+switch', 'GET', 'same-origin', undefined],
    ['/api/admin/zabbix/items?q=agent.ping&hostId=100', 'GET', 'same-origin', undefined],
    ['/api/admin/zabbix/triggers?q=102&hostId=100', 'GET', 'same-origin', undefined],
    ['/api/admin/zabbix/test', 'POST', 'same-origin', {}],
  ])
})

test('admin content is gated during initial session validation', () => {
  const { AdminShell } = require('../components/admin/admin-shell.tsx')
  const html = renderToStaticMarkup(element(AdminShell, null, element('div', null, 'ADMIN_TEST_CONTENT')))
  assert.match(html, /正在验证管理员会话/)
  assert.doesNotMatch(html, /ADMIN_TEST_CONTENT|后台导航/)
})

test('admin lists signal external version drift and recover when the latest config is loaded', () => {
  const { AdminConfigContext } = require('../components/admin/admin-config.tsx')
  const { ProjectsPage } = require('../components/admin/projects-page.tsx')
  const { RegionsPage } = require('../components/admin/regions-page.tsx')
  const project = {
    id: online.id, name: online.name, type: online.type, regionId: region.id,
    order: 0, hidden: false, allowOffline: false, hostId: '10', statusItemId: '20',
    statusMapping: { online: ['1'], offline: [] }, valueItemId: '21', metric: { kind: 'percent' }, triggerIds: [],
  }
  const serverConfig = { ...config, projects: [project] }
  const newer = { ...snapshot, version: serverConfig.version + 1 }
  function renderPage(Page, currentConfig, currentSnapshot) {
    return renderToStaticMarkup(element(AdminConfigContext.Provider, {
      value: { config: currentConfig, snapshot: currentSnapshot, snapshotFailed: false, applyConfig() {}, reloadConfig() {}, signOut() {} },
    }, element(Page)))
  }
  const staleProjects = renderPage(ProjectsPage, serverConfig, newer)
  const staleRegions = renderPage(RegionsPage, serverConfig, newer)
  for (const html of [staleProjects, staleRegions]) {
    assert.match(html, /检测到配置更新/)
    assert.match(html, /读取最新配置/)
  }
  assert.match(staleProjects, /status-tag tone-unknown/)
  assert.doesNotMatch(staleProjects, />100%</)
  assert.match(staleRegions, /未确认/)
  const latestConfig = { ...serverConfig, version: newer.version }
  const syncedProjects = renderPage(ProjectsPage, latestConfig, newer)
  const syncedRegions = renderPage(RegionsPage, latestConfig, newer)
  assert.match(syncedProjects, /status-tag tone-normal/)
  assert.match(syncedProjects, />100%</)
  assert.doesNotMatch(syncedRegions, /未确认/)
  assert.doesNotMatch(syncedProjects + syncedRegions, /检测到配置更新/)
})

test('resource gauges render two independent percentages and history uses a shared 0–100% axis', () => {
  const { DeviceUnit, getReading } = require('../components/device-gauge.tsx')
  const { buildHistoryAxes } = require('../lib/history-chart.ts')
  const resources = { ...online, metricKind: 'resources', cpuValue: 100, cpuClock: 61000 }
  const reading = getReading(resources)
  assert.equal(reading.kind, 'resources')
  assert.equal(reading.cpu.progress, 1)
  assert.equal(reading.memory.value, '—')
  const html = render(DeviceUnit, { device: resources, now: 61000 })
  assert.match(html, /gs-normal gr-resources/)
  assert.match(html, /CPU 100\.0%.*内存 无读数/)
  assert.match(html, /gauge-split is-up/)
  assert.doesNotMatch(html, /gauge-split is-down/)
  assert.match(render(DeviceUnit, { device: { ...resources, cpuValue: undefined, memoryValue: 0 }, now: 61000 }), /CPU 无读数.*内存 0\.0%/)
  const mixed = render(DeviceUnit, { device: { ...resources, cpuValue: 79.9, memoryValue: 80 }, now: 61000 })
  assert.match(mixed, /stroke-dasharray:0\.799[0-9]* 1/)
  assert.match(mixed, /stroke-dasharray:0\.8 1/)
  assert.match(mixed, /gs-normal/, 'load color does not manufacture a fault')
  assert.equal(getReading({ ...resources, reachable: false }).kind, 'offline')
  assert.match(render(DeviceUnit, { device: { ...resources, reachable: false }, now: 61000 }), /CPU 无读数.*内存 无读数/)
  assert.deepEqual(buildHistoryAxes('resources', []), { left: { unit: '%', divisor: 1, min: 0, max: 100 } })
})

test('traffic center displays a connection count without a visible label', () => {
  const { DeviceUnit } = require('../components/device-gauge.tsx')
  const html = render(DeviceUnit, { device: { ...online, metricKind: 'traffic', connections: 42, connectionsScope: 'port' }, now: 61000 })
  assert.match(html, /端口连接数 42 个/)
  const unbound = render(DeviceUnit, { device: { ...online, metricKind: 'traffic' }, now: 61000 })
  assert.match(unbound, /连接数 无读数/)
  assert.match(unbound, /class="gauge-conn">—</)
  assert.doesNotMatch(unbound, />连接</)
})

test('resource editor round trips both selected items and clears bindings when switching kinds', () => {
  const { draftResourceMetric, buildResourceMetric } = require('../lib/resource-metric.ts')
  const { metricModeChange } = require('../lib/traffic-form.ts')
  const metric = { kind: 'resources', cpuItemId: '21', memoryItemId: '22' }
  const resourceDraft = draftResourceMetric(metric)
  assert.deepEqual(buildResourceMetric(resourceDraft, '20'), { metric })
  assert.match(buildResourceMetric(resourceDraft, '21').error, /状态/)
  assert.match(buildResourceMetric({ ...resourceDraft, memoryItemId: '21' }, '20').error, /不同/)
  assert.equal(metricModeChange('resources', 'rate').cpuItemId, '')
  assert.equal(metricModeChange('resources', 'traffic').memoryItemId, '')
  assert.equal(metricModeChange('traffic', 'resources').uploadItemId, '')
  assert.equal(metricModeChange('percent', 'resources').valueItemId, '')
})
