import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CityFuelRate, PetrolStation } from '@saarthi/shared';
import { PetrolStationCard, PetrolStationListHeader } from './petrol-station-card';

/**
 * Petrol station rendering.
 *
 * The point of these tests is not that a card appears — it is that the card
 * cannot drift into claiming things the fuel directory never told us. A
 * regression here would be a product-integrity bug, not a cosmetic one.
 *
 * Two claims the directory specifically cannot support, and which it once made
 * on screen:
 *
 *  * A price per station. The directory publishes one rate per city and stamps
 *    it onto every station in it, so the figure belongs to the area.
 *  * Petrol and diesel at a CNG outlet. `has_petrol` and `has_diesel` are
 *    `true` on every record the directory publishes, including ones it names
 *    "… CNG Station", so those flags are defaults and not observations.
 */

function station(overrides: Partial<PetrolStation> = {}): PetrolStation {
  return {
    id: 'ssr:81233',
    externalId: '81233',
    source: 'ssr',
    name: 'U. P. Petrol Service Station',
    company: 'BPCL',
    latitude: 26.846159,
    longitude: 80.945557,
    address: 'Near Capitol Cinema, Hazratganj',
    city: 'Lucknow',
    district: 'Lucknow',
    state: 'Uttar Pradesh',
    hasPetrol: true,
    hasDiesel: true,
    hasCng: false,
    petrolPrice: 94.73,
    dieselPrice: 87.86,
    cngPrice: null,
    timings: '24 Hours',
    directionsUrl: 'https://maps.google.com/maps?q=26.846159,80.945557',
    distanceKm: 0.12,
    direction: 'SW',
    ...overrides,
  };
}

describe('PetrolStationCard', () => {
  it('renders the station identity and distance', () => {
    render(<PetrolStationCard station={station()} />);

    expect(screen.getByText('BPCL')).toBeInTheDocument();
    expect(screen.getByText('U. P. Petrol Service Station')).toBeInTheDocument();
    expect(screen.getByText('Near Capitol Cinema, Hazratganj')).toBeInTheDocument();
    expect(screen.getByText('0.12 km')).toBeInTheDocument();
    expect(screen.getByText('24 Hours')).toBeInTheDocument();
  });

  it('shows no price at all, because the directory has no usable one', () => {
    // Measured 2026-08-31: the directory gave Gurugram petrol at 95.44 against a
    // real 102.97, carried no timestamp, and repeated one city figure onto every
    // station. A rate that is 8% low is worse than absent, because absent is
    // obvious. Nothing rupee-denominated may appear on this card.
    render(<PetrolStationCard station={station()} />);

    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('₹');
  });

  it('labels fuels as sold, never as currently available', () => {
    render(<PetrolStationCard station={station()} />);

    // A BPCL forecourt sells petrol and diesel; this one lists no CNG.
    expect(screen.getAllByText('Sold here')).toHaveLength(2);
    expect(screen.getAllByText('Not sold here')).toHaveLength(1);

    // The card must never imply live stock, litres or dispenser state.
    const text = document.body.textContent ?? '';
    for (const forbidden of ['currently available', 'in stock', 'litres remaining', 'tank']) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('does not sell petrol at a CNG outlet', () => {
    // The directory sends has_petrol/has_diesel true even here. Believing it is
    // how a gas outlet came to advertise a petrol price.
    render(
      <PetrolStationCard
        station={station({
          name: 'Indraprastha Gas Limited CNG Station',
          company: 'Unknown',
          hasPetrol: true,
          hasDiesel: true,
          hasCng: true,
        })}
       
      />,
    );

    expect(screen.getAllByText('Not sold here')).toHaveLength(2);
    expect(screen.getAllByText('Sold here')).toHaveLength(1);
  });

  it('admits it does not know for an unbranded pump', () => {
    render(
      <PetrolStationCard
        station={station({ name: 'Shri Ram Filling Point', company: null })}
       
      />,
    );

    // No brand to reason from and no usable flag, so no claim is made.
    expect(screen.getAllByText('Not published')).toHaveLength(2);
  });

  it('survives a station with almost nothing published', () => {
    render(
      <PetrolStationCard
        station={station({
          name: null,
          company: null,
          address: null,
          timings: null,
          directionsUrl: null,
          distanceKm: null,
          direction: null,
          hasPetrol: null,
          hasDiesel: null,
          hasCng: null,
          petrolPrice: null,
          dieselPrice: null,
          cngPrice: null,
        })}
      />,
    );

    expect(screen.getByText('Petrol station')).toBeInTheDocument();
    expect(screen.queryByText('Directions')).not.toBeInTheDocument();
    expect(screen.queryByText('Route')).not.toBeInTheDocument();
  });

  it('reports the selected station to its parent', async () => {
    const onSelect = vi.fn();
    render(<PetrolStationCard station={station()} onSelect={onSelect} />);

    await userEvent.click(screen.getByText('U. P. Petrol Service Station'));

    expect(onSelect).toHaveBeenCalledWith('ssr:81233');
  });

  it('asks its parent to draw the route rather than leaving for a map site', async () => {
    const onShowRoute = vi.fn();
    const onSelect = vi.fn();
    render(
      <PetrolStationCard station={station()} onSelect={onSelect} onShowRoute={onShowRoute} />,
    );

    // No external escape hatch when the page can draw the route itself.
    expect(screen.queryByText('Directions')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Route'));

    expect(onShowRoute).toHaveBeenCalledWith(expect.objectContaining({ id: 'ssr:81233' }));
    // Routing is not selecting; the click must not double as a row select.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers to clear the route it is currently showing', async () => {
    const onClearRoute = vi.fn();
    render(
      <PetrolStationCard
        station={station()}
        onShowRoute={vi.fn()}
        onClearRoute={onClearRoute}
        routeActive
      />,
    );

    await userEvent.click(screen.getByText('Clear route'));

    expect(onClearRoute).toHaveBeenCalled();
  });

  it('falls back to the published link only when it cannot route in-page', async () => {
    const onSelect = vi.fn();
    render(<PetrolStationCard station={station()} onSelect={onSelect} />);

    const link = screen.getByText('Directions');
    expect(link.closest('a')).toHaveAttribute('target', '_blank');

    await userEvent.click(link);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

/** A published city rate, as the rate publisher supplies it. */
function cityRate(overrides: Partial<CityFuelRate> = {}): CityFuelRate {
  return {
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    petrol: { price: 102.31, unit: 'litre' },
    diesel: { price: 95.79, unit: 'litre' },
    cng: { price: 99.5, unit: 'kg' },
    publishedOn: '2026-08-31',
    source: 'CarDekho',
    retrievedAt: '2026-08-31T09:00:00.000Z',
    cached: false,
    ...overrides,
  };
}

describe('PetrolStationListHeader', () => {
  it('shows the published city rate with its date and source', () => {
    render(<PetrolStationListHeader count={12} stale={false} rate={cityRate()} />);

    expect(screen.getByText(/Lucknow, Uttar Pradesh — published 2026-08-31/)).toBeInTheDocument();
    expect(screen.getByText('₹102.31/L')).toBeInTheDocument();
    expect(screen.getByText('₹95.79/L')).toBeInTheDocument();
    // CNG is retailed by weight; the unit must not silently become litres.
    expect(screen.getByText('₹99.50/kg')).toBeInTheDocument();
    expect(screen.getByText(/via CarDekho/)).toBeInTheDocument();
  });

  it('omits a fuel the publisher had no rate for', () => {
    render(<PetrolStationListHeader count={4} stale={false} rate={cityRate({ cng: null })} />);

    expect(screen.getByText('₹102.31/L')).toBeInTheDocument();
    // No CNG row, and no invented dash standing in for one.
    expect(screen.queryByText('CNG')).not.toBeInTheDocument();
  });

  it('says the date is unstated rather than implying it is today', () => {
    render(
      <PetrolStationListHeader count={4} stale={false} rate={cityRate({ publishedOn: null })} />,
    );

    expect(screen.getByText(/date not stated/i)).toBeInTheDocument();
  });

  it('says why no price is shown rather than leaving a gap', () => {
    render(<PetrolStationListHeader count={3} stale={false} />);

    expect(screen.getByText('3 stations nearby')).toBeInTheDocument();
    expect(screen.getByText(/publishes no current rate/i)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('₹');
  });

  it('says so plainly when the data is a stored fallback', () => {
    render(<PetrolStationListHeader count={1} stale />);

    expect(screen.getByText('1 station nearby')).toBeInTheDocument();
    expect(screen.getByText(/unreachable/i)).toBeInTheDocument();
  });
});
