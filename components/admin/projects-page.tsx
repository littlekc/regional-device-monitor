'use client'

import { useMemo, useState } from 'react'
import { Eye, EyeOff, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { adminTypeLabels, compareOrder, getDeviceStatus, sortRegions, type MonitorDevice } from '@/lib/monitor-data'
import { demoApi, useDemoState } from '@/lib/demo-store'
import { getHost, getItem } from '@/lib/zabbix-mock'
import { getReading } from '@/components/device-gauge'
import { PageHeader, StatusTag } from '@/components/admin/admin-shell'
import { AdminDialog, ConfirmDialog } from '@/components/admin/admin-dialog'
import { ProjectForm } from '@/components/admin/project-form'
import { notify } from '@/components/admin/toast'

type Editing = { device?: MonitorDevice } | null

function displayText(device: MonitorDevice) {
  const reading = getReading(device)
  if (!device.metricKind || device.metricKind === 'none') return { main: '仅状态', sub: '' }
  const kind = device.metricKind === 'percent' ? `百分比 · ${device.metricLabel ?? ''}` : `功率 · 满量程 ${device.metricMax ?? '-'}W`
  return { main: kind, sub: reading.kind === 'value' ? `${reading.value}${reading.unit}` : '无当前读数' }
}

export function ProjectsPage() {
  const demo = useDemoState()
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState('all')
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<MonitorDevice | null>(null)

  const regions = useMemo(() => sortRegions(demo?.regions ?? []), [demo?.regions])
  const regionName = useMemo(() => Object.fromEntries(regions.map((region) => [region.id, region.name])), [regions])
  const regionRank = useMemo(() => Object.fromEntries(regions.map((region, index) => [region.id, index])), [regions])
  const devices = demo?.devices ?? []

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return devices
      .filter((device) => regionFilter === 'all' || device.regionId === regionFilter)
      .filter((device) => !q || device.name.toLowerCase().includes(q) || getHost(device.hostId)?.name.toLowerCase().includes(q))
      .sort((a, b) => (regionRank[a.regionId] ?? 99) - (regionRank[b.regionId] ?? 99) || compareOrder(a, b))
  }, [devices, query, regionFilter, regionRank])

  async function toggleHidden(device: MonitorDevice) {
    await demoApi.setDeviceHidden(device.id, !device.hidden)
    notify(device.hidden ? `已在大屏展示「${device.name}」` : `已从大屏隐藏「${device.name}」`)
  }

  async function confirmDelete() {
    if (!deleting) return
    await demoApi.deleteDevice(deleting.id)
    notify(`已删除「${deleting.name}」`)
    setDeleting(null)
  }

  return (
    <div className="admin-page">
      <PageHeader
        title="监控项目"
        count={devices.length}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={15} aria-hidden="true" />添加项目
          </button>
        }
      />

      <div className="toolbar">
        <div className="input-with-icon toolbar-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" aria-label="搜索项目" placeholder="搜索项目或主机名称" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="input toolbar-select" aria-label="按区域筛选" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
          <option value="all">全部区域</option>
          {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
        <span className="toolbar-count">显示 {rows.length} 项</span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">项目名称</th>
              <th scope="col">区域</th>
              <th scope="col">类型</th>
              <th scope="col">来源主机 / 监控项</th>
              <th scope="col">圆图显示</th>
              <th scope="col">允许离线</th>
              <th scope="col">状态</th>
              <th scope="col"><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="empty-cell">没有符合条件的项目</td></tr>
            )}
            {rows.map((device) => {
              const host = getHost(device.hostId)
              const statusItem = getItem(device.statusItemId)
              const display = displayText(device)
              return (
                <tr key={device.id} className={device.hidden ? 'is-hidden' : ''}>
                  <td>
                    <span className="cell-strong">{device.name}</span>
                    {device.hidden && <span className="hidden-tag">未展示</span>}
                  </td>
                  <td>{regionName[device.regionId] ?? '未分配'}</td>
                  <td>{adminTypeLabels[device.type]}</td>
                  <td>
                    {host ? (
                      <><span className="cell-strong">{host.name}</span><span className="cell-sub mono">{statusItem?.key ?? '未选状态项'}</span></>
                    ) : (
                      <span className="cell-muted">演示数据 · 未绑定</span>
                    )}
                  </td>
                  <td><span>{display.main}</span>{display.sub && <span className="cell-sub">{display.sub}</span>}</td>
                  <td>{device.allowOffline ? '是' : <span className="cell-muted">否</span>}</td>
                  <td><StatusTag status={getDeviceStatus(device)} /></td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-button" onClick={() => setEditing({ device })} aria-label={`编辑 ${device.name}`} title="编辑"><Pencil size={15} aria-hidden="true" /></button>
                      <button type="button" className="icon-button" onClick={() => toggleHidden(device)} aria-label={device.hidden ? `在大屏展示 ${device.name}` : `从大屏隐藏 ${device.name}`} title={device.hidden ? '在大屏展示' : '从大屏隐藏'}>
                        {device.hidden ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
                      </button>
                      <button type="button" className="icon-button icon-danger" onClick={() => setDeleting(device)} aria-label={`删除 ${device.name}`} title="删除"><Trash2 size={15} aria-hidden="true" /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <AdminDialog open={editing !== null} onClose={() => setEditing(null)} title={editing?.device ? `编辑项目 · ${editing.device.name}` : '添加监控项目'} variant="drawer">
        {editing && (
          <ProjectForm
            key={editing.device?.id ?? 'new'}
            device={editing.device}
            regions={regions}
            defaultRegionId={regionFilter !== 'all' ? regionFilter : regions[0]?.id ?? ''}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </AdminDialog>

      <ConfirmDialog
        open={deleting !== null}
        title="删除监控项目"
        message={<>确定删除「{deleting?.name}」？删除后将从大屏和统计中移除，无法恢复。</>}
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
