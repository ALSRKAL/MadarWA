/** @type {import('tailwindcss').Config} */
// Light only. Every colour is a token from src/content/styles/shadow.css.
export default {
  content: ["./src/content/**/*.{ts,tsx}", "./src/popup/**/*.{ts,tsx}", "./popup.html"],
  theme: {
    extend: {
      colors: {
        wa: {
          bg: "rgb(var(--wa-bg) / <alpha-value>)",
          panel: "rgb(var(--wa-panel) / <alpha-value>)",
          surface: "rgb(var(--wa-surface) / <alpha-value>)",
          input: "rgb(var(--wa-input) / <alpha-value>)",
          text: "rgb(var(--wa-text) / <alpha-value>)",
          muted: "rgb(var(--wa-muted) / <alpha-value>)",
          raised: "rgb(var(--wa-raised) / <alpha-value>)",
          active: "rgb(var(--wa-active) / <alpha-value>)",
          brand: "rgb(var(--wa-brand) / <alpha-value>)",
          "brand-strong": "rgb(var(--wa-brand-strong) / <alpha-value>)",
          accent: "rgb(var(--wa-accent) / <alpha-value>)",
          success: "rgb(var(--wa-success) / <alpha-value>)",
          danger: "rgb(var(--wa-danger) / <alpha-value>)",
          warning: "rgb(var(--wa-warning) / <alpha-value>)",
          line: "var(--wa-line)",
          rule: "var(--wa-rule)",
          control: "var(--wa-control)",
          hover: "var(--wa-hover)",
          "on-brand": "var(--wa-on-brand)",
          "on-danger": "var(--wa-on-danger)",
        },
      },
      // Preflight applies this to :host and html; "MadarWA Plex" is the bundled
      // IBM Plex Sans Arabic declared by src/shared/fonts.ts.
      fontFamily: {
        sans: ["MadarWA Plex", "IBM Plex Sans Arabic", "Noto Sans Arabic", "Segoe UI", "Tahoma", "system-ui", "sans-serif"],
      },
      // One type scale for the panel and the popup (values live in shadow.css).
      // Size only: line height stays with the leading-* utilities.
      fontSize: {
        "mw-2xs": "var(--mw-text-2xs)",
        "mw-xs": "var(--mw-text-xs)",
        "mw-sm": "var(--mw-text-sm)",
        "mw-base": "var(--mw-text-base)",
        "mw-lg": "var(--mw-text-lg)",
        "mw-xl": "var(--mw-text-xl)",
      },
    },
  },
  plugins: [],
};
