'use client'

import { useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Loader2, PlugZap } from 'lucide-react'
import { demoApi, useDemoState, type DemoSettings } from '@/lib/demo-store'
import { PageHeader } from '@/components/admin/admin-shell'
import { notify } from '@/components/admin/toast'

type SettingsErrors = Partial<Record<'zabbixUrl' | 'apiToken' | 'refreshSeconds', string>>

function validate(draft: { zabbixUrl: string; apiToken: string; refreshSeconds: string }): SettingsErrors {
  const errors: SettingsErrors = {}
  try {
    const url = new URL(draft.zabbixUrl.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') errors.zabbixUrl = '请输入 http 或 https 地址'
  } catch {
    errors.zabbixUrl = '请输入有效的 Zabbix API 地址'
  }
  if (!draft.apiToken.trim()) errors.apiToken = '请填写 API Token'
  const seconds = Number(draft.refreshSeconds)
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) errors.refreshSeconds = '请输入 5–3600 之间的整数'
  return errors
}

function SettingsForm({ settings }: { settings: DemoSettings }) {
  const [draft, setDraft] = useState({ zabbixUrl: settings.zabbixUrl, apiToken: settings.apiToken, refreshSeconds: String(settings.refreshSeconds) })
  const [errors, setErrors] = useState<SettingsErrors>({})
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  function patch(next: Partial<typeof draft>) {
    const merged = { ...draft, ...next }
    setDraft(merged)
    setTestResult(null)
    if (Object.keys(errors).length) setErrors(validate(merged))
  }

  async function testConnection() {
    const nextErrors = validate(draft)
    setErrors(nextErrors)
    if (nextErrors.zabbixUrl || nextErrors.apiToken) return
    setTesting(true)
    setTestResult(null)
    const result = await demoApi.testConnection()
    setTesting(false)
    setTestResult(result.message)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors = validate(draft)
    setErrors(nextErrors)
    const first = (['zabbixUrl', 'apiToken', 'refreshSeconds'] as const).find((key) => nextErrors[key])
    if (first) return document.getElementById(`st-${first}`)?.focus()
    await demoApi.saveSettings({ zabbixUrl: draft.zabbixUrl.trim(), apiToken: draft.apiToken.trim(), refreshSeconds: Number(draft.refreshSeconds) })
    notify('设置已保存')
  }

  return (
    <form className="settings-card" onSubmit={handleSubmit} noValidate>
      <section className="form-section" aria-labelledby="st-conn">
        <h3 id="st-conn">Zabbix 连接 <span className="section-tag">演示 · 不会访问真实服务</span></h3>
        <div className="field">
          <label htmlFor="st-zabbixUrl">API 地址<span className="required" aria-hidden="true">*</span></label>
          <input id="st-zabbixUrl" className="input mono" value={draft.zabbixUrl} aria-invalid={Boolean(errors.zabbixUrl) || undefined} aria-describedby={errors.zabbixUrl ? 'st-zabbixUrl-error' : undefined} onChange={(e) => patch({ zabbixUrl: e.target.value })} />
          {errors.zabbixUrl && <p id="st-zabbixUrl-error" className="field-error">{errors.zabbixUrl}</p>}
        </div>
        <div className="field">
          <label htmlFor="st-apiToken">API Token<span className="required" aria-hidden="true">*</span></label>
          <div className={`input-with-action ${errors.apiToken ? 'is-invalid' : ''}`}>
            <input id="st-apiToken" className="mono" type={showToken ? 'text' : 'password'} autoComplete="off" value={draft.apiToken} aria-invalid={Boolean(errors.apiToken) || undefined} aria-describedby={errors.apiToken ? 'st-apiToken-error' : 'st-apiToken-hint'} onChange={(e) => patch({ apiToken: e.target.value })} />
            <button type="button" className="icon-button" onClick={() => setShowToken((value) => !value)} aria-label={showToken ? '隐藏 Token' : '显示 Token'} aria-pressed={showToken}>
              {showToken ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
            </button>
          </div>
          {errors.apiToken ? <p id="st-apiToken-error" className="field-error">{errors.apiToken}</p> : <p id="st-apiToken-hint" className="field-hint">演示环境仅保存在本机浏览器；正式接入后应由后端保管</p>}
        </div>
        <div className="test-row">
          <button type="button" className="btn btn-outline" onClick={testConnection} disabled={testing}>
            {testing ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <PlugZap size={15} aria-hidden="true" />}
            {testing ? '测试中…' : '测试连接'}
          </button>
          <span className="test-result" role="status">
            {testResult && <><CheckCircle2 size={15} aria-hidden="true" />{testResult}</>}
          </span>
        </div>
      </section>

      <section className="form-section" aria-labelledby="st-refresh">
        <h3 id="st-refresh">大屏刷新</h3>
        <div className="field">
          <label htmlFor="st-refreshSeconds">刷新间隔（秒）<span className="required" aria-hidden="true">*</span></label>
          <input id="st-refreshSeconds" className="input input-short" inputMode="numeric" value={draft.refreshSeconds} aria-invalid={Boolean(errors.refreshSeconds) || undefined} aria-describedby={errors.refreshSeconds ? 'st-refreshSeconds-error' : 'st-refreshSeconds-hint'} onChange={(e) => patch({ refreshSeconds: e.target.value })} />
          {errors.refreshSeconds ? <p id="st-refreshSeconds-error" className="field-error">{errors.refreshSeconds}</p> : <p id="st-refreshSeconds-hint" className="field-hint">大屏按此间隔重新读取数据；离线时长每秒计时，不受影响</p>}
        </div>
      </section>

      <div className="settings-actions">
        <button type="submit" className="btn btn-primary">保存设置</button>
      </div>
    </form>
  )
}

export function SettingsPage() {
  const demo = useDemoState()
  return (
    <div className="admin-page admin-page-narrow">
      <PageHeader title="系统设置" />
      {demo && <SettingsForm settings={demo.settings} />}
    </div>
  )
}
