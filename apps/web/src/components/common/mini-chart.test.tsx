import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  MiniArea,
  MiniBars,
  MiniGauge,
  MiniSplit,
  hasPlottableData,
  toSeriesPoints,
} from './mini-chart';
import { StatCard } from './stat-card';

/**
 * The metric tiles plot real figures, so the thing worth testing is that they
 * plot them *faithfully*: the right number of marks, a baseline where the data
 * actually sits, and no invented shape when an organization has no history yet.
 * A chart that quietly lies is worse than no chart, and only geometry catches
 * that — a snapshot would happily record the lie.
 */

const points = [
  { label: '1 Jan', value: 4 },
  { label: '2 Jan', value: 0 },
  { label: '3 Jan', value: 8 },
];

describe('toSeriesPoints', () => {
  it('labels daily buckets by day and month', () => {
    expect(toSeriesPoints([{ date: '2026-03-09', value: 5 }])[0]?.label).toBe('9 Mar');
  });

  it('labels monthly buckets by month and year', () => {
    expect(toSeriesPoints([{ date: '2026-03', value: 5 }])[0]?.label).toBe('Mar 2026');
  });

  it('reads dates in UTC, so a bucket never slips a day for a user east of it', () => {
    // 1 Jan UTC is still 1 Jan for a reader in Kolkata (+05:30); parsed in
    // local time it would render as 31 Dec for anyone west of Greenwich.
    expect(toSeriesPoints([{ date: '2026-01-01', value: 1 }])[0]?.label).toBe('1 Jan');
  });

  it('passes the value through untouched', () => {
    expect(toSeriesPoints([{ date: '2026-03-09', value: 5 }])[0]?.value).toBe(5);
  });
});

describe('hasPlottableData', () => {
  it('plots an all-zero series — a quiet fortnight is real history', () => {
    expect(hasPlottableData({ kind: 'bars', points: [{ label: 'a', value: 0 }] })).toBe(true);
    expect(hasPlottableData({ kind: 'gauge', percent: 0 })).toBe(true);
  });

  it('has nothing to plot when the API sent no series at all', () => {
    expect(hasPlottableData({ kind: 'area', points: [] })).toBe(false);
    expect(hasPlottableData({ kind: 'split', segments: [] })).toBe(false);
    expect(hasPlottableData({ kind: 'gauge', percent: Number.NaN })).toBe(false);
  });
});

describe('MiniArea', () => {
  it('draws one line command per point', () => {
    const { container } = render(<MiniArea points={points} />);
    const line = container.querySelector('path[stroke]');
    expect(line?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(points.length);
  });

  it('scales from a zero baseline, so a quiet day sits on the floor', () => {
    const { container } = render(<MiniArea points={points} />);
    const commands = container.querySelector('path[stroke]')?.getAttribute('d') ?? '';
    const ys = [...commands.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((match) => Number(match[1]));
    // The zero bucket must be the lowest point on the chart (largest y).
    expect(ys[1]).toBeGreaterThan(ys[0] as number);
    expect(ys[1]).toBeGreaterThan(ys[2] as number);
  });

  it('holds a flat series on the baseline rather than through the middle', () => {
    const flat = [
      { label: 'a', value: 0 },
      { label: 'b', value: 0 },
    ];
    const { container } = render(<MiniArea points={flat} />);
    const commands = container.querySelector('path[stroke]')?.getAttribute('d') ?? '';
    const ys = [...commands.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((match) => Number(match[1]));
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBeGreaterThan(40);
  });

  it('pins a percentage series to a 0-100 scale, not to its own maximum', () => {
    const { container } = render(
      <MiniArea
        points={[
          { label: 'a', value: 0 },
          { label: 'b', value: 50 },
        ]}
        domainMax={100}
      />,
    );
    const commands = container.querySelector('path[stroke]')?.getAttribute('d') ?? '';
    const ys = [...commands.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((match) => Number(match[1]));
    // 50% must land near the middle. Scaled to its own max it would hit the top.
    expect(ys[1]).toBeGreaterThan(15);
    expect(ys[1]).toBeLessThan(30);
  });

  it('renders nothing when there is no series at all', () => {
    const { container } = render(<MiniArea points={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('describes the whole series to a screen reader', () => {
    render(<MiniArea points={points} format={(value) => `${value} km`} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('2 Jan: 0 km');
  });
});

describe('MiniBars', () => {
  it('draws one bar per bucket', () => {
    const { container } = render(<MiniBars points={points} />);
    expect(container.querySelectorAll('rect')).toHaveLength(points.length);
  });

  it('keeps a zero bucket visible as a hairline instead of dropping it', () => {
    const { container } = render(<MiniBars points={points} />);
    const heights = [...container.querySelectorAll('rect')].map((rect) =>
      Number(rect.getAttribute('height')),
    );
    expect(heights[1]).toBeGreaterThan(0);
    expect(heights[1]).toBeLessThan(heights[0] as number);
  });

  it('scales the tallest bar to the plot height', () => {
    const { container } = render(<MiniBars points={points} />);
    const heights = [...container.querySelectorAll('rect')].map((rect) =>
      Number(rect.getAttribute('height')),
    );
    expect(Math.max(...heights)).toBeGreaterThan(30);
  });
});

describe('MiniSplit', () => {
  it('sizes each segment by its share of the total', () => {
    const { container } = render(
      <MiniSplit
        segments={[
          { label: 'Valid', value: 75, tone: 'success' },
          { label: 'Expired', value: 25, tone: 'destructive' },
        ]}
      />,
    );
    const widths = [...container.querySelectorAll('span[style*="width"]')].map(
      (node) => (node as HTMLElement).style.width,
    );
    expect(widths).toEqual(['75%', '25%']);
  });

  it('drops zero segments rather than drawing them as slivers', () => {
    const { container } = render(
      <MiniSplit
        segments={[
          { label: 'Valid', value: 4, tone: 'success' },
          { label: 'Expired', value: 0, tone: 'destructive' },
        ]}
      />,
    );
    expect(container.querySelectorAll('span[style*="width"]')).toHaveLength(1);
  });

  it('shows an empty track when nothing has been recorded', () => {
    render(<MiniSplit segments={[{ label: 'Valid', value: 0, tone: 'success' }]} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Nothing recorded yet');
  });
});

describe('MiniGauge', () => {
  it('sweeps the arc in proportion to the percentage', () => {
    const { container } = render(<MiniGauge percent={50} />);
    const arc = container.querySelectorAll('circle')[1];
    const [swept = 0, full = 1] = (arc?.getAttribute('stroke-dasharray') ?? '')
      .split(' ')
      .map(Number);
    expect(swept / full).toBeCloseTo(0.5, 2);
  });

  it('clamps a figure outside 0-100 instead of overdrawing the ring', () => {
    const { container } = render(<MiniGauge percent={140} />);
    const arc = container.querySelectorAll('circle')[1];
    const [swept = 0, full = 1] = (arc?.getAttribute('stroke-dasharray') ?? '')
      .split(' ')
      .map(Number);
    expect(swept).toBeCloseTo(full, 2);
    expect(screen.getByText('100')).toBeInTheDocument();
  });
});

describe('StatCard chart slot', () => {
  it('plots the chart in place of the icon when a series is supplied', () => {
    const { container } = render(
      <StatCard label="Revenue" value="₹4.2L" chart={{ kind: 'bars', points }} />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(points.length);
  });

  it('keeps the icon when the tile has no series to plot', () => {
    const Icon = () => <svg data-testid="tile-icon" />;
    render(<StatCard label="Payload" value="12 t" icon={Icon} />);
    expect(screen.getByTestId('tile-icon')).toBeInTheDocument();
  });

  it('falls back to the icon rather than leaving a hole when a series is empty', () => {
    const Icon = () => <svg data-testid="tile-icon" />;
    render(
      <StatCard label="Revenue" value="₹0" icon={Icon} chart={{ kind: 'area', points: [] }} />,
    );
    expect(screen.getByTestId('tile-icon')).toBeInTheDocument();
  });

  it('still draws a flat line for a genuine run of zeroes', () => {
    const { container } = render(
      <StatCard
        label="Revenue"
        value="₹0"
        chart={{
          kind: 'area',
          points: [
            { label: 'a', value: 0 },
            { label: 'b', value: 0 },
          ],
        }}
      />,
    );
    expect(container.querySelector('path[stroke]')).not.toBeNull();
  });
});
