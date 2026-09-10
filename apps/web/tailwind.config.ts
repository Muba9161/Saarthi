import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Saarthi design system.
 *
 * Colours are HSL channel triplets declared in globals.css, so one token works
 * in both themes and composes with Tailwind opacity modifiers (`bg-primary/10`).
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1600px' },
    },
    extend: {
      colors: {
        border: {
          DEFAULT: 'hsl(var(--border))',
          strong: 'hsl(var(--border-strong))',
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        canvas: 'hsl(var(--canvas))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        elevated: 'hsl(var(--elevated))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          muted: 'hsl(var(--primary-muted))',
          soft: 'hsl(var(--primary-soft))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
          soft: 'hsl(var(--accent-soft))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          soft: 'hsl(var(--destructive-soft))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          soft: 'hsl(var(--success-soft))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          soft: 'hsl(var(--warning-soft))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          soft: 'hsl(var(--info-soft))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        /** The track a merged tab is cut out of — see .tab-merge. */
        'tab-track': 'hsl(var(--tab-track))',
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          muted: 'hsl(var(--sidebar-muted))',
          accent: 'hsl(var(--sidebar-accent))',
          border: 'hsl(var(--sidebar-border))',
          highlight: 'hsl(var(--sidebar-highlight))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
          6: 'hsl(var(--chart-6))',
        },
      },
      borderRadius: {
        // Derived from --radius (1rem). Panels sit at xl/2xl, controls at
        // lg/md, chips and hairline chrome at sm.
        '3xl': 'calc(var(--radius) + 16px)',
        '2xl': 'calc(var(--radius) + 8px)',
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 5px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
      },
      boxShadow: {
        /*
         * A four-step elevation scale — anything more becomes noise.
         *
         * These are achromatic (240 6% 10%) and wider than a conventional
         * shadow set on purpose: with borders removed from panels, the shadow
         * is the only thing describing where a surface ends, and a tight
         * shadow at a 20px radius reads as a smudge rather than an edge.
         * `sm` is overridden too, so small controls match the same light.
         */
        sm: '0 1px 2px 0 hsl(240 6% 10% / 0.05)',
        card: '0 1px 2px -1px hsl(240 6% 10% / 0.04), 0 4px 12px -3px hsl(240 6% 10% / 0.06)',
        lifted: '0 2px 4px -2px hsl(240 6% 10% / 0.05), 0 14px 28px -8px hsl(240 6% 10% / 0.12)',
        overlay: '0 8px 20px -8px hsl(240 6% 10% / 0.14), 0 32px 64px -16px hsl(240 6% 10% / 0.22)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.14), 0 8px 28px -8px hsl(var(--primary) / 0.32)',
        'glow-danger':
          '0 0 0 1px hsl(var(--destructive) / 0.18), 0 8px 28px -8px hsl(var(--destructive) / 0.36)',
      },
      backgroundImage: {
        'grid-subtle':
          'linear-gradient(to right, hsl(var(--border)/0.5) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)/0.5) 1px, transparent 1px)',
        'brand-gradient':
          'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary)/0.88) 55%, hsl(var(--accent)/0.7) 145%)',
        /*
         * The logo's own sweep, as a fill.
         *
         * Sampled from `vorldx-mark.png` — the navy of the V and the road, and
         * the saffron of the X. Held as fixed hex rather than tokens because
         * the artwork is fixed: `--primary` is a desaturated indigo that was
         * chosen to sit quietly behind operational data, and the logo is not
         * that colour.
         *
         * Separate from `brand-gradient` on purpose. That one fills every
         * `variant="gradient"` button in the product, where a full navy-to-
         * saffron ramp across 40px reads as a novelty; this is for the large
         * brand surfaces where the ramp has room to be seen — the progress
         * rail, the selected pills, and the marketing wordmarks.
         */
        'logo-gradient': 'linear-gradient(100deg, #062a66 0%, #2360be 32%, #e8590f 85%, #ff8c2e 100%)',
        // The soft pool of light a vehicle image is staged on.
        'stage-glow':
          'radial-gradient(120% 80% at 50% 118%, hsl(var(--primary)/0.10) 0%, transparent 72%)',
      },
      backgroundSize: {
        grid: '32px 32px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '0.7' },
          '70%': { transform: 'scale(1.9)', opacity: '0' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'slide-up-fade': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'draw-line': {
          from: { strokeDashoffset: '1000' },
          to: { strokeDashoffset: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shimmer: 'shimmer 1.8s infinite',
        'slide-up-fade': 'slide-up-fade 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'draw-line': 'draw-line 1.4s ease-out forwards',
      },
      transitionTimingFunction: {
        // Overshoot-free easing that still feels responsive.
        smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [animate],
};

export default config;
