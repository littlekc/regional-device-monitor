'use client'

import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { MonitorConfig, Region } from '@/lib/contracts'
import { createConfigId } from '@/lib/config-edit'
import { adminApi } from '@/lib/monitor-client'
import { getDeviceStatus, sortRegions } from '@/lib/monitor-data'
import { ConfigDriftNotice, EditFeedback, useAdminConfig, useConfigEdit } from '@/components/admin/admin-config'
import { PageHeader } from '@/components/admin/admin-shell'
import { AdminDialog, ConfirmDialog, DeleteConfigDialog } from '@/components/admin/admin-dialog'
import { notify } from '@/components/admin/toast'

function RegionForm({ region, regions, version, reload, onSaved, onCancel }: {
  region?: Region
  regions: Region[]
  version: number
  reload: () => Promise<MonitorConfig>
  onSaved: (config: MonitorConfig) => void
  onCancel: () => void
}) {
  const [id] = useState(() => region?.id ?? createConfigId('r'))
  const [name, setName] = useState(region?.name ?? '')
  const [order, setOrder] = useState(String(region?.order ?? Math.min(1_000_000, Math.max(0, ...regions.map((item) => item.order)) + 1)))
  const [nameError, setNameError] = useState('')
  const edit = useConfigEdit(version, reload)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (edit.busy || edit.needsReload) return
    if (!name.trim()) return setNameError('请填写区域名称。')
    const result = await edit.save((baseVersion) => adminApi.saveRegion(baseVersion, { id, name: name.trim(), order: Number(order) }, Boolean(region)))
    if (result) {
      notify(region ? '区域已保存' : '区域已添加')
      onSaved(result)
    }
  }

  return (
    <form className="modal-form" onSubmit={submit} data-busy={edit.busy}>
      <div className="field">
        <label htmlFor="rf-name">区域名称</label>
        <input id="rf-name" className="input" required maxLength={64} value={name} disabled={edit.busy} onChange={(event) => { setName(event.target.value); setNameError('') }} />
        {nameError && <p className="field-error" role="alert">{nameError}</p>}
      </div>
      <div className="field">
        <label htmlFor="rf-order">显示顺序</label>
        <input id="rf-order" className="input input-short" type="number" required min={0} max={1_000_000} step="1" value={order} disabled={edit.busy} onChange={(event) => setOrder(event.target.value)} aria-describedby="rf-order-hint" />
        <p id="rf-order-hint" className="field-hint">数字越小，在大屏中越靠前</p>
      </div>
      <EditFeedback edit={edit} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={edit.busy}>取消</button>
        <button type="submit" className="btn btn-primary" disabled={edit.busy || edit.needsReload}>{edit.busy ? '处理中…' : '保存'}</button>
      </div>
    </form>
  )
}

export function RegionsPage() {
  const { config, snapshot, applyConfig, reloadConfig } = useAdminConfig()
  const [editing, setEditing] = useState<{ region?: Region; version: number } | null>(null)
  const [deleting, setDeleting] = useState<{ region: Region; version: number } | null>(null)
  const [blocked, setBlocked] = useState<{ region: Region; count: number } | null>(null)

  const regions = useMemo(() => sortRegions(config.regions), [config.regions])
  const devices = config.projects
  const readings = snapshot?.version === config.version ? snapshot.devices : []

  function stats(regionId: string) {
    const list = devices.filter((device) => device.regionId === regionId)
    const visible = list.filter((device) => !device.hidden)
    const observed = readings.filter((device) => device.regionId === regionId && !device.hidden)
    return {
      total: list.length,
      unknown: observed.length !== visible.length || observed.some((device) => getDeviceStatus(device) === 'unknown'),
      hidden: list.length - visible.length,
      error: observed.filter((device) => getDeviceStatus(device) === 'error').length,
    }
  }

  function requestDelete(region: Region) {
    const count = devices.filter((device) => device.regionId === region.id).length
    if (count > 0) setBlocked({ region, count })
    else setDeleting({ region, version: config.version })
  }

  return (
    <div className="admin-page">
      <PageHeader
        title="区域管理"
        count={regions.length}
        actions={<button type="button" className="btn btn-primary" onClick={() => setEditing({ version: config.version })}><Plus size={15} aria-hidden="true" />添加区域</button>}
      />

      <ConfigDriftNotice />

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="col-narrow">顺序</th>
              <th scope="col">区域名称</th>
              <th scope="col">项目数</th>
              <th scope="col">大屏异常</th>
              <th scope="col"><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {regions.length === 0 && <tr><td colSpan={5} className="empty-cell">暂无区域</td></tr>}
            {regions.map((region) => {
              const s = stats(region.id)
              return (
                <tr key={region.id}>
                  <td className="col-narrow mono">{region.order}</td>
                  <td><span className="cell-strong">{region.name}</span></td>
                  <td>{s.total}{s.hidden > 0 && <span className="cell-sub">其中 {s.hidden} 项未展示</span>}</td>
                  <td>{s.error > 0 ? <span className="status-tag tone-error"><i aria-hidden="true" />{s.error} 项</span> : <span className="cell-muted">{s.unknown ? "未确认" : "无"}</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-button" onClick={() => setEditing({ region, version: config.version })} aria-label={`编辑 ${region.name}`} title="编辑"><Pencil size={15} aria-hidden="true" /></button>
                      <button type="button" className="icon-button icon-danger" onClick={() => requestDelete(region)} aria-label={`删除 ${region.name}`} title="删除"><Trash2 size={15} aria-hidden="true" /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <AdminDialog open={editing !== null} onClose={() => setEditing(null)} title={editing?.region ? '编辑区域' : '添加区域'}>
        {editing && <RegionForm key={editing.region?.id ?? 'new'} region={editing.region} regions={regions} version={editing.version} reload={reloadConfig} onSaved={(next) => { applyConfig(next); setEditing(null) }} onCancel={() => setEditing(null)} />}
      </AdminDialog>

      {deleting && (
        <DeleteConfigDialog
          title="删除区域"
          message={<>确定删除「{deleting.region.name}」？该区域当前没有项目，删除后将从大屏移除。</>}
          version={deleting.version}
          reload={reloadConfig}
          remove={(version) => adminApi.deleteRegion(version, deleting.region.id)}
          onSaved={(next) => { applyConfig(next); setDeleting(null) }}
          onClose={() => setDeleting(null)}
        />
      )}
      <ConfirmDialog
        open={blocked !== null}
        title="无法删除区域"
        message={<>「{blocked?.region.name}」中还有 {blocked?.count} 个项目。请先在「监控项目」中把它们移到其他区域或删除，再删除该区域。</>}
        infoOnly
        onClose={() => setBlocked(null)}
      />
    </div>
  )
}
