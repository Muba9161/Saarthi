import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Saarthi Mitra's face.
 *
 * A small, expressive character rather than a spinner. It waves hello, leans
 * in and raises a brow while the person types, looks up and away while it
 * thinks, talks while its reply is written out, and then reacts: pleased,
 * excited when it has prepared something, heart-eyed when thanked, concerned
 * or confused when an answer carried trouble, drowsy when left alone. Every
 * state collapses to a still face when the OS asks for reduced motion.
 */

export type SaarthiMood =
  | 'idle'
  | 'listening'
  | 'curious'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'excited'
  | 'love'
  | 'waving'
  | 'wink'
  | 'surprised'
  | 'concerned'
  | 'confused'
  | 'sleepy';

type Eyes = 'open' | 'arcs' | 'hearts' | 'wink' | 'wide' | 'sleepy';
type Brows = 'none' | 'worried' | 'raised' | 'curious' | 'confused';

interface Expression {
  eyes: Eyes;
  brows: Brows;
  /** A stroked mouth path, or a filled shape for open mouths. */
  mouth: { d: string; filled?: boolean };
  gaze: { x: number; y: number };
  blush?: boolean;
}

const EXPRESSIONS: Record<SaarthiMood, Expression> = {
  idle: {
    eyes: 'open',
    brows: 'none',
    mouth: { d: 'M 36 64 Q 50 71 64 64' },
    gaze: { x: 0, y: 0 },
  },
  listening: {
    eyes: 'open',
    brows: 'none',
    mouth: { d: 'M 38 64 Q 50 69 62 64' },
    gaze: { x: 0, y: 1 },
  },
  curious: {
    eyes: 'open',
    brows: 'curious',
    mouth: { d: 'M 40 65 Q 50 67 60 63' },
    gaze: { x: 2, y: -1 },
  },
  thinking: {
    eyes: 'open',
    brows: 'none',
    mouth: { d: 'M 40 66 Q 50 64 60 66' },
    gaze: { x: 3, y: -4 },
  },
  speaking: {
    eyes: 'open',
    brows: 'none',
    mouth: { d: 'M 38 63 Q 50 72 62 63' },
    gaze: { x: 0, y: 0 },
  },
  happy: {
    eyes: 'arcs',
    brows: 'none',
    mouth: { d: 'M 33 61 Q 50 79 67 61' },
    gaze: { x: 0, y: 0 },
    blush: true,
  },
  excited: {
    eyes: 'wide',
    brows: 'raised',
    mouth: { d: 'M 34 60 Q 50 60 66 60 Q 62 78 50 78 Q 38 78 34 60 Z', filled: true },
    gaze: { x: 0, y: 0 },
    blush: true,
  },
  love: {
    eyes: 'hearts',
    brows: 'none',
    mouth: { d: 'M 34 61 Q 50 78 66 61' },
    gaze: { x: 0, y: 0 },
    blush: true,
  },
  waving: {
    eyes: 'arcs',
    brows: 'none',
    mouth: { d: 'M 34 61 Q 50 77 66 61' },
    gaze: { x: 0, y: 0 },
    blush: true,
  },
  wink: {
    eyes: 'wink',
    brows: 'none',
    mouth: { d: 'M 36 62 Q 52 74 66 60' },
    gaze: { x: 0, y: 0 },
  },
  surprised: {
    eyes: 'wide',
    brows: 'raised',
    mouth: { d: 'M 44 66 Q 44 59 50 59 Q 56 59 56 66 Q 56 73 50 73 Q 44 73 44 66 Z', filled: true },
    gaze: { x: 0, y: -1 },
  },
  concerned: {
    eyes: 'open',
    brows: 'worried',
    mouth: { d: 'M 38 68 Q 50 61 62 68' },
    gaze: { x: 0, y: 1.5 },
  },
  confused: {
    eyes: 'open',
    brows: 'confused',
    mouth: { d: 'M 38 66 Q 44 62 50 66 Q 56 70 62 65' },
    gaze: { x: -2, y: -1 },
  },
  sleepy: {
    eyes: 'sleepy',
    brows: 'none',
    mouth: { d: 'M 44 66 Q 50 68 56 66' },
    gaze: { x: 0, y: 2 },
  },
};

/** How the whole head moves in each mood. */
function bodyMotion(mood: SaarthiMood): { animate: TargetAndTransition; transition: object } {
  const loop = (duration: number) => ({ duration, repeat: Infinity, ease: 'easeInOut' });
  switch (mood) {
    case 'happy':
      return {
        animate: { y: [0, -6, 0, -3, 0], rotate: 0, scale: 1 },
        transition: { duration: 0.9, ease: 'easeOut' },
      };
    case 'excited':
      return {
        animate: { y: [0, -9, 0, -9, 0], rotate: [0, -4, 4, 0], scale: 1 },
        transition: { duration: 1, ease: 'easeOut' },
      };
    case 'love':
      return {
        animate: { scale: [1, 1.08, 1, 1.08, 1], rotate: 0, y: 0 },
        transition: { duration: 1.3, ease: 'easeInOut' },
      };
    case 'waving':
      return {
        animate: { rotate: [0, -5, 5, -3, 0], y: 0, scale: 1 },
        transition: { duration: 1.4, ease: 'easeInOut' },
      };
    case 'surprised':
      return {
        animate: { y: [0, -5, 0], scale: [1, 1.06, 1], rotate: 0 },
        transition: { duration: 0.45, ease: 'easeOut' },
      };
    case 'concerned':
      return {
        animate: { rotate: -6, y: 0, scale: 1 },
        transition: { type: 'spring', stiffness: 220, damping: 16 },
      };
    case 'confused':
      return {
        animate: { rotate: [0, 8, -4, 6], y: 0, scale: 1 },
        transition: { duration: 1.2, ease: 'easeInOut' },
      };
    case 'curious':
      return {
        animate: { rotate: 8, y: 0, scale: 1.04 },
        transition: { type: 'spring', stiffness: 240, damping: 15 },
      };
    case 'listening':
      return {
        animate: { rotate: 3, y: 0, scale: 1.04 },
        transition: { type: 'spring', stiffness: 260, damping: 18 },
      };
    case 'sleepy':
      return { animate: { rotate: [4, 8, 4], y: [1, 3, 1], scale: 1 }, transition: loop(3.6) };
    default:
      return { animate: { scale: [1, 1.035, 1], rotate: 0, y: 0 }, transition: loop(3.2) };
  }
}

const SIZES = { sm: 'size-8', md: 'size-12', lg: 'size-24' } as const;

function heart(cx: number, cy: number): string {
  return `M ${cx} ${cy + 4} C ${cx - 9} ${cy - 3} ${cx - 4} ${cy - 10} ${cx} ${cy - 5} C ${cx + 4} ${cy - 10} ${cx + 9} ${cy - 3} ${cx} ${cy + 4} Z`;
}

export function SaarthiAvatar({
  mood = 'idle',
  size = 'md',
  className,
}: {
  mood?: SaarthiMood;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const still = useReducedMotion() ?? false;
  const face = EXPRESSIONS[mood];
  const body = bodyMotion(mood);
  const glowId = `mitra-glow-${React.useId().replace(/:/g, '')}`;
  const pop = {
    initial: { opacity: 0, scale: 0.4 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.4 },
  };

  return (
    <motion.div
      aria-hidden
      className={cn('relative shrink-0 text-primary', SIZES[size], className)}
      animate={still ? undefined : body.animate}
      transition={body.transition}
    >
      {mood === 'thinking' && !still ? <OrbitingSparks /> : null}

      <svg viewBox="0 0 100 100" className="size-full overflow-visible">
        <defs>
          <radialGradient id={glowId} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
            <stop offset="70%" stopColor="currentColor" stopOpacity="0.75" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
          </radialGradient>
        </defs>

        {/* Halo: brighter while it listens, talks or celebrates. */}
        <motion.circle
          cx="50"
          cy="50"
          r="49"
          fill="currentColor"
          initial={false}
          animate={{
            opacity: ['listening', 'speaking', 'curious'].includes(mood)
              ? 0.22
              : ['happy', 'excited', 'love', 'waving'].includes(mood)
                ? 0.3
                : 0.1,
          }}
          transition={{ duration: 0.4 }}
        />
        <circle cx="50" cy="50" r="42" fill={`url(#${glowId})`} />
        <ellipse cx="38" cy="30" rx="10" ry="6" fill="white" opacity="0.25" />

        {/* Cheeks */}
        <motion.g
          initial={false}
          animate={{ opacity: face.blush ? 0.55 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <ellipse cx="27" cy="60" rx="6" ry="3.5" fill="#fb7185" />
          <ellipse cx="73" cy="60" rx="6" ry="3.5" fill="#fb7185" />
        </motion.g>

        <BrowsLayer brows={face.brows} />
        <EyesLayer eyes={face.eyes} gaze={face.gaze} still={still} />

        {/* Mouth: the talking one opens and closes; the rest morph between shapes. */}
        {mood === 'speaking' && !still ? (
          <motion.ellipse
            cx="50"
            cy="66"
            rx="8"
            fill="white"
            animate={{ ry: [2, 6, 3, 7, 2] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : face.mouth.filled ? (
          <motion.path
            key={mood}
            d={face.mouth.d}
            fill="white"
            initial={{ scale: 0.6 }}
            animate={{ scale: 1 }}
            style={{ transformOrigin: '50px 66px' }}
          />
        ) : (
          <motion.path
            d={face.mouth.d}
            initial={false}
            animate={{ d: face.mouth.d }}
            transition={{ type: 'spring', stiffness: 180, damping: 18 }}
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}

        {/* Extras around the head. */}
        <AnimatePresence>
          {mood === 'waving' ? (
            <motion.g key="hand" {...pop}>
              <motion.g
                style={{ transformOrigin: '86px 92px' }}
                animate={still ? undefined : { rotate: [0, 22, -8, 22, -8, 16, 0] }}
                transition={{ duration: 1.4, ease: 'easeInOut', repeat: still ? 0 : 1 }}
              >
                <text x="80" y="92" fontSize="26">
                  👋
                </text>
              </motion.g>
            </motion.g>
          ) : null}
          {mood === 'love' ? (
            <motion.g key="hearts" {...pop}>
              {[
                { x: 86, y: 18, delay: 0 },
                { x: 12, y: 24, delay: 0.3 },
                { x: 92, y: 40, delay: 0.6 },
              ].map((spot) => (
                <motion.path
                  key={spot.x}
                  d={heart(spot.x, spot.y)}
                  fill="#fb7185"
                  animate={still ? undefined : { y: [0, -10, -18], opacity: [0, 1, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, delay: spot.delay }}
                />
              ))}
            </motion.g>
          ) : null}
          {mood === 'excited' ? (
            <motion.g key="sparkles" {...pop} fill="#fbbf24">
              {[
                { x: 90, y: 14 },
                { x: 8, y: 20 },
                { x: 94, y: 62 },
              ].map((spot, index) => (
                <motion.path
                  key={spot.x}
                  d={`M ${spot.x} ${spot.y - 7} L ${spot.x + 2} ${spot.y - 2} L ${spot.x + 7} ${spot.y} L ${spot.x + 2} ${spot.y + 2} L ${spot.x} ${spot.y + 7} L ${spot.x - 2} ${spot.y + 2} L ${spot.x - 7} ${spot.y} L ${spot.x - 2} ${spot.y - 2} Z`}
                  style={{ transformOrigin: `${spot.x}px ${spot.y}px` }}
                  animate={still ? undefined : { scale: [0.4, 1.2, 0.4], rotate: [0, 45, 90] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.2 }}
                />
              ))}
            </motion.g>
          ) : null}
          {mood === 'sleepy' ? (
            <motion.g key="zz" {...pop} fill="currentColor" fontWeight="700">
              {[
                { x: 78, y: 26, s: 12, delay: 0 },
                { x: 88, y: 12, s: 16, delay: 0.8 },
              ].map((z) => (
                <motion.text
                  key={z.x}
                  x={z.x}
                  y={z.y}
                  fontSize={z.s}
                  animate={still ? undefined : { y: [z.y, z.y - 8], opacity: [0, 1, 0] }}
                  transition={{ duration: 2.2, repeat: Infinity, delay: z.delay }}
                >
                  z
                </motion.text>
              ))}
            </motion.g>
          ) : null}
          {mood === 'confused' || mood === 'curious' ? (
            <motion.text
              key="question"
              {...pop}
              x="84"
              y="22"
              fontSize="22"
              fontWeight="800"
              fill="currentColor"
            >
              ?
            </motion.text>
          ) : null}
        </AnimatePresence>
      </svg>
    </motion.div>
  );
}

function OrbitingSparks() {
  return (
    <motion.div
      className="absolute inset-[-12%]"
      animate={{ rotate: 360 }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
    >
      {[0, 120, 240].map((angle) => {
        const radians = (angle * Math.PI) / 180;
        return (
          <span
            key={angle}
            className="absolute size-[12%] rounded-full bg-primary/70"
            style={{
              left: `${50 + 50 * Math.sin(radians)}%`,
              top: `${50 - 50 * Math.cos(radians)}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        );
      })}
    </motion.div>
  );
}

function BrowsLayer({ brows }: { brows: Brows }) {
  const lines: Record<Exclude<Brows, 'none'>, [string, string]> = {
    worried: ['M 30 36 L 42 39', 'M 70 36 L 58 39'],
    raised: ['M 30 31 Q 37 27 44 31', 'M 56 31 Q 63 27 70 31'],
    curious: ['M 30 35 L 43 36', 'M 56 30 Q 63 25 70 29'],
    confused: ['M 30 31 Q 37 27 44 32', 'M 56 37 L 70 34'],
  };
  if (brows === 'none') return null;
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      {lines[brows].map((d) => (
        <path key={d} d={d} stroke="white" strokeWidth="3" strokeLinecap="round" fill="none" />
      ))}
    </motion.g>
  );
}

function EyesLayer({
  eyes,
  gaze,
  still,
}: {
  eyes: Eyes;
  gaze: { x: number; y: number };
  still: boolean;
}) {
  const stroke = { stroke: 'white', strokeWidth: 4, strokeLinecap: 'round' as const, fill: 'none' };

  if (eyes === 'arcs') {
    return (
      <g {...stroke}>
        <path d="M 31 48 Q 38 40 45 48" />
        <path d="M 55 48 Q 62 40 69 48" />
      </g>
    );
  }
  if (eyes === 'hearts') {
    return (
      <motion.g
        fill="#fb7185"
        animate={still ? undefined : { scale: [1, 1.15, 1] }}
        transition={{ duration: 0.8, repeat: Infinity }}
        style={{ transformOrigin: '50px 46px' }}
      >
        <path d={heart(38, 47)} />
        <path d={heart(62, 47)} />
      </motion.g>
    );
  }
  if (eyes === 'sleepy') {
    return (
      <g {...stroke}>
        <path d="M 32 48 Q 38 52 44 48" />
        <path d="M 56 48 Q 62 52 68 48" />
      </g>
    );
  }
  if (eyes === 'wink') {
    return (
      <g>
        <ellipse cx="38" cy="47" rx="5.5" ry="7" fill="white" />
        <path d="M 55 48 Q 62 42 69 48" {...stroke} />
      </g>
    );
  }

  const wide = eyes === 'wide';
  return (
    <motion.g
      style={{ transformOrigin: '50px 47px' }}
      animate={still || wide ? undefined : { scaleY: [1, 1, 0.1, 1] }}
      transition={{ duration: 4.2, times: [0, 0.92, 0.96, 1], repeat: Infinity }}
    >
      {[38, 62].map((cx) => (
        <motion.ellipse
          key={cx}
          cx={cx}
          cy="47"
          initial={false}
          animate={{ x: gaze.x, y: gaze.y, rx: wide ? 7 : 5.5, ry: wide ? 8.5 : 7 }}
          transition={{ type: 'spring', stiffness: 200, damping: 16 }}
          fill="white"
        />
      ))}
    </motion.g>
  );
}
