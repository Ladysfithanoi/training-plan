import type { Metadata, Viewport } from 'next'
import { Source_Serif_4, Be_Vietnam_Pro, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { InstallPrompt } from '@/components/pwa/InstallPrompt'

// ── Brand font stack ──────────────────────────────────────────────────────────
//  Source Serif 4  → editorial headings, section titles, emphasis italics
//  Be Vietnam Pro  → all UI chrome, body copy, buttons, badges, labels
//  JetBrains Mono  → numeric metrics, rep/set targets, dates, data values

const sourceSerif4 = Source_Serif_4({
  subsets: ['vietnamese'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
})

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['vietnamese'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Kế hoạch Tập luyện',
    template: '%s · Kế hoạch Tập luyện',
  },
  description: 'Hệ thống phân kỳ tập luyện và theo dõi tiến độ chuyên nghiệp.',
  // Cài vào màn hình chính iPhone/iPad: mở toàn màn hình như app riêng.
  // Icon lấy từ src/app/apple-icon.png (quy ước tệp của Next), tên hiện dưới
  // icon lấy từ `title` ở đây. Xem thêm src/app/manifest.ts.
  appleWebApp: {
    capable: true,
    // Giữ trùng name/short_name trong src/app/manifest.ts.
    title: 'Training Plan',
    statusBarStyle: 'default',
  },
}

// Khớp bề rộng máy và tràn ra cả vùng tai thỏ, thanh trạng thái tô theo màu nền
// app — có vậy bản cài về mới trông như app thật, không như trang web bị cắt.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F6F2EA',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="vi"
      className={`${sourceSerif4.variable} ${beVietnamPro.variable} ${jetBrainsMono.variable}`}
    >
      <body>
        {children}
        {/* Banner hỏi cài app — tự ẩn khi đã cài hoặc khi máy không cài được. */}
        <InstallPrompt />
      </body>
    </html>
  )
}
