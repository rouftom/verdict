import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources (main -> src/index.ts).
  transpilePackages: ['@verdict/ui', '@verdict/theme', '@verdict/shared'],
  experimental: {
    optimizePackageImports: ['lucide-react', '@verdict/ui'],
  },
}

export default nextConfig
