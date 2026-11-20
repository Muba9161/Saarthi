import type * as React from 'react';
import { Bot, MapPin, ShieldCheck, Truck } from 'lucide-react';
import { motion, useReducedMotion } from '@/components/motion';
import { useT } from '@/features/i18n';
import { cn } from '@/lib/utils';

/**
 * The brand panel's parts, shared by the sign-in modal's left panel and the
 * Saarthi Rahi join page's brand column, so the two read as one product.
 */

export const AUTH_HIGHLIGHTS = [
  {
    icon: Truck,
    title: 'One fleet command centre',
    body: 'Trucks, drivers, documents, orders and trips in a single operational view.',
  },
  {
    icon: MapPin,
    title: 'Live tracking that actually moves',
    body: 'Realtime positions, ETAs and route deviation alerts as they happen.',
  },
  {
    icon: ShieldCheck,
    title: 'Driver safety network',
    body: 'One-tap SOS reaches nearby Saarthi trucks in expanding rings.',
  },
  {
    icon: Bot,
    title: 'AI grounded in your data',
    body: 'Answers built only from records your role is allowed to see.',
  },
] as const;

/**
 * What sits behind the brand panel.
 *
 * Three layers, in the order a scene is lit: a faint dot field for texture,
 * two slow-drifting colour washes, and a route line, the one piece of
 * decoration that says what this product is for rather than simply being
 * pretty. On a festival day the washes take the festival's light.
 *
 * Everything here stops moving under `prefers-reduced-motion`; none of it
 * carries information, so freezing it costs nothing.
 */
export function BrandBackdrop() {
  const reduced = useReducedMotion();

  const washes = [
    {
      key: 'primary',
      className: '-left-40 top-0 size-[38rem] bg-primary/35',
      festive: 'var(--festive-glow-a)',
      animate: { x: [0, 50, 0], y: [0, -36, 0] },
      duration: 19,
    },
    {
      key: 'accent',
      className: '-bottom-48 -right-24 size-[30rem] bg-accent/25',
      festive: 'var(--festive-glow-b)',
      animate: { x: [0, -36, 0], y: [0, 28, 0] },
      duration: 25,
    },
  ];

  return (
    <>
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 70% 60%, white 1px, transparent 1px)',
          backgroundSize: '48px 48px, 64px 64px',
        }}
        aria-hidden
      />

      {washes.map((wash) => (
        <motion.div
          key={wash.key}
          className={cn(
            'pointer-events-none absolute rounded-full blur-[140px]',
            wash.className,
            // A festival's light replaces the brand washes while it shows.
            '[html[data-festive]_&]:bg-[var(--wash)]',
          )}
          style={{ ['--wash' as string]: wash.festive }}
          aria-hidden
          {...(reduced
            ? {}
            : {
                animate: wash.animate,
                transition: { duration: wash.duration, repeat: Infinity, ease: 'easeInOut' },
              })}
        />
      ))}

      {/* The route. A dashed line whose dashes travel, so it reads as a road
          being covered rather than as a squiggle. */}
      <svg
        className="pointer-events-none absolute inset-0 size-full"
        viewBox="0 0 600 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="auth-route" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            <stop offset="35%" stopColor="hsl(var(--sidebar-highlight))" stopOpacity="0.55" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <motion.path
          d="M-40 760 C 130 700, 150 520, 300 470 S 470 380, 520 190 S 560 60, 660 -20"
          stroke="url(#auth-route)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="5 11"
          {...(reduced
            ? {}
            : {
                animate: { strokeDashoffset: [0, -64] },
                transition: { duration: 3.6, repeat: Infinity, ease: 'linear' },
              })}
        />
      </svg>

      {/* Grounds the panel so the washes do not wander into the bottom edge. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-sidebar to-transparent"
        aria-hidden
      />
    </>
  );
}

/** One feature. Icon left, so four of them scan as a list rather than a wall. */
export function HighlightTile({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  const t = useT();

  return (
    <div
      className={cn(
        'group relative h-full overflow-hidden rounded-2xl p-4',
        'border border-white/[0.09] bg-gradient-to-br from-white/[0.08] to-white/[0.02]',
        'backdrop-blur-md transition-all duration-300 ease-smooth',
        'hover:-translate-y-0.5 hover:border-white/20 hover:from-white/[0.13] hover:to-white/[0.04]',
      )}
    >
      {/* Corner light, brightening on hover. */}
      <span
        className="pointer-events-none absolute -left-8 -top-8 size-24 rounded-full bg-sidebar-highlight/20 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        aria-hidden
      />

      <div className="relative flex gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] ring-1 ring-inset ring-white/10 transition-colors duration-300 group-hover:bg-white/[0.14]">
          <Icon className="size-4 text-accent" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold leading-snug text-sidebar-foreground">{t(title)}</p>
          <p className="text-xs leading-relaxed text-sidebar-muted">{t(body)}</p>
        </div>
      </div>
    </div>
  );
}
