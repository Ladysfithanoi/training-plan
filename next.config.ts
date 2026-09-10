import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Images served from Supabase Storage
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/**',
      },
    ],
  },

  // Service worker của PWA phải KHÔNG được cache: trình duyệt giữ bản cũ thì
  // bản sửa lỗi sau này không bao giờ tới được máy đã cài app.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type',  value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ]
  },

  // Permanently retire the old /workouts route → new coach training view
  async redirects() {
    return [
      {
        source:      '/workouts',
        destination: '/admin/my-training',
        permanent:   true,
      },
      {
        source:      '/workouts/:path*',
        destination: '/admin/my-training',
        permanent:   true,
      },
    ]
  },
}

export default nextConfig
