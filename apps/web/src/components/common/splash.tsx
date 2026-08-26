import * as React from 'react';
import { cn } from '@/lib/utils';
import { SaarthiLockup } from './logo';

/**
 * Full-screen brand splash.
 *
 * Shown while the session resolves — the moment after the bundle has loaded but
 * before the app knows who is signed in. The boot splash in `index.html` covers
 * the gap before that; this one takes over so the two read as one continuous
 * screen rather than a flash of brand, a flash of blank, then the app.
 *
 * The loading indicator is a road with a dash travelling down it, because the
 * logo has one running through the V. A generic spinner would have done the
 * job, but this is the one screen every user sees on every visit, and it costs
 * nothing to make it belong to this product rather than any product.
 */
export function SplashScreen({
  label = 'Getting your fleet ready',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-7 overflow-hidden',
        'bg-[radial-gradient(120%_90%_at_50%_18%,hsl(var(--card))_0%,hsl(var(--background))_62%)]',
        className,
      )}
    >
      {/* Ambient wash in the brand's saffron and green, drifting slowly. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-1/3 opacity-70 motion-safe:animate-[splash-drift_14s_ease-in-out_infinite_alternate]"
        style={{
          background:
            'radial-gradient(38% 30% at 22% 30%, rgba(254,93,9,.16), transparent 70%),' +
            'radial-gradient(40% 32% at 78% 68%, rgba(2,120,63,.16), transparent 70%)',
        }}
      />

      <SaarthiLockup className="relative w-[min(268px,58vw)] motion-safe:animate-[splash-rise_900ms_cubic-bezier(.16,1,.3,1)_both]" />

      <div
        aria-hidden
        className="relative h-1 w-[min(268px,58vw)] overflow-hidden rounded-full bg-primary/10"
      >
        <div className="absolute inset-y-0 left-0 w-[42%] rounded-full bg-[linear-gradient(90deg,#fe5d09,#011c45_52%,#02783f)] motion-safe:animate-[splash-travel_1500ms_cubic-bezier(.65,0,.35,1)_infinite] motion-reduce:w-full" />
      </div>

      <p className="relative text-2xs font-semibold uppercase tracking-[0.34em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
