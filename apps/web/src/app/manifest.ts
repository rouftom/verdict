import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Verdict',
    short_name: 'Verdict',
    description:
      'Evidence-grounded scoring of hackathon projects: six evaluators, one cross-review round, two verifiers, per-track ranking.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F7F9FE',
    theme_color: '#0866FF',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
