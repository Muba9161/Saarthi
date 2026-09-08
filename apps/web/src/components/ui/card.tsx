import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Card surfaces.
 *
 * A card is a plane of card colour floating on the canvas, bounded by a
 * diffuse shadow and a hairline ring instead of a border — see the panel note
 * in globals.css for why the edge is carried by light rather than by a line.
 *
 * `solid` is the workhorse. `glass` now resolves to the same neutral panel
 * (it is the older name for it, kept because much of the product asks for it
 * by that name) and adds only the dark-theme top-edge highlight.
 *
 * `CardContent` and `CardFooter` drop their top padding only when something
 * precedes them, rather than unconditionally. The old flat `pt-0` assumed a
 * `CardHeader` was always above; used without one — which sixty-odd panels in
 * this product do — it left the content flush against the card's top edge.
 * Keying it on `:not(:first-child)` makes the common case correct with no call
 * site involved. Note the rule carries a pseudo-class, so it outranks a plain
 * `pt-*` from a caller: to add room under a header, pad the header.
 *
 * The padding on the sections below is deliberately NOT responsive. A
 * breakpoint-prefixed utility outranks an unprefixed one in tailwind-merge
 * regardless of which came first, so a base of `sm:p-6 sm:pt-0` silently voids
 * every caller that passes `pb-3` or `py-4` — at every width above `sm`, which
 * is most of them. The symptom is content sitting flush against the card's top
 * edge and header gaps that vary by card. Give a section more room by passing
 * it from the call site, not by adding a breakpoint here.
 */
const cardVariants = cva('rounded-xl text-card-foreground transition-shadow duration-200', {
  variants: {
    variant: {
      solid: 'surface',
      glass: 'glass-panel glass-sheen overflow-hidden rounded-xl',
      /** A quieter plane — used where a card must not compete with the one beside it. */
      outline: 'bg-transparent ring-1 ring-border',
      ghost: 'bg-transparent shadow-none ring-0',
      /** Feature cards: a whisper of brand light across an otherwise neutral panel. */
      gradient:
        'edge-accent bg-card bg-gradient-to-br from-primary/[0.05] via-card to-accent/[0.04] shadow-card ring-1 ring-foreground/[0.05] dark:from-primary/[0.10] dark:to-accent/[0.05] dark:ring-white/[0.06]',
      /** An inset well inside another panel. */
      sunken: 'surface-sunken shadow-none',
    },
    interactive: {
      true: 'surface-interactive cursor-pointer',
      false: '',
    },
  },
  defaultVariants: { variant: 'solid', interactive: false },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, interactive, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, interactive }), className)} {...props} />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-5', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-base font-semibold leading-tight tracking-[-0.01em]', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5 [&:not(:first-child)]:pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 p-5 [&:not(:first-child)]:pt-0', className)}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants };
