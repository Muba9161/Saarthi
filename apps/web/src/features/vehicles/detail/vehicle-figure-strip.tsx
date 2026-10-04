import * as React from 'react';

export interface VehicleFigure {
  label: string;
  value: React.ReactNode;
  hint?: string | undefined;
}

/**
 * The figures an owner checks first, in one panel divided by hairlines.
 *
 * Which figures appear is the page's decision — it asks the capability model,
 * so a taxi never shows a payload and a truck never shows seats. The strip is
 * as wide as what it is given: four cells for most vehicles, three for a
 * two-wheeler.
 */
export function VehicleFigureStrip({ figures }: { figures: VehicleFigure[] }) {
  return (
    <section
      aria-label="Key figures"
      className="vd-panel vd-strip"
      style={{ '--cells': figures.length } as React.CSSProperties}
    >
      {figures.map((figure) => (
        <div key={figure.label} className="flex min-w-0 flex-col gap-1 px-6 py-5">
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {figure.label}
          </span>
          <span className="vd-display tabular truncate text-[30px]">{figure.value}</span>
          {figure.hint ? (
            <span className="truncate text-[13px] text-muted-foreground">{figure.hint}</span>
          ) : null}
        </div>
      ))}
    </section>
  );
}
