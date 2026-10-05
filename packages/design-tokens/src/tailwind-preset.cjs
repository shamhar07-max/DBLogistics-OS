/** Tailwind preset: every colour/font resolves to a CSS variable, so data-env / data-theme re-skin the whole UI. */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: 'var(--primary)', ink: 'var(--dbl-ink)', 900: 'var(--dbl-forest-900)', 800: 'var(--dbl-forest-800)', 700: 'var(--dbl-forest-700)', 600: 'var(--dbl-forest-600)', 500: 'var(--dbl-forest-500)', 100: 'var(--dbl-forest-100)', 50: 'var(--dbl-forest-50)' },
        signal: { DEFAULT: 'var(--dbl-signal)', action: 'var(--dbl-signal-action)', deep: 'var(--dbl-signal-deep)', 100: 'var(--dbl-signal-100)' },
        accent: { DEFAULT: 'var(--accent)', fg: 'var(--on-accent)' },
        mode: { ocean: 'var(--mode-ocean)', air: 'var(--mode-air)', road: 'var(--mode-road)', warehouse: 'var(--mode-warehouse)', customs: 'var(--mode-customs)' },
        status: { ok: 'var(--status-cleared)', hold: 'var(--status-hold)', stop: 'var(--status-stop)', info: 'var(--status-info)', 'ok-100': 'var(--status-cleared-100)', 'hold-100': 'var(--status-hold-100)', 'stop-100': 'var(--status-stop-100)', 'info-100': 'var(--status-info-100)' },
        paper: { DEFAULT: 'var(--paper)', 2: 'var(--paper-2)' }, surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
        line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' }, steel: 'var(--steel)', ink: 'var(--text)',
      },
      fontFamily: { display: ['var(--font-display)'], sans: ['var(--font-ui)'], label: ['var(--font-label)'], mono: ['var(--font-data)'] },
      borderRadius: { xs: 'var(--r-xs)', sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)' },
      boxShadow: { card: 'var(--shadow-1)', raised: 'var(--shadow-2)', float: 'var(--shadow-3)', signal: 'var(--shadow-signal)' },
      transitionTimingFunction: { out: 'var(--ease-out)' },
    },
  },
};
