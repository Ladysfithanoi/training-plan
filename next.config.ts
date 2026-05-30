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
