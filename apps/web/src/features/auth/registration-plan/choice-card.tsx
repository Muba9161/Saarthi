import * as React from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/** Arrow keys move through a radio group, as they do through native radios. */
const ARROW_STEP: Readonly<Record<string, number>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/**
 * A single-choice list of `ChoiceCard`s.
 *
 * Tab enters the group once and the arrows move the selection, which is what
 * a keyboard user expects of `role="radiogroup"` — tabbing through every card
 * was the old behaviour, and it made a five-answer question fifteen presses.
 */
export function ChoiceGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = ARROW_STEP[event.key];
    if (!step) return;

    const radios = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    const current = radios.findIndex((radio) => radio === document.activeElement);
    if (current === -1) return;

    event.preventDefault();
    const next = radios[(current + step + radios.length) % radios.length];
    next?.focus();
    next?.click();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('grid grid-cols-1 gap-2', className)}
    >
      {children}
    </div>
  );
}

/**
 * One answer in a `ChoiceGroup`: an icon, a name, one line under it and, for
 * a plan, its price on the right where prices line up to be compared.
 */
export function ChoiceCard({
  icon: Icon,
  title,
  description,
  meta,
  selected,
  focusable,
  onSelect,
  index,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  meta?: React.ReactNode;
  selected: boolean;
  /** The one card Tab lands on — the selected one, or the first. */
  focusable: boolean;
  onSelect: () => void;
  /** Position in the list, for the entrance stagger. */
  index: number;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={focusable ? 0 : -1}
      onClick={onSelect}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.04, ease: EASE }}
      whileTap={reduced ? undefined : { scale: 0.985 }}
      className={cn(
        'glass-inset flex w-full items-center gap-3 p-3 text-left',
        'transition-[background-color,border-color,box-shadow] duration-200 ease-smooth',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'glass-choice-selected' : 'hover:bg-white/60 dark:hover:bg-white/[0.06]',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200',
          selected
            ? 'bg-primary/15 text-primary'
            : 'bg-muted/60 text-muted-foreground dark:bg-white/[0.06]',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {description}
        </span>
      </span>

      {meta ? <span className="shrink-0 text-right">{meta}</span> : null}

      {/* A filled mark, not just a tint: the chosen card has to be obvious in
          bright sunlight and to someone reading a script they are new to. */}
      <span
        className={cn(
          'flex size-[1.125rem] shrink-0 items-center justify-center rounded-full transition-colors duration-200',
          selected ? 'bg-primary text-primary-foreground' : 'ring-1 ring-inset ring-border-strong',
        )}
        aria-hidden
      >
        <AnimatePresence initial={false}>
          {selected ? (
            <motion.span
              key="tick"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              <Check className="size-3" strokeWidth={3.5} />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}
