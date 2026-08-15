import { cn } from '@/lib/utils';

/** Saarthi mark: a truck silhouette in the brand navy and saffron. */
export function SaarthiLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('size-8', className)}
      role="img"
      aria-label="Saarthi"
      fill="none"
    >
      <rect width="64" height="64" rx="14" className="fill-primary" />
      <path d="M10 40V26a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v14H10Z" className="fill-accent" />
      <path d="M36 30h9.5a3 3 0 0 1 2.6 1.5L53 40H36V30Z" fill="#FFFFFF" />
      <circle cx="20" cy="42" r="5" className="fill-primary" stroke="#FFFFFF" strokeWidth="2.5" />
      <circle cx="45" cy="42" r="5" className="fill-primary" stroke="#FFFFFF" strokeWidth="2.5" />
    </svg>
  );
}

export function SaarthiWordmark({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <SaarthiLogo className="size-9" />
      <div className="leading-tight">
        <p className="text-lg font-semibold tracking-tight">Saarthi</p>
        <p className="text-2xs uppercase tracking-widest text-muted-foreground">
          Fleet Operations
        </p>
      </div>
    </div>
  );
}
