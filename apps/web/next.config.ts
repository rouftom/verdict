import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources (main -> src/index.ts).
  transpilePackages: ['@verdict/ui', '@verdict/theme', '@verdict/shared'],
  experimental: {
    optimizePackageImports: ['lucide-react', '@verdict/ui'],
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          // The worker itself must never be cached, or a deploy goes unnoticed.
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/offline.html',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ]
  },
}

export default nextConfig
