import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PetrolStation } from '@saarthi/shared';
import { PetrolStationCard, PetrolStationListHeader } from './petrol-station-card';

/**
 * Petrol station rendering.
 *
 * The point of these tests is not that a card appears — it is that the card
 * cannot drift into claiming things the fuel directory never told us. A
 * regression here would be a product-integrity bug, not a cosmetic one.
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
  it('renders the station identity, prices and distance', () => {
    render(<PetrolStationCard station={station()} />);

    expect(screen.getByText('BPCL')).toBeInTheDocument();
    expect(screen.getByText('U. P. Petrol Service Station')).toBeInTheDocument();
    expect(screen.getByText('Near Capitol Cinema, Hazratganj')).toBeInTheDocument();
    expect(screen.getByText('₹94.73')).toBeInTheDocument();
    expect(screen.getByText('₹87.86')).toBeInTheDocument();
    expect(screen.getByText('0.12 km')).toBeInTheDocument();
    expect(screen.getByText('24 Hours')).toBeInTheDocument();
  });

  it('labels fuels as offered, never as currently available', () => {
    render(<PetrolStationCard station={station()} />);

    // Petrol and diesel are sold here; CNG is not listed.
    expect(screen.getAllByText('Offered here')).toHaveLength(2);
    expect(screen.getAllByText('Not listed')).toHaveLength(1);

    // The card must never imply live stock, litres or dispenser state.
    const text = document.body.textContent ?? '';
    for (const forbidden of ['currently available', 'in stock', 'litres remaining', 'tank']) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('shows a dash for a price the directory did not publish', () => {
    render(<PetrolStationCard station={station({ cngPrice: null, hasCng: true })} />);

    // CNG is sold here but no rate was published — no number is invented.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getAllByText('Offered here')).toHaveLength(3);
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
    expect(screen.getAllByText('Not listed')).toHaveLength(3);
    expect(screen.queryByText('Directions')).not.toBeInTheDocument();
  });

  it('reports the selected station to its parent', async () => {
    const onSelect = vi.fn();
    render(<PetrolStationCard station={station()} onSelect={onSelect} />);

    await userEvent.click(screen.getByText('U. P. Petrol Service Station'));

    expect(onSelect).toHaveBeenCalledWith('ssr:81233');
  });

  it('does not select the station when the directions link is used', async () => {
    const onSelect = vi.fn();
    render(<PetrolStationCard station={station()} onSelect={onSelect} />);

    await userEvent.click(screen.getByText('Directions'));

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('PetrolStationListHeader', () => {
  it('describes prices as published rather than live', () => {
    render(<PetrolStationListHeader count={3} stale={false} />);

    expect(screen.getByText('3 stations nearby')).toBeInTheDocument();
    expect(screen.getByText(/not live pump readings/i)).toBeInTheDocument();
  });

  it('says so plainly when the data is a stored fallback', () => {
    render(<PetrolStationListHeader count={1} stale />);

    expect(screen.getByText('1 station nearby')).toBeInTheDocument();
    expect(screen.getByText(/unreachable/i)).toBeInTheDocument();
  });
});
