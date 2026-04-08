import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'

const SOI_THEME_COLORS = {
  primary: '#d52b1e',
  secondary: '#1f2f2b',
  success: '#3a7a4e',
  warning: '#a56a1f',
  error: '#b53a33',
  info: '#2f5f7a',
  background: '#ffffff',
  surface: '#ffffff',
  'surface-bright': '#ffffff',
  'surface-light': '#ffffff',
  'surface-variant': '#f6f8f6',
  'on-surface': '#1f2a28',
  'on-background': '#1f2a28',
  'on-primary': '#ffffff',
  border: '#d7dfda',
  muted: '#60716d'
}

export const themeTokens = Object.freeze({
  primary: SOI_THEME_COLORS.primary
})

export const vuetify = createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: {
      mdi
    }
  },
  defaults: {
    VAlert: {
      variant: 'tonal',
      density: 'comfortable'
    },
    VTextField: {
      variant: 'outlined',
      color: 'primary'
    },
    VTextarea: {
      variant: 'outlined',
      color: 'primary'
    },
    VSelect: {
      variant: 'outlined',
      color: 'primary'
    },
    VAutocomplete: {
      variant: 'outlined',
      color: 'primary'
    },
    VSheet: {
      color: 'surface'
    },
    VCard: {
      color: 'surface'
    },
    VTable: {
      density: 'comfortable'
    }
  },
  theme: {
    defaultTheme: 'soiLight',
    themes: {
      soiLight: {
        dark: false,
        colors: SOI_THEME_COLORS
      }
    }
  }
})
