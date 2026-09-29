import { CarFront, Crosshair, Footprints, Ruler, Sun } from 'lucide-react';
import { VEHICLE_SPIN_FRAMES } from '@saarthi/shared';
import { useReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';

/** A dot circling a vehicle: what "walk round it" means, without words. */
export function OrbitGuide({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const path = 'M 24 4 A 18 13 0 1 1 23.99 4';

  return (
    <div
      className={cn('relative flex size-12 shrink-0 items-center justify-center', className)}
      aria-hidden
    >
      <svg viewBox="0 0 48 34" className="absolute inset-0 size-full text-primary">
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        <circle r={2.5} fill="currentColor" cx={reduced ? 24 : 0} cy={reduced ? 4 : 0}>
          {reduced ? null : <animateMotion dur="3.2s" repeatCount="indefinite" path={path} />}
        </circle>
      </svg>
      <CarFront className="relative size-[35%] text-foreground/70" />
    </div>
  );
}

const STEPS = [
  {
    icon: Sun,
    title: 'Park in the open',
    body: 'Room to walk all the way round, in even daylight.',
  },
  {
    icon: Ruler,
    title: 'Stand about two metres away',
    body: 'The whole vehicle in frame, phone held at chest height.',
  },
  {
    icon: Footprints,
    title: 'Walk one slow circle',
    body: `A 20–40 second video, or a photo every few steps — ${VEHICLE_SPIN_FRAMES.min} to ${VEHICLE_SPIN_FRAMES.max} in all.`,
  },
  {
    icon: Crosshair,
    title: 'Keep it centred',
    body: 'Finish where you started, so the turn closes without a jump.',
  },
] as const;

/**
 * How to shoot a walk-around, as steps rather than a paragraph.
 *
 * Shown beside the uploader where there is room for it: the result of a spin is
 * decided before anything is uploaded, by how it was filmed.
 */
export function SpinShootingGuide({ className }: { className?: string }) {
  return (
    <div className={cn('glass-inset flex flex-col gap-4 p-4', className)}>
      <div className="flex items-center gap-3">
        <OrbitGuide className="size-14" />
        <div>
          <p className="text-sm font-medium">How to shoot it</p>
          <p className="text-xs text-muted-foreground">About a minute, with any phone.</p>
        </div>
      </div>

      <ol className="space-y-3">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {title}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
