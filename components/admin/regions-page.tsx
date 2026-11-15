'use client'

import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { getDeviceStatus, sortRegions, type Region } from '@/lib/monitor-data'
import { createId, demoApi, useDemoState } from '@/lib/demo-store'
import { PageHeader } from '@/components/admin/admin-shell'
import { AdminDialog, ConfirmDialog } from '@/components/admin/admin-dialog'
import { notify } from '@/components/admin/toast'

type RegionDraft = { name: string; order: string }
type RegionErrors = Partial<Record<keyof RegionDraft, string>>

function RegionForm({ region, regions, onDone, onCancel }: { region?: Region; regions: Region[]; onDone: () => void; onCancel: () => void }) {
  const nextOrder = Math.max(0, ...regions.map((item) => item.order)) + 1
  const [draft, setDraft] = useState<RegionDraft>({ name: region?.name ?? '', order: String(region?.order ?? nextOrder) })
  const [errors, setErrors] = useState<RegionErrors>({})

  function validate(next: RegionDraft): RegionErrors {
    const result: RegionErrors = {}
    const name = next.name.trim()
    if (!name) result.name = '请填写区域名称'
    else if (regions.some((item) => item.id !== region?.id && item.name === name)) result.name = '已存在同名区域'
    const order = Number(next.order)
    if (!Number.isInteger(order) || order < 1) result.order = '请输入大于 0 的整数'
    return result
  }

  function patch(next: Partial<RegionDraft>) {
    const merged = { ...draft, ...next }
    setDraft(merged)
    if (Object.keys(errors).length) setErrors(validate(merged))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors = validate(draft)
    setErrors(nextErrors)
    if (nextErrors.name) return document.getElementById('rf-name')?.focus()
    if (nextErrors.order) return document.getElementById('rf-order')?.focus()
    await demoApi.saveRegion({ id: region?.id ?? createId('r'), name: draft.name.trim(), order: Number(draft.order) })
    notify(region ? '区域已保存' : '区域已添加')
    onDone()
  }

  return (
    <form className="modal-form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="rf-name">区域名称<span className="required" aria-hidden="true">*</span></label>
        <input id="rf-name" className="input" value={draft.name} maxLength={20} aria-invalid={Boolean(errors.name) || undefined} aria-describedby={errors.name ? 'rf-name-error' : undefined} onChange={(e) => patch({ name: e.target.value })} placeholder="如：E区 · 仓储区" />
        {errors.name && <p id="rf-name-error" className="field-error">{errors.name}</p>}
      </div>
      <div className="field">
        <label htmlFor="rf-order">显示顺序<span className="required" aria-hidden="true">*</span></label>
        <input id="rf-order" className="input input-short" inputMode="numeric" value={draft.order} aria-invalid={Boolean(errors.order) || undefined} aria-describedby={errors.order ? 'rf-order-error' : 'rf-order-hint'} onChange={(e) => patch({ order: e.target.value })} />
        {errors.order ? <p id="rf-order-error" className="field-error">{errors.order}</p> : <p id="rf-order-hint" className="field-hint">数字越小，在大屏中越靠前</p>}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>取消</button>
        <button type="submit" className="btn btn-primary">保存</button>
      </div>
    </form>
  )
}

export function RegionsPage() {
  const demo = useDemoState()
  const [editing, setEditing] = useState<{ region?: Region } | null>(null)
  const [deleting, setDeleting] = useState<Region | null>(null)
  const [blocked, setBlocked] = useState<{ region: Region; count: number } | null>(null)

  const regions = useMemo(() => sortRegions(demo?.regions ?? []), [demo?.regions])
  const devices = demo?.devices ?? []

  function stats(regionId: string) {
    const list = devices.filter((device) => device.regionId === regionId)
    const visible = list.filter((device) => !device.hidden)
    return {
      total: list.length,
      hidden: list.length - visible.length,
      error: visible.filter((device) => getDeviceStatus(device) === 'error').length,
    }
  }

  function requestDelete(region: Region) {
    const count = devices.filter((device) => device.regionId === region.id).length
    if (count > 0) setBlocked({ region, count })
    else setDeleting(region)
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await demoApi.deleteRegion(deleting.id)
    if (result.ok) notify(`已删除「${deleting.name}」`)
    else notify(result.reason, 'error')
    setDeleting(null)
  }

  return (
    <div className="admin-page">
      <PageHeader
        title="区域管理"
        count={regions.length}
        actions={<button type="button" className="btn btn-primary" onClick={() => setEditing({})}><Plus size={15} aria-hidden="true" />添加区域</button>}
      />

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
                  <td>{s.error > 0 ? <span className="status-tag tone-error"><i aria-hidden="true" />{s.error} 项</span> : <span className="cell-muted">无</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-button" onClick={() => setEditing({ region })} aria-label={`编辑 ${region.name}`} title="编辑"><Pencil size={15} aria-hidden="true" /></button>
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
        {editing && <RegionForm key={editing.region?.id ?? 'new'} region={editing.region} regions={regions} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </AdminDialog>

      <ConfirmDialog
        open={deleting !== null}
        title="删除区域"
        message={<>确定删除「{deleting?.name}」？该区域当前没有项目，删除后将从大屏移除。</>}
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
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
