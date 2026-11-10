import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import {
  BORDER_STORAGE_KEY,
  DEFAULT_BORDER_STYLE,
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
  borderStorageKey: BORDER_STORAGE_KEY,
  defaultBorder: DEFAULT_BORDER_STYLE,
})

const themeCss = buildThemePackCss(THEME_PACKS)

export const metadata: Metadata = {
  title: 'Verdict — multi-agent project evaluation',
  description:
    'Evidence-grounded scoring of hackathon projects: six evaluators, one cross-review round, two verifiers, per-track ranking.',
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
