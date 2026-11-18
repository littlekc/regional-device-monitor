'use client'

import { useMemo, useState } from 'react'
import { Eye, EyeOff, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { MonitorProject, SnapshotDevice } from '@/lib/contracts'
import { adminTypeLabels, compareOrder, connectionsLabel, getDeviceStatus, sortRegions } from '@/lib/monitor-data'
import { adminApi, MonitorRequestError, requestErrorMessage } from '@/lib/monitor-client'
import { ConfigDriftNotice, useAdminConfig } from '@/components/admin/admin-config'
import { getReading } from '@/components/device-gauge'
import { PageHeader, StatusTag } from '@/components/admin/admin-shell'
import { AdminDialog, DeleteConfigDialog } from '@/components/admin/admin-dialog'
import { ProjectForm } from '@/components/admin/project-form'
import { notify } from '@/components/admin/toast'

type Editing = { project?: MonitorProject; version: number } | null

function displayText(project: MonitorProject, device?: SnapshotDevice) {
  if (project.metric.kind === 'none') return { main: '仅状态', sub: '' }
  const reading = device && getReading(device)
  if (project.metric.kind === 'resources') {
    const resources = reading?.kind === 'resources' ? reading : undefined
    return { main: `CPU ${resources?.cpu.value ?? '—'}`, sub: `内存 ${resources?.memory.value ?? '—'}` }
  }
  if (project.metric.kind === 'traffic') {
    const traffic = reading?.kind === 'traffic' ? reading : undefined
    const rate = (channel: 'upload' | 'download') => {
      const sample = traffic?.[channel]
      return sample?.value === undefined ? '—' : `${sample.value} ${sample.unit}`
    }
    return {
      main: `↑ ${rate('upload')} · ↓ ${rate('download')}`,
      sub: `${connectionsLabel(project.metric.connectionsScope)} ${traffic?.connections === undefined ? '—' : `${traffic.connections} 个`}`,
    }
  }
  return { main: reading?.kind === 'value' ? reading.value + reading.unit : '—', sub: ('label' in project.metric ? project.metric.label : '') ?? '' }
}

export function ProjectsPage() {
  const { config, snapshot, snapshotFailed, applyConfig, reloadConfig } = useAdminConfig()
  const readings = useMemo(() => new Map(snapshot?.version === config.version
    ? snapshot.devices.map((device) => [device.id, device] as const) : []), [snapshot, config.version])
  const [changing, setChanging] = useState(false)
  const [actionError, setActionError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<{ project: MonitorProject; version: number } | null>(null)

  const regions = useMemo(() => sortRegions(config.regions), [config.regions])
  const regionName = useMemo(() => Object.fromEntries(regions.map((region) => [region.id, region.name])), [regions])
  const regionRank = useMemo(() => Object.fromEntries(regions.map((region, index) => [region.id, index])), [regions])
  const devices = config.projects
  const filter = regions.some((region) => region.id === regionFilter) ? regionFilter : ''

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return devices
      .filter((device) => !filter || device.regionId === filter)
      .filter((device) => !q || device.name.toLowerCase().includes(q))
      .sort((a, b) => (regionRank[a.regionId] ?? 99) - (regionRank[b.regionId] ?? 99) || compareOrder(a, b))
  }, [devices, query, filter, regionRank])

  async function toggleHidden(project: MonitorProject) {
    if (changing || needsReload) return
    setActionError('')
    setChanging(true)
    try {
      applyConfig(await adminApi.saveProject(config.version, { ...project, hidden: !project.hidden }, true))
      notify(project.hidden ? '项目已在大屏展示' : '项目已从大屏隐藏')
    } catch (error) {
      setActionError(requestErrorMessage(error))
      if (error instanceof MonitorRequestError && error.code === 'version_conflict') setNeedsReload(true)
    } finally {
      setChanging(false)
    }
  }

  async function refreshConfig() {
    if (changing) return
    setChanging(true)
    try {
      await reloadConfig()
      setNeedsReload(false)
      setActionError('')
    } catch (error) {
      setActionError(requestErrorMessage(error))
    } finally {
      setChanging(false)
    }
  }

  return (
    <div className="admin-page">
      <PageHeader
        title="监控项目"
        count={devices.length}
        actions={
          <button type="button" className="btn btn-primary" disabled={regions.length === 0} onClick={() => setEditing({ version: config.version })}>
            <Plus size={15} aria-hidden="true" />新增项目
          </button>
        }
      />

      {!needsReload && <ConfigDriftNotice />}

      <div className="toolbar">
        <div className="input-with-icon toolbar-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" aria-label="搜索项目" placeholder="搜索项目名称" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="input toolbar-select" aria-label="按区域筛选" value={filter} onChange={(e) => setRegionFilter(e.target.value)}>
          <option value="">全部区域</option>
          {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
        <span className="toolbar-count">显示 {rows.length} 项</span>
      </div>

      {regions.length === 0 && <p className="field-hint">请先在区域管理中添加区域。</p>}
      {snapshotFailed && <p className="field-hint" role="status">无法读取当前状态，正在重试。</p>}
      {actionError && (
        <div className="edit-feedback">
          <p className="field-error" role="alert">{actionError}</p>
          {needsReload && <button type="button" className="btn btn-outline" disabled={changing} onClick={() => void refreshConfig()}>读取最新配置</button>}
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">项目名称</th>
              <th scope="col">区域</th>
              <th scope="col">类型</th>
              <th scope="col">当前状态</th>
              <th scope="col">当前读数</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="empty-cell">没有符合条件的项目</td></tr>
            )}
            {rows.map((device) => {
              const reading = readings.get(device.id)
              const display = displayText(device, reading)
              return (
                <tr key={device.id} className={device.hidden ? 'is-hidden' : ''}>
                  <td>
                    <span className="cell-strong">{device.name}</span>
                    {reading?.liveSource === 'ikuai' && <span className="cell-sub">爱快 API · 实时</span>}
                    {device.hidden && <span className="hidden-tag">未展示</span>}
                  </td>
                  <td>{regionName[device.regionId] ?? '未分配'}</td>
                  <td>{adminTypeLabels[device.type]}</td>
                  <td><StatusTag status={reading ? getDeviceStatus(reading) : 'unknown'} /></td>
                  <td><span>{display.main}</span>{display.sub && <span className="cell-sub">{display.sub}</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-button" onClick={() => setEditing({ project: device, version: config.version })} aria-label={`编辑 ${device.name}`} title="编辑"><Pencil size={15} aria-hidden="true" /></button>
                      <button type="button" className="icon-button" disabled={changing || needsReload} onClick={() => void toggleHidden(device)} aria-label={device.hidden ? `在大屏展示 ${device.name}` : `从大屏隐藏 ${device.name}`} title={device.hidden ? '在大屏展示' : '从大屏隐藏'}>
                        {device.hidden ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
                      </button>
                      <button type="button" className="icon-button icon-danger" onClick={() => setDeleting({ project: device, version: config.version })} aria-label={`删除 ${device.name}`} title="删除"><Trash2 size={15} aria-hidden="true" /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <AdminDialog open={editing !== null} onClose={() => setEditing(null)} title={editing?.project ? `编辑项目 · ${editing.project.name}` : '添加监控项目'} variant="drawer">
        {editing && (
          <ProjectForm
            key={editing.project?.id ?? 'new'}
            project={editing.project}
            hidden={editing.project && devices.find((project) => project.id === editing.project?.id)?.hidden}
            reading={editing.project && readings.get(editing.project.id)}
            now={snapshot?.serverTime}
            version={editing.version}
            reload={reloadConfig}
            regions={regions}
            defaultRegionId={filter || regions[0]?.id || ''}
            onSaved={(next) => { applyConfig(next); setEditing(null) }}
            onCancel={() => setEditing(null)}
          />
        )}
      </AdminDialog>

      {deleting && (
        <DeleteConfigDialog
          title="删除监控项目"
          message={<>确定删除「{deleting.project.name}」？Zabbix 仍会继续采集。</>}
          version={deleting.version}
          reload={reloadConfig}
          remove={(version) => adminApi.deleteProject(version, deleting.project.id)}
          onSaved={(next) => { applyConfig(next); setDeleting(null) }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
