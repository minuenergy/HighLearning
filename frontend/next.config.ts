import type { NextConfig } from 'next'

const backendApiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const nextConfig: NextConfig = {
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendApiUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
