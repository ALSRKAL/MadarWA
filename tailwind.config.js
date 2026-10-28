/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/content/**/*.{ts,tsx}", "./src/popup/**/*.{ts,tsx}", "./popup.html"],
  darkMode: ["class", '[data-madarwa-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },
      },
      fontFamily: {
        sans: ["Cairo", "Tajawal", "IBM Plex Sans Arabic", "Segoe UI", "Tahoma", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 24px 70px -20px rgba(2, 44, 34, 0.55)",
        glow: "0 0 0 1px rgba(16, 185, 129, 0.35), 0 10px 40px -12px rgba(16, 185, 129, 0.55)",
      },
      keyframes: {
        "madar-fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "madar-slide-in": {
          from: { opacity: "0", transform: "translateY(18px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "madar-pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(16, 185, 129, 0.55)" },
          "70%": { boxShadow: "0 0 0 14px rgba(16, 185, 129, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(16, 185, 129, 0)" },
        },
        "madar-toast-in": {
          from: { opacity: "0", transform: "translateY(-10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "madar-fade-in": "madar-fade-in 180ms ease-out both",
        "madar-slide-in": "madar-slide-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "madar-pulse-ring": "madar-pulse-ring 2.4s infinite",
        "madar-toast-in": "madar-toast-in 220ms ease-out both",
      },
    },
  },
  plugins: [],
};
