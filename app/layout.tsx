import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Noto_Sans_SC } from 'next/font/google'
import './globals.css'

const notoSans = Noto_Sans_SC({ weight: ['400', '500', '600', '700'], variable: '--font-noto', preload: false, display: 'swap' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' })

export const metadata: Metadata = {
  title: '区域设备状态监控中心',
  description: '区域设备状态监控大屏演示',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#08121d',
  userScalable: false,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${notoSans.variable} ${jetbrainsMono.variable} bg-background`}>
      <body className="font-sans antialiased">{children}{process.env.NODE_ENV === 'production' && <Analytics />}</body>
    </html>
  )
}
