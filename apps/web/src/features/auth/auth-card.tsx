import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared chrome for the four screens that live inside `AuthLayout`.
 *
 * Sign-in, registration, forgot-password and reset-password are one flow a
 * person walks through in a single sitting, so they have to look like one
 * surface. Before this, each screen hand-rolled its own heading block and sat
 * loose on the background; a person bounced from sign-in to reset and back saw
 * the page furniture move under them.
 *
 * `AuthCard` also carries `glass-fields`, which is what makes the inputs
 * translucent instead of opaque white patches stuck onto a frosted pane — the
 * same treatment the registration wizard already gave its own fields.
 */

export function AuthCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'glass-panel glass-fields relative overflow-hidden rounded-2xl',
        'p-5 shadow-lifted sm:p-7',
        className,
      )}
    >
      {/* Brand wash, matching the wizard shell so the two read as one system. */}
      <span
        className="pointer-events-none absolute inset-0 -z-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(120% 90% at 0% 0%, hsl(var(--primary) / 0.09), transparent 62%),' +
            'radial-gradient(100% 80% at 100% 100%, hsl(var(--accent) / 0.08), transparent 60%)',
        }}
      />
      <div className="relative z-[1]">{children}</div>
    </section>
  );
}

/** Eyebrow, title and one line of context. */
export function AuthHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {eyebrow ? <p className="section-label text-primary/80">{eyebrow}</p> : null}
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      {description ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/** A hairline with a word in it — "or", "New to Saarthi?". */
export function AuthDivider({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3" role="presentation">
      <span className="h-px flex-1 bg-border dark:bg-white/10" />
      {children ? (
        <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          {children}
        </span>
      ) : null}
      <span className="h-px flex-1 bg-border dark:bg-white/10" />
    </div>
  );
}

/**
 * A leading icon inside a field.
 *
 * The icon is the only thing that tells email and password apart at a glance
 * once the labels have been read once. It is `pointer-events-none` so clicking
 * it still focuses the input underneath, and the child is expected to carry
 * `pl-10` to make room.
 */
export function FieldIcon({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <Icon
        className="pointer-events-none absolute left-3 top-1/2 z-[1] size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      {children}
    </div>
  );
}
