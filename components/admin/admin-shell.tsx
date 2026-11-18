'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, MonitorPlay, Wifi } from 'lucide-react'
import type { MonitorConfig } from '@/lib/contracts'
import { adminApi, loadAdminConfig, MonitorRequestError, requestErrorMessage } from '@/lib/monitor-client'
import { RoundIcon } from '@/components/device-gauge'
import { AdminConfigProvider } from '@/components/admin/admin-config'
import { Toaster, notify } from '@/components/admin/toast'

const navItems = [
  { href: '/admin/projects', label: '监控项目' },
  { href: '/admin/regions', label: '区域管理' },
  { href: '/admin/settings', label: '系统设置' },
]

function LoginForm({ onLogin }: { onLogin: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function login(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await adminApi.login(password)
      setPassword('')
      await onLogin()
    } catch (cause) {
      setError(requestErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="settings-card login-card" onSubmit={login}>
      <h1>管理员登录</h1>
      <div className="field">
        <label htmlFor="admin-password">管理员密码</label>
        <input id="admin-password" className="input" type="password" autoComplete="current-password" required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
    </form>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [config, setConfig] = useState<MonitorConfig | null>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    const request = new AbortController()
    void loadAdminConfig(request.signal).then((result) => {
      if (!request.signal.aborted) setConfig(result)
    }).catch((cause) => {
      if (!request.signal.aborted) setError(requestErrorMessage(cause))
    })
    return () => request.abort()
  }, [attempt])

  function applyConfig(next: MonitorConfig) {
    setConfig((current) => current && next.version >= current.version ? next : current)
  }

  async function reloadConfig() {
    const next = await adminApi.config()
    applyConfig(next)
    return next
  }

  function signOut() {
    setConfig(null)
  }

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await adminApi.logout()
      signOut()
    } catch (cause) {
      if (cause instanceof MonitorRequestError && cause.code === 'unauthorized') signOut()
      else notify(requestErrorMessage(cause), 'error')
    } finally {
      setLoggingOut(false)
    }
  }

  async function afterLogin() {
    try {
      setConfig(await adminApi.config())
    } catch (cause) {
      setConfig(undefined)
      setError(requestErrorMessage(cause))
    }
  }

  return (
    <div className="admin-shell" data-palette={config?.settings.palette ?? 'harbor'}>
      <header className="admin-topbar">
        <div className="admin-brand">
          <RoundIcon icon={Wifi} tone="tone-brand" size="sm" />
          <span>监控中心</span>
          <span className="admin-brand-sub">管理后台</span>
        </div>
        {config && (
          <nav className="admin-nav" aria-label="后台导航">
            {navItems.map((item) => {
              const active = pathname === item.href
              return <Link key={item.href} href={item.href} className={`admin-nav-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>{item.label}</Link>
            })}
          </nav>
        )}
        <div className="admin-topbar-actions">
          {config && <button type="button" className="btn" onClick={logout} disabled={loggingOut} title="退出登录"><LogOut size={15} aria-hidden="true" />退出</button>}
          <Link href="/" className="btn btn-outline admin-open-screen"><MonitorPlay size={15} aria-hidden="true" />打开大屏</Link>
        </div>
      </header>
      <main className="admin-main">
        {config ? (
          <AdminConfigProvider config={config} applyConfig={applyConfig} reloadConfig={reloadConfig} signOut={signOut}>{children}</AdminConfigProvider>
        ) : config === null ? (
          <LoginForm onLogin={afterLogin} />
        ) : error ? (
          <div className="admin-loading" role="alert">
            <p>{error}</p>
            <button type="button" className="btn btn-outline" onClick={() => { setError(''); setAttempt(attempt + 1) }}>重试</button>
          </div>
        ) : <div className="admin-loading" role="status">正在验证管理员会话…</div>}
      </main>
      <Toaster />
    </div>
  )
}

export function StatusTag({ status }: { status: 'normal' | 'error' | 'offline' | 'unknown' }) {
  const meta = {
    normal: { label: '正常', tone: 'tone-normal' },
    error: { label: '异常', tone: 'tone-error' },
    offline: { label: '允许离线', tone: 'tone-offline' },
    unknown: { label: '未知', tone: 'tone-unknown' },
  }[status]
  return <span className={`status-tag ${meta.tone}`}><i aria-hidden="true" />{meta.label}</span>
}

export function PageHeader({ title, count, actions }: { title: string; count?: number; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-title">
        <h1>{title}</h1>
        {count !== undefined && <span className="count-pill">{count}</span>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}
