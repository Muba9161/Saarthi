import * as React from 'react';
import { motion, useReducedMotion } from '@/components/motion';

/**
 * A single celebratory burst of confetti.
 *
 * Built on framer-motion, which the app already ships, rather than a confetti
 * library: forty small pieces animated once with transform and opacity, then
 * gone. Nothing renders for somebody who prefers reduced motion.
 */

const COLOURS = ['#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#818cf8', '#f97316'];
const PIECES = 40;

interface Piece {
  id: number;
  x: number;
  y: number;
  rotate: number;
  delay: number;
  size: number;
  colour: string;
  round: boolean;
}

function pieces(): Piece[] {
  return Array.from({ length: PIECES }, (_, id) => {
    const angle = (Math.PI * 2 * id) / PIECES + Math.random() * 0.4;
    const distance = 140 + Math.random() * 180;
    return {
      id,
      x: Math.cos(angle) * distance,
      // Thrown up and out, then falls.
      y: Math.sin(angle) * distance * 0.6 + 160 + Math.random() * 80,
      rotate: (Math.random() - 0.5) * 720,
      delay: Math.random() * 0.15,
      size: 6 + Math.random() * 6,
      colour: COLOURS[id % COLOURS.length]!,
      round: id % 3 === 0,
    };
  });
}

export function ConfettiBurst({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  // Fixed for the life of the burst, so a re-render does not re-throw it.
  const [burst] = React.useState(pieces);
  if (reduced) return null;

  return (
    <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-10 flex justify-center ${className ?? ''}`}>
      {burst.map((piece) => (
        <motion.span
          key={piece.id}
          className="absolute block"
          style={{
            width: piece.size,
            height: piece.round ? piece.size : piece.size * 0.45,
            backgroundColor: piece.colour,
            borderRadius: piece.round ? '9999px' : '2px',
          }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{
            x: piece.x,
            y: [0, piece.y * -0.35, piece.y],
            opacity: [1, 1, 0],
            rotate: piece.rotate,
            scale: 1,
          }}
          transition={{ duration: 1.8, delay: piece.delay, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
    </div>
  );
}
