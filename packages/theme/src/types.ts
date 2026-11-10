/** Theme pack types · mirror the SarkiAI admin `apps/organization` charter. */

export interface LocalizedString {
  fr: string
  en: string
}

export interface ThemeTokens {
  /** Brand + charte slots shared by both modes. */
  common?: Record<string, string>
  light: Record<string, string>
  dark: Record<string, string>
}

export interface ThemePack {
  id: string
  name: LocalizedString
  description?: LocalizedString
  isDefault?: boolean
  preview: { primary: string; secondary: string; accent: string; surface: string }
  tokens: ThemeTokens
}
