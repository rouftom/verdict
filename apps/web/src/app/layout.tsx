import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/service-worker-register'
import { I18nProvider } from '@/components/i18n-provider'
import { ThemeProvider } from '@/components/theme-provider'
import {
  DEFAULT_CORNER_STYLE,
  DEFAULT_THEME_PACK_ID,
  MODE_STORAGE_KEY,
  RADIUS_STORAGE_KEY,
  THEME_PACKS,
  THEME_PACK_STORAGE_KEY,
  buildChromeBootstrapScript,
  buildThemePackCss,
} from '@verdict/theme'

const themeBootstrap = buildChromeBootstrapScript({
  themeStorageKey: THEME_PACK_STORAGE_KEY,
  modeStorageKey: MODE_STORAGE_KEY,
  defaultThemeId: DEFAULT_THEME_PACK_ID,
  themes: THEME_PACKS,
  radiusStorageKey: RADIUS_STORAGE_KEY,
  defaultRadius: DEFAULT_CORNER_STYLE,
})

const themeCss = buildThemePackCss(THEME_PACKS)

export const metadata: Metadata = {
  title: 'Verdict · multi-agent project evaluation',
  description:
    'Evidence-grounded scoring of hackathon projects: six evaluators, one cross-review round, two verifiers, per-track ranking.',
  applicationName: 'Verdict',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/logo.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/favicon.ico'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'verdict',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F9FE' },
    { media: '(prefers-color-scheme: dark)', color: '#050B18' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <style id="verdict-theme-packs" dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body>
        <ThemeProvider>
          <I18nProvider>
            {children}
            <ServiceWorkerRegister />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
