import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * A handset, drawn in CSS, holding one real app screen.
 *
 * Drawn rather than photographed so the screen inside stays a crisp capture
 * that can be swapped per step; a phone baked into a photograph can only ever
 * show the one screen it was shot with. The proportions follow the capture
 * (720x1650), so a screen is shown whole and never cropped.
 *
 * The captures have their system status bar painted out, and this draws a
 * neutral one over the top: a clock at 9:41 and full bars rather than
 * somebody's notifications and battery level.
 */
export function PhoneFrame({
  src,
  alt,
  screenKey,
  className,
  decorative = false,
  priority = false,
}: {
  src: string;
  alt: string;
  /** Changes when the screen does, so the swap crossfades. */
  screenKey: string;
  className?: string;
  /** A background phone: hidden from assistive tech, never announced. */
  decorative?: boolean;
  priority?: boolean;
}) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(() => new Set());

  return (
    <div
      aria-hidden={decorative || undefined}
      className={cn(
        'relative rounded-[2.9rem] bg-gradient-to-b from-[#3a3a40] via-[#1c1c20] to-[#2a2a30] p-[0.55rem]',
        'shadow-[0_40px_80px_-24px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)_inset]',
        className,
      )}
    >
      {/* Side keys: volume on the left, power on the right. */}
      <span
        className="absolute -left-[3px] top-[18%] h-14 w-[3px] rounded-l bg-[#2a2a30]"
        aria-hidden
      />
      <span
        className="absolute -right-[3px] top-[24%] h-20 w-[3px] rounded-r bg-[#2a2a30]"
        aria-hidden
      />

      <div className="relative aspect-[720/1650] overflow-hidden rounded-[2.4rem] bg-[#0e0e10]">
        <AnimatePresence initial={false}>
          {failed.has(screenKey) ? null : (
            <motion.img
              key={screenKey}
              src={src}
              alt={decorative ? '' : alt}
              width={720}
              height={1650}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              draggable={false}
              onError={() => setFailed((held) => new Set(held).add(screenKey))}
              initial={reduced ? false : { opacity: 0, scale: 1.03 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={{ duration: 0.55, ease: EASE }}
              className="absolute inset-0 size-full select-none object-cover"
            />
          )}
        </AnimatePresence>

        <StatusBar />
        {/* Glass: one soft highlight across the top corner. */}
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.07)_0%,transparent_32%)]"
          aria-hidden
        />
      </div>
    </div>
  );
}

/** The clock, the camera and full bars, over a scrim that hides the seam. */
function StatusBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[7%]" aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/20 to-transparent" />
      <div className="relative flex h-[62%] items-center justify-between px-[8%] text-[0.62rem] font-semibold text-white sm:text-[0.68rem]">
        <span className="tabular-nums">9:41</span>
        <span className="absolute left-1/2 top-1/2 size-[0.62rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black ring-1 ring-white/10" />
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 16 12" className="h-[0.6rem] w-auto" fill="currentColor">
            <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .4C5.2.4 2.7 1.5.8 3.3L2 4.6a8.6 8.6 0 0 1 6-2.4Zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.8 6.8 0 0 0 8 4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3ZM8 9.4 9.8 7.6a2.6 2.6 0 0 0-3.6 0L8 9.4Z" />
          </svg>
          <svg viewBox="0 0 16 12" className="h-[0.6rem] w-auto" fill="currentColor">
            <rect x="0" y="8" width="3" height="4" rx="0.6" />
            <rect x="4.3" y="5.5" width="3" height="6.5" rx="0.6" />
            <rect x="8.6" y="3" width="3" height="9" rx="0.6" />
            <rect x="12.9" y="0" width="3" height="12" rx="0.6" />
          </svg>
          <svg viewBox="0 0 24 12" className="h-[0.6rem] w-auto">
            <rect
              x="0.5"
              y="0.5"
              width="20"
              height="11"
              rx="2.6"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.5"
            />
            <rect x="2" y="2" width="17" height="8" rx="1.4" fill="currentColor" />
            <rect
              x="21.5"
              y="4"
              width="2"
              height="4"
              rx="0.8"
              fill="currentColor"
              fillOpacity="0.5"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}
