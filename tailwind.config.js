/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      opacity: { 12: '0.12', 8: '0.08' },
      fontFamily: {
        sans: ['Inter', 'Cairo', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      colors: {
        surface: {
          50: 'rgb(var(--surface-50) / <alpha-value>)',
          100: 'rgb(var(--surface-100) / <alpha-value>)',
          200: 'rgb(var(--surface-200) / <alpha-value>)',
          300: 'rgb(var(--surface-300) / <alpha-value>)',
          400: 'rgb(var(--surface-400) / <alpha-value>)',
          500: 'rgb(var(--surface-500) / <alpha-value>)',
          600: 'rgb(var(--surface-600) / <alpha-value>)',
          700: 'rgb(var(--surface-700) / <alpha-value>)',
          800: 'rgb(var(--surface-800) / <alpha-value>)',
          900: 'rgb(var(--surface-900) / <alpha-value>)',
          950: 'rgb(var(--surface-950) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
        },
        /* Semantic status colors — the single vocabulary for feedback/surfaces so
           components stop hard-coding raw palette shades (same hues, one name). */
        danger: 'rgb(244 63 94 / <alpha-value>)',
        success: 'rgb(16 185 129 / <alpha-value>)',
        warning: 'rgb(245 158 11 / <alpha-value>)',
        info: 'rgb(14 165 233 / <alpha-value>)',
      },
      boxShadow: {
        glow: '0 4px 14px -4px rgb(var(--accent) / 0.45)',
        card: 'var(--shadow-2)',
        e1: 'var(--shadow-1)',
        e2: 'var(--shadow-2)',
        e3: 'var(--shadow-3)',
        /* Keyboard focus ring — pairs with the global :focus-visible outline. */
        ring: '0 0 0 3px rgb(var(--accent) / 0.18)',
        focus: '0 0 0 2px rgb(var(--surface-100)), 0 0 0 4px rgb(var(--accent))',
      },
      /* Motion tokens mirror lib/motion.ts and the ease / duration CSS vars. */
      transitionTimingFunction: {
        out: 'cubic-bezier(.22, 1, .36, 1)',
        inout: 'cubic-bezier(.65, 0, .35, 1)',
        spring: 'cubic-bezier(.34, 1.56, .64, 1)',
      },
      transitionDuration: { 1: '110ms', 2: '170ms', 3: '260ms', 4: '380ms' },
      animation: {
        'fade-in': 'fadeIn 0.25s cubic-bezier(.22,1,.36,1) both',
        'slide-up': 'slideUp 0.7s cubic-bezier(.22,1,.36,1) both',
        'float': 'float 6s ease-in-out infinite',
        'pop': 'pop 0.32s cubic-bezier(.34,1.56,.64,1) both',
        'spin-slow': 'spin 8s linear infinite',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
        /* Rotating gradient border for the update card (see styles/index.css). */
        'spin-border': 'updateBorderSpin 5s linear infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        pop: { from: { opacity: 0, transform: 'scale(.9)' }, to: { opacity: 1, transform: 'scale(1)' } },
        slideUp: { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        pulseGlow: { '0%,100%': { boxShadow: '0 0 0 0 rgb(var(--accent) / 0.4)' }, '50%': { boxShadow: '0 0 40px 6px rgb(var(--accent) / 0.25)' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        updateBorderSpin: { from: { transform: 'translate(-50%, -50%) rotate(0deg)' }, to: { transform: 'translate(-50%, -50%) rotate(360deg)' } },
      },
    },
  },
  plugins: [],
}
