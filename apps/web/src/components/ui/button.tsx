import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium',
    'transition-all duration-200 ease-smooth',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:scale-[0.985]',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/92 hover:shadow-glow',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/92 hover:shadow-glow-danger',
        // A hairline ring rather than a border, so an outline button sits on
        // the page the same way a panel does.
        outline:
          'bg-card shadow-sm ring-1 ring-border hover:bg-muted/60 hover:ring-border-strong',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'hover:bg-muted hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        accent: 'bg-accent text-accent-foreground shadow-sm hover:bg-accent/92',
        success: 'bg-success text-success-foreground shadow-sm hover:bg-success/92',
        // Frosted — for controls floating over a map or imagery.
        glass: 'glass text-foreground hover:bg-card',
        gradient:
          'bg-brand-gradient text-primary-foreground shadow-sm hover:shadow-glow hover:brightness-105',
      },
      size: {
        // One step taller than before. The reference language buys its calm
        // with air, and a 40px control is the smallest that reads as roomy
        // while still fitting a dense operational toolbar.
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3 text-xs',
        lg: 'h-11 px-6',
        xl: 'h-14 rounded-xl px-8 text-base',
        icon: 'size-10',
        'icon-sm': 'size-9 rounded-md',
        'icon-lg': 'size-11',
      },
      /**
       * Fully round controls, for the pill chrome the reference language uses
       * on filter rows and floating map buttons. Additive — every existing
       * call site keeps the default rounding.
       */
      shape: {
        default: '',
        pill: 'rounded-full',
      },
    },
    defaultVariants: { variant: 'default', size: 'default', shape: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and blocks interaction while an action is in flight. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, shape, asChild = false, loading = false, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';

    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, shape, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      );
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, shape, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
