import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '区域设备状态监控中心',
  description: '区域设备实时状态监控',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#08121d',
  userScalable: false,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="bg-background">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
