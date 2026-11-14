import type { Metadata } from 'next'
import { AdminShell } from '@/components/admin/admin-shell'
import './admin.css'

export const metadata: Metadata = {
  title: '管理后台 · 区域设备状态监控中心',
  description: '监控项目、区域与系统设置管理',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
