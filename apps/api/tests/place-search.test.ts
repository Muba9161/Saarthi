import { describe, expect, it } from 'vitest';
import { destinationPoint } from '@saarthi/shared';
import { photonMatches } from '../src/providers/places/photon-place-search';
import { mergePlaceMatches } from '../src/modules/terminal/navigation.service';
import type { PlaceMatch } from '../src/providers/routing';

/**
 * Place search by name: Photon's answers read into places, and merged with the
 * routing geocoder's so one place found by both is listed once.
 */

const LUCKNOW = { latitude: 26.8467, longitude: 80.9462 };

const feature = (name: string, at: { latitude: number; longitude: number }, extra: Record<string, string> = {}) => ({
  geometry: { coordinates: [at.longitude, at.latitude] as [number, number] },
  properties: { name, countrycode: 'IN', ...extra },
});

describe('Photon place search', () => {
  it('reads a named place with a readable address and its distance', () => {
    const bbd = destinationPoint(LUCKNOW, 70, 14_000);
    const [match] = photonMatches(
      [feature('Babu Banarasi Das University', bbd, { district: 'Chinhat', city: 'Lucknow', state: 'Uttar Pradesh' })],
      LUCKNOW,
    );
    expect(match).toMatchObject({
      name: 'Babu Banarasi Das University',
      address: 'Chinhat, Lucknow, Uttar Pradesh',
    });
    expect(match!.distanceMeters).toBeGreaterThan(13_900);
    expect(match!.distanceMeters).toBeLessThan(14_100);
  });

  it('leaves out places outside India and points with no name', () => {
    const matches = photonMatches(
      [
        feature('University Centre', LUCKNOW, { countrycode: 'GB' }),
        { geometry: { coordinates: [LUCKNOW.longitude, LUCKNOW.latitude] as [number, number] }, properties: {} },
      ],
      LUCKNOW,
    );
    expect(matches).toEqual([]);
  });
});

describe('merging two place searches', () => {
  const place = (name: string, at: { latitude: number; longitude: number }): PlaceMatch => ({
    name,
    address: null,
    ...at,
    distanceMeters: null,
  });

  it('lists a place found by both searches once, keeping the first search\'s', () => {
    const medanta = destinationPoint(LUCKNOW, 160, 12_000);
    const photon = [place('Medanta Lucknow Hospital', medanta)];
    const routed = [place('Medanta', destinationPoint(medanta, 0, 60)), place('Lulu Mall', destinationPoint(medanta, 90, 2_000))];

    expect(mergePlaceMatches(photon, routed).map((match) => match.name)).toEqual(['Medanta Lucknow Hospital', 'Lulu Mall']);
  });

  it('keeps two places that share a name but are far apart', () => {
    const one = place('City Hospital', LUCKNOW);
    const other = place('City Hospital', destinationPoint(LUCKNOW, 90, 5_000));
    expect(mergePlaceMatches([one], [other])).toHaveLength(2);
  });
});
