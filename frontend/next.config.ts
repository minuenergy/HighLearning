import path from 'node:path'
import type { NextConfig } from 'next'

const backendApiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const frontendRoot = path.resolve(__dirname)
const frontendNodeModules = path.resolve(__dirname, 'node_modules')

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    proxyClientMaxBodySize: 128 * 1024 * 1024,
  },
  turbopack: {
    root: frontendRoot,
  },
  webpack(config) {
    config.resolve ??= {}
    config.resolve.modules = [
      frontendNodeModules,
      ...(config.resolve.modules ?? []),
    ]
    return config
  },
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
