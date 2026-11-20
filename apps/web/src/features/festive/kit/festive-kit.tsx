import * as React from 'react';
import { X } from 'lucide-react';
import {
  FESTIVE_KITS,
  festiveGreeting,
  festiveSignature,
  localYmd,
  textDirection,
  type FestivalKey,
} from '@saarthi/shared';
import { useLocale } from '@/features/i18n/locale-context';
import { cn } from '@/lib/utils';
import { BAND_HEIGHT, festiveBandMarkup } from './band-markup';
import './festive-kit.css';

/**
 * The festive layer's visuals, in their own chunk: downloaded only on a day a
 * festival shows and only for a visitor who wants it (see `festive-slots.tsx`).
 * The wish table for all nineteen languages rides along here, not in the
 * entry bundle.
 */

/** The garland strip. Decorative: hidden from assistive technology. */
export function FestiveBandArt({
  festival,
  className,
}: {
  festival: FestivalKey;
  className?: string;
}) {
  const uid = React.useId();
  const markup = React.useMemo(() => festiveBandMarkup(festival, uid), [festival, uid]);
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none w-full overflow-hidden', className)}
      style={{ height: BAND_HEIGHT }}
      // Built only from FESTIVE_KITS colours and fixed geometry; no user input.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

interface Piece {
  left: string;
  delay: string;
  duration: string;
  colour: string;
}

function pieces(festival: FestivalKey, count: number): Piece[] {
  const colours = FESTIVE_KITS[festival].fxColors;
  return Array.from({ length: count }, (_, index) => ({
    left: `${(index * 37 + 11) % 100}%`,
    delay: `-${((index * 1.37) % 9).toFixed(2)}s`,
    duration: `${(8 + (index % 5) * 1.3).toFixed(1)}s`,
    colour: colours[index % colours.length] ?? '#FFFFFF',
  }));
}

/**
 * Pieces drifting across a festive panel: petals, snow, confetti, stars, kites
 * or rising embers. Inside the panel only, never over a form, and switched off
 * entirely under `prefers-reduced-motion` (festive-kit.css).
 */
export function FestiveParticles({
  festival,
  count = 18,
  travel = 700,
  className,
}: {
  festival: FestivalKey;
  count?: number;
  /** How far a piece travels, in px: the panel's height or a little more. */
  travel?: number;
  className?: string;
}) {
  const fx = FESTIVE_KITS[festival].fx;
  const list = React.useMemo(() => pieces(festival, count), [festival, count]);
  return (
    <div
      aria-hidden
      className={cn(
        'festive-particles pointer-events-none absolute inset-0 overflow-hidden',
        className,
      )}
      style={{ ['--festive-travel' as string]: `${travel}px` }}
    >
      {list.map((piece, index) => (
        <span
          key={index}
          className={`festive-piece festive-piece--${fx}`}
          style={{
            left: piece.left,
            animationDelay: piece.delay,
            animationDuration: piece.duration,
            background: piece.colour,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The wish in the visitor's language, optionally addressed by first name, with
 * "from everyone at VorldX Saarthi" beneath it.
 */
export function FestiveWish({
  festival,
  firstName,
  tone = 'dark',
  signature = true,
  size = 'md',
  className,
}: {
  festival: FestivalKey;
  firstName?: string | null;
  tone?: 'dark' | 'light';
  signature?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const { locale } = useLocale();
  const dir = textDirection(locale);
  return (
    <div className={cn('festive-wish', className)} lang={locale} dir={dir}>
      <p
        className={cn(
          'festive-wish__line font-semibold leading-tight',
          size === 'sm' && 'text-base',
          size === 'md' && 'text-2xl',
          size === 'lg' && 'text-3xl sm:text-4xl',
        )}
        style={{
          color: tone === 'dark' ? 'var(--festive-wish-dark)' : 'var(--festive-wish-light)',
        }}
      >
        {festiveGreeting(festival, locale, firstName)}
      </p>
      {signature ? (
        <p
          className={cn(
            'mt-1 text-sm',
            tone === 'dark' ? 'text-white/75' : 'text-muted-foreground',
          )}
        >
          {festiveSignature(locale)}
        </p>
      ) : null}
    </div>
  );
}

function hiddenKey(festival: FestivalKey): string {
  return `saarthi.festive-greeting-hidden.${festival}.${localYmd()}`;
}

function readHidden(festival: FestivalKey): boolean {
  try {
    return window.localStorage.getItem(hiddenKey(festival)) === '1';
  } catch {
    return false;
  }
}

/**
 * The dashboard's greeting card: one per day, and it can be hidden until
 * tomorrow. Dark, lit by the festival's two glows, with the pieces drifting
 * inside it.
 */
export function FestiveGreetingCard({
  festival,
  firstName,
  hideLabel,
  className,
}: {
  festival: FestivalKey;
  firstName?: string | null;
  /** "Hide the greeting", already translated by the caller. */
  hideLabel: string;
  className?: string;
}) {
  const [hidden, setHidden] = React.useState(() => readHidden(festival));
  React.useEffect(() => setHidden(readHidden(festival)), [festival]);

  if (hidden) return null;

  const hide = () => {
    try {
      window.localStorage.setItem(hiddenKey(festival), '1');
    } catch {
      // Hidden for this page only.
    }
    setHidden(true);
  };

  return (
    <section
      className={cn(
        'relative flex items-center gap-4 overflow-hidden rounded-2xl px-5 py-5 text-white sm:px-6',
        className,
      )}
      style={{
        background:
          'radial-gradient(70% 140% at 0% 100%, var(--festive-glow-a), transparent 70%),' +
          'radial-gradient(60% 140% at 100% 0%, var(--festive-glow-b), transparent 70%), #121215',
      }}
    >
      <FestiveParticles festival={festival} count={14} travel={180} />
      <FestiveWish
        festival={festival}
        firstName={firstName ?? null}
        className="relative min-w-0 flex-1"
      />
      <button
        type="button"
        onClick={hide}
        aria-label={hideLabel}
        title={hideLabel}
        className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <X className="size-4" aria-hidden />
      </button>
    </section>
  );
}

/**
 * Dress the boot splash, which is plain DOM from `index.html` and still on
 * screen while the session resolves: the garland along its top edge and the
 * wish above its caption. Its colours already follow the festival through
 * `--festive-glow-*`. Does nothing once the splash has gone.
 */
export function dressBootSplash(festival: FestivalKey, locale: string): void {
  const splash = document.getElementById('boot-splash');
  if (!splash || splash.dataset.leaving === 'true' || splash.dataset.festive) return;
  splash.dataset.festive = festival;

  const band = document.createElement('div');
  band.setAttribute('aria-hidden', 'true');
  band.style.cssText = `position:absolute;top:0;left:0;right:0;height:${BAND_HEIGHT}px;pointer-events:none`;
  band.innerHTML = festiveBandMarkup(festival, 'boot');
  splash.prepend(band);

  const wish = document.createElement('p');
  wish.className = 'festive-boot-wish';
  wish.lang = locale;
  wish.dir = textDirection(locale);
  wish.textContent = festiveGreeting(festival, locale);
  wish.style.color = FESTIVE_KITS[festival].wishOnLight;
  const caption = document.getElementById('boot-splash__word');
  if (caption) splash.insertBefore(wish, caption);
  else splash.append(wish);
}
