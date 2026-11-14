'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { adminTypeLabels, type DeviceType, type MonitorDevice, type Region } from '@/lib/monitor-data'
import {
  KEEP_CURRENT,
  describeItemSample,
  draftFromDevice,
  formatUpdatedAgo,
  getHost,
  getHostItems,
  resolveDraft,
  validateDraft,
  type DisplayMode,
  type DraftErrors,
  type MockItem,
  type ProjectDraft,
} from '@/lib/zabbix-mock'
import { createId, demoApi } from '@/lib/demo-store'
import { DeviceUnit } from '@/components/device-gauge'
import { HostCombobox } from '@/components/admin/host-combobox'
import { notify } from '@/components/admin/toast'

const fieldOrder: (keyof DraftErrors)[] = ['name', 'regionId', 'hostId', 'statusItemId', 'valueItemId', 'powerMax', 'order']

const modeOptions: { value: DisplayMode; label: string; hint: string }[] = [
  { value: 'status', label: '仅状态', hint: '圆图只显示在线状态' },
  { value: 'percent', label: '百分比', hint: '量程固定 0–100%' },
  { value: 'power', label: '功率 W', hint: '按满量程换算比例' },
]

function Field({ id, label, error, hint, children, required }: { id: string; label: string; error?: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <span className="required" aria-hidden="true">*</span>}</label>
      {children}
      {error ? <p id={`${id}-error`} className="field-error">{error}</p> : hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}
    </div>
  )
}

function ItemChoices({ name, items, value, onChange, invalid, describedBy, extra }: {
  name: string
  items: MockItem[]
  value: string
  onChange: (id: string) => void
  invalid?: boolean
  describedBy?: string
  extra?: { id: string; title: string; meta: string }
}) {
  return (
    <div className={`item-choices ${invalid ? 'is-invalid' : ''}`} role="radiogroup" aria-describedby={describedBy} id={name}>
      {extra && (
        <label className={`item-choice ${value === extra.id ? 'is-selected' : ''}`}>
          <input type="radio" name={name} checked={value === extra.id} onChange={() => onChange(extra.id)} />
          <span className="item-main"><b>{extra.title}</b><span className="mono">演示数据</span></span>
          <span className="item-meta">{extra.meta}</span>
        </label>
      )}
      {items.map((item) => {
        const sampleText = describeItemSample(item)
        const isDown = item.role === 'status' && item.sample.state !== 'up'
        const isFault = item.role === 'fault' && item.active
        return (
          <label key={item.id} className={`item-choice ${value === item.id ? 'is-selected' : ''}`}>
            <input type="radio" name={name} checked={value === item.id} onChange={() => onChange(item.id)} />
            <span className="item-main"><b>{item.name}</b><span className="mono">{item.key}</span></span>
            <span className={`item-meta ${isDown || isFault ? 'is-warn' : ''}`}>
              {sampleText}<small>{formatUpdatedAgo(item.updatedAgoSec)}</small>
            </span>
          </label>
        )
      })}
    </div>
  )
}

export function ProjectForm({ device, regions, defaultRegionId, onDone, onCancel }: {
  device?: MonitorDevice
  regions: Region[]
  defaultRegionId: string
  onDone: () => void
  onCancel: () => void
}) {
  const [id] = useState(() => device?.id ?? createId('p'))
  const [now] = useState(() => Date.now())
  const [draft, setDraft] = useState<ProjectDraft>(() => draftFromDevice(device, defaultRegionId))
  const [errors, setErrors] = useState<DraftErrors>({})
  const [saving, setSaving] = useState(false)

  const host = getHost(draft.hostId)
  const statusItems = getHostItems(draft.hostId, 'status')
  const valueItems = draft.mode === 'status' ? [] : getHostItems(draft.hostId, draft.mode)
  const faultItems = getHostItems(draft.hostId, 'fault')
  const preview = useMemo(() => resolveDraft(draft, id, now, device), [draft, id, now, device])
  const canKeepValue = Boolean(device && !device.valueItemId && device.metricKind === draft.mode)

  function patch(next: Partial<ProjectDraft>) {
    setDraft((current) => {
      const merged = { ...current, ...next }
      if (Object.keys(errors).length) setErrors(validateDraft(merged, device))
      return merged
    })
  }

  function changeHost(hostId: string) {
    if (hostId === draft.hostId) return
    const statusDefault = getHostItems(hostId, 'status')[0]?.id ?? ''
    patch({ hostId, statusItemId: statusDefault, valueItemId: '', faultItemId: '' })
  }

  function changeMode(mode: DisplayMode) {
    const keep = device && !device.valueItemId && device.metricKind === mode ? KEEP_CURRENT : ''
    const values = mode === 'status' ? [] : getHostItems(draft.hostId, mode)
    patch({ mode, valueItemId: keep || (values.length === 1 ? values[0].id : '') })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors = validateDraft(draft, device)
    setErrors(nextErrors)
    const first = fieldOrder.find((key) => nextErrors[key])
    if (first) {
      document.getElementById(`pf-${first}`)?.focus()
      return
    }
    setSaving(true)
    await demoApi.saveDevice(resolveDraft(draft, id, Date.now(), device))
    setSaving(false)
    notify(device ? '项目已保存' : '项目已添加')
    onDone()
  }

  const describe = (key: keyof DraftErrors, hasHint = false) => (errors[key] ? `pf-${key}-error` : hasHint ? `pf-${key}-hint` : undefined)

  return (
    <form className="project-form" onSubmit={handleSubmit} noValidate>
      <div className="form-scroll">
        <section className="form-section" aria-labelledby="pf-basic">
          <h3 id="pf-basic">基本信息</h3>
          <div className="form-grid">
            <Field id="pf-name" label="项目名称" error={errors.name} required>
              <input id="pf-name" className="input" value={draft.name} maxLength={24} aria-invalid={Boolean(errors.name) || undefined} aria-describedby={describe('name')} onChange={(e) => patch({ name: e.target.value })} placeholder="如：A-服务器07" />
            </Field>
            <Field id="pf-regionId" label="所属区域" error={errors.regionId} required>
              <select id="pf-regionId" className="input" value={draft.regionId} aria-invalid={Boolean(errors.regionId) || undefined} aria-describedby={describe('regionId')} onChange={(e) => patch({ regionId: e.target.value })}>
                <option value="" disabled>请选择区域</option>
                {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
              </select>
            </Field>
            <Field id="pf-type" label="设备类型">
              <select id="pf-type" className="input" value={draft.type} onChange={(e) => patch({ type: e.target.value as DeviceType })}>
                {(Object.keys(adminTypeLabels) as DeviceType[]).map((type) => <option key={type} value={type}>{adminTypeLabels[type]}</option>)}
              </select>
            </Field>
            <Field id="pf-order" label="显示顺序" error={errors.order} hint="留空则按默认顺序；异常项目仍会优先显示">
              <input id="pf-order" className="input" inputMode="numeric" value={draft.order} aria-invalid={Boolean(errors.order) || undefined} aria-describedby={describe('order', true)} onChange={(e) => patch({ order: e.target.value })} placeholder="例如 10" />
            </Field>
          </div>
        </section>

        <section className="form-section" aria-labelledby="pf-source">
          <h3 id="pf-source">数据来源 <span className="section-tag">测试数据 · 模拟 Zabbix</span></h3>
          <Field id="pf-hostId" label="来源主机" error={errors.hostId} required={!device || Boolean(device.hostId)} hint={device && !device.hostId && !draft.hostId ? '该项目为演示数据，尚未绑定主机；可保持未绑定' : undefined}>
            <HostCombobox id="pf-hostId" value={draft.hostId} onChange={changeHost} invalid={Boolean(errors.hostId)} describedBy={describe('hostId', Boolean(device && !device.hostId && !draft.hostId))} />
          </Field>

          {host && (
            <>
              <div className="field">
                <span className="field-label" id="pf-statusItemId-label">状态监控项<span className="required" aria-hidden="true">*</span></span>
                <ItemChoices name="pf-statusItemId" items={statusItems} value={draft.statusItemId} onChange={(statusItemId) => patch({ statusItemId })} invalid={Boolean(errors.statusItemId)} describedBy={describe('statusItemId')} />
                {errors.statusItemId && <p id="pf-statusItemId-error" className="field-error">{errors.statusItemId}</p>}
              </div>
              {faultItems.length > 0 && (
                <Field id="pf-faultItemId" label="故障监控项" hint="可选；触发时圆图显示红色故障">
                  <select id="pf-faultItemId" className="input" value={draft.faultItemId} aria-describedby="pf-faultItemId-hint" onChange={(e) => patch({ faultItemId: e.target.value })}>
                    <option value="">不绑定</option>
                    {faultItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {describeItemSample(item)}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
        </section>

        <section className="form-section" aria-labelledby="pf-display">
          <h3 id="pf-display">圆图显示</h3>
          <div className="segmented" role="radiogroup" aria-label="显示内容">
            {modeOptions.map((option) => (
              <label key={option.value} className={`segment ${draft.mode === option.value ? 'is-selected' : ''}`}>
                <input type="radio" name="pf-mode" value={option.value} checked={draft.mode === option.value} onChange={() => changeMode(option.value)} />
                <b>{option.label}</b>
                <small>{option.hint}</small>
              </label>
            ))}
          </div>

          {draft.mode !== 'status' && (
            <div className="field">
              <span className="field-label">数值监控项<span className="required" aria-hidden="true">*</span></span>
              {!host && !canKeepValue ? (
                <p className="field-hint">请先选择来源主机</p>
              ) : valueItems.length === 0 && !canKeepValue ? (
                <p className="field-hint">该主机没有可用的{draft.mode === 'percent' ? '百分比' : '功率'}监控项</p>
              ) : (
                <ItemChoices
                  name="pf-valueItemId"
                  items={valueItems}
                  value={draft.valueItemId}
                  onChange={(valueItemId) => patch({ valueItemId })}
                  invalid={Boolean(errors.valueItemId)}
                  describedBy={describe('valueItemId')}
                  extra={canKeepValue && device ? { id: KEEP_CURRENT, title: '保留当前读数', meta: device.metricValue === undefined ? '无数据' : `${device.metricValue}${device.metricUnit ?? ''}` } : undefined}
                />
              )}
              {errors.valueItemId && <p id="pf-valueItemId-error" className="field-error">{errors.valueItemId}</p>}
            </div>
          )}

          {draft.mode === 'power' && (
            <Field id="pf-powerMax" label="满量程（W）" error={errors.powerMax} hint="圆图比例 = 当前功率 ÷ 满量程" required>
              <input id="pf-powerMax" className="input input-short" inputMode="decimal" value={draft.powerMax} aria-invalid={Boolean(errors.powerMax) || undefined} aria-describedby={describe('powerMax', true)} onChange={(e) => patch({ powerMax: e.target.value })} />
            </Field>
          )}

          <div className="switch-row">
            <div>
              <span className="field-label" id="pf-allow-label">允许离线</span>
              <p className="field-hint" id="pf-allow-hint">开启后离线显示灰色，不计为异常</p>
            </div>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={draft.allowOffline}
              aria-labelledby="pf-allow-label"
              aria-describedby="pf-allow-hint"
              onClick={() => patch({ allowOffline: !draft.allowOffline })}
            >
              <span />
            </button>
          </div>
        </section>
      </div>

      <aside className="form-preview" aria-label="大屏预览">
        <span className="preview-title">大屏预览</span>
        <div className="preview-stage">
          <DeviceUnit device={preview} now={now} />
        </div>
        <p className="preview-note">按当前选择的测试数据实时渲染，保存后同步到大屏。</p>
      </aside>

      <footer className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>取消</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
      </footer>
    </form>
  )
}
