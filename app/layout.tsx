import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '区域设备状态监控中心',
  description: '区域设备状态监控大屏演示',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#07111f',
  userScalable: false,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className="bg-[#07111f]"><body className="antialiased">{children}{process.env.NODE_ENV === 'production' && <Analytics />}</body></html>
}
