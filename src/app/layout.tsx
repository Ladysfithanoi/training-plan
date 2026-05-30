import type { Metadata } from 'next'
import { Source_Serif_4, Be_Vietnam_Pro, JetBrains_Mono } from 'next/font/google'
import './globals.css'

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
      <body>{children}</body>
    </html>
  )
}
