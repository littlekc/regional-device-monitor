'use client'

import { useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, PlugZap } from 'lucide-react'
import type { ConnectionInput, ConnectionResultCode, ConnectionTest, MonitorSettings, PaletteId } from '@/lib/contracts'
import { adminApi, requestErrorMessage } from '@/lib/monitor-client'
import { EditFeedback, useAdminConfig, useConfigEdit } from '@/components/admin/admin-config'
import { PageHeader } from '@/components/admin/admin-shell'
import { palettes } from '@/components/device-gauge'
import { notify } from '@/components/admin/toast'

const resultLabels: Record<ConnectionResultCode, string> = {
  success: '测试通过',
  connection: '连接失败',
  auth: '认证失败',
  permission: '权限不足',
  no_items: '无可用监控数据',
}

function settingsFields(settings: MonitorSettings) {
  return {
    columns: String(settings.columns),
    gaugeSize: String(settings.gaugeSize),
    refreshSeconds: String(settings.refreshSeconds),
    palette: settings.palette,
  }
}

function SettingsForm() {
  const { config, applyConfig, reloadConfig } = useAdminConfig()
  const [settings, setSettings] = useState(() => settingsFields(config.settings))
  const [dirty, setDirty] = useState(false)
  const [url, setUrl] = useState(config.connection.url)
  const [token, setToken] = useState('')
  const [clearToken, setClearToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTest>()
  const [testError, setTestError] = useState('')
  const [tokenHint, setTokenHint] = useState('')
  const edit = useConfigEdit(config.version, async () => {
    const next = await reloadConfig()
    if (!dirty) {
      setSettings(settingsFields(next.settings))
      setUrl(next.connection.url)
    }
    if (!next.connection.tokenConfigured) setClearToken(false)
    return next
  })
  const busy = edit.busy || testing

  function resetTest() {
    setTestResult(undefined)
    setTestError('')
  }

  function connectionInput(): ConnectionInput {
    return {
      url: url.trim(),
      ...(clearToken ? { clearToken: true } : token.trim() ? { token: token.trim() } : {}),
    }
  }

  async function runTest() {
    if (busy) return
    resetTest()
    setTesting(true)
    try {
      setTestResult(await adminApi.testConnection(connectionInput()))
    } catch (cause) {
      setTestError(requestErrorMessage(cause))
    } finally {
      setTesting(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || edit.needsReload) return
    resetTest()
    setTokenHint('')
    const connection = connectionInput()
    const hadToken = Boolean(connection.token)
    setToken('')
    const next = await edit.save((baseVersion) => adminApi.saveSettings(baseVersion, {
      columns: Number(settings.columns), gaugeSize: Number(settings.gaugeSize),
      refreshSeconds: Number(settings.refreshSeconds), palette: settings.palette,
    }, connection))
    if (next) {
      applyConfig(next)
      setUrl(next.connection.url)
      setClearToken(false)
      setDirty(false)
      notify('设置已保存')
    } else if (hadToken) {
      setTokenHint('已清空输入的 Token。如需替换存储的 Token，请重新输入。')
    }
  }

  return (
    <form className="settings-card" onSubmit={save} onChange={() => setDirty(true)}>
      {config.routers?.map(router => <p key={router.hostId} className="field-hint">爱快 API：{router.url} · {router.bindings.length} 个实时项目</p>)}
      {edit.stale && <EditFeedback edit={edit} draft={dirty} />}
      <fieldset className="form-section" disabled={busy}>
        <legend>Zabbix 连接</legend>
        <div className="field">
          <label htmlFor="st-zabbixUrl">Zabbix API 地址</label>
          <input id="st-zabbixUrl" className="input" type="url" maxLength={2048} placeholder="https://zabbix.example/api_jsonrpc.php" value={url} onChange={(event) => { setUrl(event.target.value); resetTest() }} />
        </div>
        <div className="field">
          <label htmlFor="st-apiToken">API Token</label>
          <input id="st-apiToken" className="input mono" type="password" autoComplete="new-password" disabled={clearToken}
            value={token} maxLength={512} aria-describedby="st-token-hint" onChange={(event) => { setToken(event.target.value); setTokenHint(''); resetTest() }} />
          <p className="field-hint" id="st-token-hint">{config.connection.tokenConfigured ? '已保存 Token。留空时使用已保存的 Token。' : '尚未保存 Token。'}</p>
          {tokenHint && <p className="field-hint" role="status">{tokenHint}</p>}
          {config.connection.tokenConfigured && (
            <label className="check-label">
              <input type="checkbox" checked={clearToken} onChange={(event) => { setClearToken(event.target.checked); setToken(''); resetTest() }} />清除已保存的 Token
            </label>
          )}
        </div>
        <div className="test-row">
          <button type="button" className="btn btn-outline" onClick={runTest}>
            {testing ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <PlugZap size={15} aria-hidden="true" />}
            {testing ? '测试中…' : '测试连接'}
          </button>
          {testResult && (
            <p className={`test-result ${testResult.status !== 'success' ? 'test-failed' : ''}`} role="status">
              {testResult.status === 'success' ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
              {resultLabels[testResult.status]} · {testResult.message}{testResult.version && ` · Zabbix ${testResult.version}`}
            </p>
          )}
          {testError && <p className="field-error" role="alert">{testError}</p>}
        </div>
      </fieldset>

      <fieldset className="form-section" disabled={busy}>
        <legend>大屏布局</legend>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="st-columns">最多列数</label>
            <input id="st-columns" className="input" type="number" required min={1} max={16} step="1" value={settings.columns} onChange={(event) => setSettings({ ...settings, columns: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-gaugeSize">仪表大小（%）</label>
            <input id="st-gaugeSize" className="input" type="number" required min={50} max={160} step="1" value={settings.gaugeSize} onChange={(event) => setSettings({ ...settings, gaugeSize: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-refreshSeconds">刷新间隔（秒）</label>
            <input id="st-refreshSeconds" className="input" type="number" required min={1} max={3600} step="1" value={settings.refreshSeconds} onChange={(event) => setSettings({ ...settings, refreshSeconds: event.target.value })} />
            <p className="field-hint">爱快 API 实时数据每 5 秒共享读取；其他设备仍按 Zabbix 实际采样周期更新。</p>
          </div>
        </div>
        <fieldset className="palette-picker">
          <legend>配色方案</legend>
          {palettes.map((item) => (
            <label key={item.id} className={`palette-option ${settings.palette === item.id ? 'is-selected' : ''}`}>
              <input type="radio" name="st-palette" value={item.id} checked={settings.palette === item.id}
                onChange={(event) => setSettings({ ...settings, palette: event.target.value as PaletteId })} />
              <span className="palette-swatches" aria-hidden="true">
                {item.swatches.map((color) => <i key={color} style={{ background: color }} />)}
              </span>
              <span className="palette-text"><b>{item.name}</b><small>{item.note}</small></span>
            </label>
          ))}
        </fieldset>
      </fieldset>
      {!edit.stale && <EditFeedback edit={edit} draft={dirty} />}
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || edit.needsReload}>{edit.busy ? '处理中…' : '保存设置'}</button>
      </div>
    </form>
  )
}

function PasswordForm() {
  const { signOut } = useAdminConfig()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function change(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (newPassword !== confirmation) return setError('两次输入的新密码不一致。')
    setError('')
    setBusy(true)
    try {
      await adminApi.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      signOut()
      notify('密码已修改，请重新登录')
    } catch (cause) {
      setError(requestErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="settings-card" onSubmit={change}>
      <fieldset className="form-section" disabled={busy}>
        <legend>修改管理员密码</legend>
        <div className="field">
          <label htmlFor="st-password-current">当前密码</label>
          <input id="st-password-current" className="input" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="st-password-new">新密码（12–256 个字符）</label>
          <input id="st-password-new" className="input" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="st-password-confirm">确认新密码</label>
          <input id="st-password-confirm" className="input" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </div>
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '提交中…' : '修改密码'}</button>
      </div>
    </form>
  )
}

export function SettingsPage() {
  return (
    <div className="admin-page admin-page-narrow">
      <PageHeader title="系统设置" />
      <SettingsForm />
      <PasswordForm />
    </div>
  )
}
