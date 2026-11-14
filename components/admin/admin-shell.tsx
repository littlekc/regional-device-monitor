'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MonitorPlay, Wifi } from 'lucide-react'
import { useDemoState } from '@/lib/demo-store'
import { RoundIcon } from '@/components/device-gauge'
import { Toaster } from '@/components/admin/toast'

const navItems = [
  { href: '/admin/projects', label: '监控项目' },
  { href: '/admin/regions', label: '区域管理' },
  { href: '/admin/settings', label: '系统设置' },
]

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const demo = useDemoState()

  return (
    <div className="admin-shell" data-palette={demo?.palette ?? 'harbor'}>
      <header className="admin-topbar">
        <div className="admin-brand">
          <RoundIcon icon={Wifi} tone="tone-brand" size="sm" />
          <span>监控中心</span>
          <span className="admin-brand-sub">管理后台</span>
        </div>
        <nav className="admin-nav" aria-label="后台导航">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link key={item.href} href={item.href} className={`admin-nav-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                {item.label}
              </Link>
            )
          })}
        </nav>
        <Link href="/" className="btn btn-outline admin-open-screen">
          <MonitorPlay size={15} aria-hidden="true" />
          打开大屏
        </Link>
      </header>
      <main className="admin-main">
        {demo ? children : <div className="admin-loading" role="status">正在加载演示数据…</div>}
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
