import * as React from 'react';

/**
 * The printed-certificate details of the Virtual RC: a guilloche band, a
 * rosette, micro-text edges and an ink stamp.
 *
 * Deliberately Saarthi's own. Nothing here imitates a government emblem, seal
 * or hologram — the paper says "reference copy" in its micro-text, its
 * watermark and its footer, so it can never pass for a real certificate. The
 * curves are computed once, at module load, rather than shipped as path data.
 */

const GUILLOCHE_COLOURS = ['#E8892B', '#26318F', '#1E8A3A'];

/** Nine interleaved sine waves, each with a slow envelope — the banknote band. */
const GUILLOCHE_PATHS = Array.from({ length: 9 }, (_, wave) => {
  const points: string[] = [];
  for (let x = 0; x <= 1000; x += 6) {
    const envelope = 0.55 + 0.45 * Math.cos((2 * Math.PI * x) / 740 + wave * 0.5);
    const y = 60 + 34 * Math.sin((2 * Math.PI * x) / 86 + (wave * Math.PI) / 4.5) * envelope;
    points.push(`${x} ${y.toFixed(1)}`);
  }
  return `M${points.join(' L')}`;
});

/** A hypotrochoid — the spirograph rose printed under the fields. */
const ROSETTE_PATH = (() => {
  const [outer, inner, pen] = [7, 3, 5];
  const scale = 160 / (outer - inner + pen);
  const points: string[] = [];
  for (let t = 0; t <= 6 * Math.PI + 0.03; t += 0.03) {
    const x = (outer - inner) * Math.cos(t) + pen * Math.cos(((outer - inner) / inner) * t);
    const y = (outer - inner) * Math.sin(t) - pen * Math.sin(((outer - inner) / inner) * t);
    points.push(`${(170 + x * scale).toFixed(1)} ${(170 + y * scale).toFixed(1)}`);
  }
  return `M${points.join(' L')}Z`;
})();

const MICRO_TEXT = 'SAARTHI VIRTUAL RC • REFERENCE COPY • NOT FOR LEGAL USE • '.repeat(14).trim();

export function PaperDecor() {
  return (
    <>
      <svg className="vrc-guilloche" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden>
        {GUILLOCHE_PATHS.map((d, wave) => (
          <path key={wave} d={d} style={{ stroke: GUILLOCHE_COLOURS[wave % 3] }} />
        ))}
      </svg>
      <svg className="vrc-rosette" viewBox="0 0 340 340" aria-hidden>
        <path d={ROSETTE_PATH} />
      </svg>
      <div className="vrc-watermark" aria-hidden>
        VIRTUAL COPY
      </div>
      <p className="vrc-micro top-3" aria-hidden>
        {MICRO_TEXT}
      </p>
      <p className="vrc-micro bottom-3" aria-hidden>
        {MICRO_TEXT}
      </p>
    </>
  );
}

/**
 * The navy ink stamp. The rough edge is SVG turbulence displacing the strokes,
 * as real ink bleeds into paper. Ids come from `useId` because the front and
 * back faces each mount their own stamp.
 */
export function InkStamp({ date }: { date: string }) {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg className="vrc-stamp" viewBox="0 0 160 160" aria-hidden>
      <defs>
        <filter id={`${id}-ink`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale={2.4} />
        </filter>
        <path id={`${id}-ring`} d="M80 80 m-57 0 a57 57 0 1 1 114 0 a57 57 0 1 1 -114 0" />
      </defs>
      <g filter={`url(#${id}-ink)`}>
        <circle cx="80" cy="80" r="74" strokeWidth="3" />
        <circle cx="80" cy="80" r="67" strokeWidth="1" />
        <circle cx="80" cy="80" r="45" strokeWidth="1.4" />
        <text fontSize="10.5" fontWeight="600" letterSpacing="1.6">
          <textPath href={`#${id}-ring`}>FETCHED FROM THE RTO REGISTER • SAARTHI •</textPath>
        </text>
        <text x="80" y="77" textAnchor="middle" fontSize="15" fontWeight="600" letterSpacing="1">
          VIRTUAL
        </text>
        <text x="80" y="95" textAnchor="middle" fontSize="10" fontWeight="500">
          {date}
        </text>
      </g>
    </svg>
  );
}
