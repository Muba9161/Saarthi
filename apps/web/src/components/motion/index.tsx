import * as React from 'react';
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  useSpring,
  useTransform,
  type Variants,
} from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Motion vocabulary.
 *
 * A deliberately small set of primitives so animation stays consistent and
 * meaningful: things enter from where they came from, numbers count toward
 * their value, and lists reveal in reading order. Every primitive collapses to
 * an instant, non-animated render when the OS asks for reduced motion.
 */

/** Shared easing — fast out, settled finish, no overshoot. */
const EASE = [0.16, 1, 0.3, 1] as const;

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3, ease: EASE } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.28, ease: EASE } },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

/** Wraps a route so navigation has a sense of direction. */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Reveals children in sequence. Use for card grids and lists. */
export function Stagger({
  children,
  className,
  delay = 0,
  as: Component = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'ul' | 'section';
}) {
  const reduced = useReducedMotion();
  const MotionComponent = motion[Component];

  if (reduced) return <Component className={className}>{children}</Component>;

  return (
    <MotionComponent
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.055, delayChildren: delay } },
      }}
      className={className}
    >
      {children}
    </MotionComponent>
  );
}

/** A single item inside <Stagger>. */
export function StaggerItem({
  children,
  className,
  as: Component = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'li';
}) {
  const reduced = useReducedMotion();
  const MotionComponent = motion[Component];

  if (reduced) return <Component className={className}>{children}</Component>;

  return (
    <MotionComponent variants={fadeInUp} className={className}>
      {children}
    </MotionComponent>
  );
}

/** Animates in the first time it scrolls into view, then stays put. */
export function RevealOnScroll({
  children,
  className,
  amount = 0.2,
}: {
  children: React.ReactNode;
  className?: string;
  amount?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount });
  const reduced = useReducedMotion();

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      variants={fadeInUp}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * A number that animates to its value.
 *
 * Spring-driven rather than linear, so a metric that jumps from 3 to 40 reads
 * as a real change instead of a scramble. Formatting stays the caller's job so
 * currency and distance keep their own rules.
 */
export function AnimatedNumber({
  value,
  format = (input: number) => String(Math.round(input)),
  className,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const spring = useSpring(reduced ? value : 0, {
    stiffness: 90,
    damping: 20,
    restDelta: 0.5,
  });
  const display = useTransform(spring, (current) => format(current));

  React.useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  if (reduced) return <span className={className}>{format(value)}</span>;

  return <motion.span className={className}>{display}</motion.span>;
}

/** Width-animated bar. Used wherever progress is a first-class fact. */
export function AnimatedBar({
  value,
  className,
  barClassName,
  height = 'h-2',
}: {
  value: number;
  className?: string;
  barClassName?: string;
  height?: string;
}) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-muted', height, className)}>
      <motion.div
        className={cn('h-full rounded-full bg-primary', barClassName)}
        initial={reduced ? false : { width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.8, ease: EASE }}
      />
    </div>
  );
}

/** Emphasises a value that just changed — used by live telemetry readouts. */
export function LiveValue({
  children,
  trigger,
  className,
}: {
  children: React.ReactNode;
  /** Change this to replay the flash. */
  trigger: string | number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  if (reduced) return <span className={className}>{children}</span>;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={trigger}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6, position: 'absolute' }}
        transition={{ duration: 0.24, ease: EASE }}
        className={cn('inline-block', className)}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

/** Lift-on-hover wrapper for clickable cards. */
export function HoverLift({
  children,
  className,
  disabled,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const reduced = useReducedMotion();

  if (reduced || disabled) return <div className={className}>{children}</div>;

  return (
    <motion.div
      whileHover={{ y: -3 }}
      whileTap={{ y: 0, scale: 0.995 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export { motion, AnimatePresence, useReducedMotion };
