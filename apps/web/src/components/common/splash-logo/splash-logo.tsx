import type * as React from 'react';
import { cn } from '@/lib/utils';
import { SaarthiLockup } from '../logo';
import { LOGO_TRACE } from './logo-trace.generated';

/**
 * How far into a cycle `.splash-logo--once` stops — drawn, filled, held. Must
 * match `--splash-runs` on that class in `globals.css`.
 */
const ONCE_FRACTION = 0.6;

/**
 * The lockup, drawn in by hand as its own loading indicator.
 *
 * All of the motion is CSS — the `.splash-logo` block in `globals.css` — so
 * this and the boot splash in `index.html` are the same animation from the
 * same traced art, not two lookalikes.
 *
 * Without `drawInMs` it loops for as long as it is on screen. With it, it draws
 * and fills once over that long, then holds.
 */
export function SplashLogo({
  drawInMs,
  className,
}: {
  drawInMs?: number | undefined;
  className?: string;
}) {
  const [width, height] = LOGO_TRACE.box;
  const style =
    drawInMs === undefined
      ? undefined
      : ({ '--splash-cycle': `${drawInMs / ONCE_FRACTION}ms` } as React.CSSProperties);

  return (
    <div
      className={cn('splash-logo', drawInMs !== undefined && 'splash-logo--once', className)}
      style={style}
    >
      <svg
        className="splash-logo__trace"
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
        focusable="false"
      >
        {LOGO_TRACE.strokes.map((stroke, index) => (
          <path
            key={index}
            className={`splash-logo__stroke splash-logo__stroke--${stroke.ink}`}
            style={{ '--at': stroke.at } as React.CSSProperties}
            pathLength={1}
            d={stroke.d}
          />
        ))}
      </svg>
      <SaarthiLockup className="splash-logo__ink w-full" />
    </div>
  );
}
