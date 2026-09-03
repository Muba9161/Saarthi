import * as React from 'react';
import { useInView, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { motion, useReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * Motion vocabulary for the public site only.
 *
 * `@/components/motion` is deliberately a small, product-wide set — things
 * enter from where they came from, numbers count toward their value. A
 * marketing page wants a second register on top of that: scroll-linked
 * parallax, headlines that assemble word by word, an endless marquee. None of
 * it belongs in the operational screens, so none of it is added to the shared
 * module.
 *
 * Every primitive here collapses to a static render under
 * `prefers-reduced-motion`. That is not a nicety on this page: it is the one
 * page a stranger lands on, and a stranger with vestibular sensitivity should
 * not be ambushed by a parallax hero.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

/* -------------------------------------------------------------------------
 * Scroll reveal
 * ---------------------------------------------------------------------- */

type RevealDirection = 'up' | 'down' | 'left' | 'right' | 'none';

const OFFSETS: Record<RevealDirection, { x: number; y: number }> = {
  up: { x: 0, y: 28 },
  down: { x: 0, y: -28 },
  left: { x: 28, y: 0 },
  right: { x: -28, y: 0 },
  none: { x: 0, y: 0 },
};

/**
 * Reveals once, on first scroll into view, and then stays put.
 *
 * `once` matters: an element that re-animates every time it re-enters the
 * viewport turns scrolling back up into a light show, and makes the page feel
 * unfinished rather than alive.
 */
export function Reveal({
  children,
  className,
  direction = 'up',
  delay = 0,
  duration = 0.6,
  amount = 0.25,
  as = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  direction?: RevealDirection;
  delay?: number;
  duration?: number;
  /** Fraction of the element that must be visible before it fires. */
  amount?: number;
  as?: 'div' | 'li' | 'section' | 'span';
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount });
  const offset = OFFSETS[direction];
  const Component = motion[as];

  if (reduced) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Component
      ref={ref as never}
      className={className}
      initial={{ opacity: 0, x: offset.x, y: offset.y }}
      animate={inView ? { opacity: 1, x: 0, y: 0 } : undefined}
      transition={{ duration, delay, ease: EASE }}
    >
      {children}
    </Component>
  );
}

/**
 * A group whose children reveal in sequence as it scrolls in.
 *
 * Separate from the shared `Stagger`, which fires on mount — on a long page
 * that means every list below the fold has already finished animating by the
 * time it is reached.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.07,
  delay = 0,
  amount = 0.15,
  as = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  amount?: number;
  as?: 'div' | 'ul' | 'ol';
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount });
  const Component = motion[as];

  if (reduced) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Component
      ref={ref as never}
      className={className}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
    >
      {children}
    </Component>
  );
}

/** A child of `RevealGroup`. */
export function RevealItem({
  children,
  className,
  as = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'li';
}) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  if (reduced) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Component
      className={className}
      variants={{
        hidden: { opacity: 0, y: 24 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
      }}
    >
      {children}
    </Component>
  );
}

/* -------------------------------------------------------------------------
 * Headlines
 * ---------------------------------------------------------------------- */

/**
 * A heading that assembles word by word.
 *
 * Words, not characters: per-character animation on a nine-word headline is
 * sixty elements animating at once, it reads as a glitch rather than as
 * writing, and a screen reader has to be handed the whole string separately.
 * Here each word is one span and the accessible text is the ordinary text
 * content of the heading.
 */
export function WordsReveal({
  text,
  className,
  delay = 0,
  as: Component = 'h2',
}: {
  text: string;
  className?: string;
  delay?: number;
  as?: 'h1' | 'h2' | 'h3' | 'p';
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLHeadingElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });

  if (reduced) return <Component className={className}>{text}</Component>;

  const MotionComponent = motion[Component];
  const words = text.split(' ');

  return (
    <MotionComponent
      ref={ref as never}
      className={className}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.045, delayChildren: delay } },
      }}
    >
      {words.map((word, index) => (
        // Index in the key because a headline can legitimately repeat a word.
        <React.Fragment key={`${word}-${index}`}>
          <span className="inline-block overflow-hidden align-bottom">
            <motion.span
              className="inline-block"
              variants={{
                hidden: { y: '100%', opacity: 0 },
                visible: { y: '0%', opacity: 1, transition: { duration: 0.6, ease: EASE } },
              }}
            >
              {word}
            </motion.span>
          </span>
          {/*
            A real text node between the words — and the reason it sits out
            here rather than inside the span.

            Each word is an `inline-block` so its own overflow can clip the
            slide-up. Adjacent inline-blocks with no text node between them
            give the line breaker nowhere to break, so the whole heading
            becomes one unbreakable line. That does not merely look wrong on a
            phone: it makes the page wider than the viewport, and because the
            document clips horizontal overflow rather than scrolling it, every
            section beside it is cut off. The space has to be between the
            spans.
          */}
          {index < words.length - 1 ? ' ' : null}
        </React.Fragment>
      ))}
    </MotionComponent>
  );
}

/* -------------------------------------------------------------------------
 * Marquee
 * ---------------------------------------------------------------------- */

/**
 * An endless horizontal band.
 *
 * The list is rendered twice and the track translated by exactly half its
 * width, which is what makes the loop seamless without measuring anything.
 * The duplicate is `aria-hidden`, so the content is announced once.
 */
export function Marquee({
  children,
  className,
  duration = 40,
  reverse = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Seconds for one full pass. Slower reads as texture; faster as noise. */
  duration?: number;
  reverse?: boolean;
}) {
  const reduced = useReducedMotion();

  if (reduced) {
    // Static, clipped, and scrollable by hand — never a frozen half-row.
    return (
      <div className={cn('overflow-x-auto scrollbar-none', className)}>
        <div className="flex w-max items-center">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn('group relative overflow-hidden', className)}
      // Fades both edges so items enter and leave rather than being cut off.
      style={{
        maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
      }}
    >
      <motion.div
        className="flex w-max items-center"
        animate={{ x: reverse ? ['-50%', '0%'] : ['0%', '-50%'] }}
        transition={{ duration, repeat: Infinity, ease: 'linear' }}
      >
        <div className="flex items-center">{children}</div>
        <div className="flex items-center" aria-hidden>
          {children}
        </div>
      </motion.div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Scroll-linked helpers
 * ---------------------------------------------------------------------- */

/**
 * A spring-smoothed 0→1 of how far a target has travelled through the
 * viewport, and the ref to attach to it.
 *
 * Spring-smoothed because raw `scrollYProgress` follows a trackpad's jitter
 * exactly, which looks mechanical; a light spring makes the same movement feel
 * like weight.
 */
export function useSectionProgress(): {
  ref: React.RefObject<HTMLDivElement>;
  progress: MotionValue<number>;
} {
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 26, restDelta: 0.001 });

  return { ref, progress };
}

/** Maps a 0→1 progress onto a pixel range, for parallax layers. */
export function useParallax(progress: MotionValue<number>, distance: number): MotionValue<number> {
  return useTransform(progress, [0, 1], [distance, -distance]);
}

/* -------------------------------------------------------------------------
 * Pointer spotlight
 * ---------------------------------------------------------------------- */

/**
 * Publishes the pointer's position on the element as `--spot-x` / `--spot-y`.
 *
 * Paired with `spotlightSurface` below, this puts a soft light under the
 * cursor. CSS variables rather than React state on purpose — a `mousemove`
 * that re-renders a card is a re-render sixty times a second, for a gradient.
 */
export function useSpotlight<T extends HTMLElement>(): {
  ref: React.RefObject<T>;
  onPointerMove: React.PointerEventHandler<T>;
} {
  const ref = React.useRef<T>(null);

  const onPointerMove = React.useCallback<React.PointerEventHandler<T>>((event) => {
    const node = ref.current;
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    node.style.setProperty('--spot-x', `${event.clientX - bounds.left}px`);
    node.style.setProperty('--spot-y', `${event.clientY - bounds.top}px`);
  }, []);

  return { ref, onPointerMove };
}

/** The layer the spotlight paints into. Give the parent `relative`. */
export function Spotlight({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300',
        'group-hover:opacity-100',
        className,
      )}
      style={{
        background:
          'radial-gradient(220px circle at var(--spot-x, 50%) var(--spot-y, 50%), hsl(var(--primary) / 0.14), transparent 70%)',
      }}
    />
  );
}
