import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OsrmRoutingProvider } from '../src/providers/routing/osrm-routing.provider';

describe('OsrmRoutingProvider routePath', () => {
  let provider: OsrmRoutingProvider;

  beforeEach(() => {
    provider = new OsrmRoutingProvider('https://router.project-osrm.org');
  });

  it('returns original points if fewer than 2 waypoints are passed', async () => {
    const single = [{ latitude: 26.4815, longitude: 80.29 }];
    const res = await provider.routePath(single);
    expect(res).toEqual(single);
  });

  it('Tier 1: uses OSRM map matching to return dense street centerline coordinates', async () => {
    const mockMatchResponse = {
      code: 'Ok',
      matchings: [
        {
          confidence: 0.95,
          geometry: {
            coordinates: [
              [80.29, 26.4815],
              [80.285, 26.4817], // intermediate curve vertex
              [80.28, 26.482],  // intermediate curve vertex
              [80.2661, 26.4815],
            ],
          },
        },
      ],
    };

    // Stub internal get method
    vi.spyOn(provider as any, 'get').mockResolvedValueOnce(mockMatchResponse);

    const waypoints = [
      { latitude: 26.4815, longitude: 80.29 },
      { latitude: 26.4815, longitude: 80.2661 },
    ];

    const result = await provider.routePath(waypoints);
    expect(result.length).toBe(4);
    expect(result[0]).toEqual({ latitude: 26.4815, longitude: 80.29 });
    expect(result[1]).toEqual({ latitude: 26.4817, longitude: 80.285 });
    expect(result[2]).toEqual({ latitude: 26.482, longitude: 80.28 });
    expect(result[3]).toEqual({ latitude: 26.4815, longitude: 80.2661 });
  });

  it('Tier 2: falls back to sequential leg-by-leg routing if map matching returns NoMatch', async () => {
    const p1 = { latitude: 26.4815, longitude: 80.29 };
    const p2 = { latitude: 26.4815, longitude: 80.27 };

    vi.spyOn(provider as any, 'get').mockImplementation(async (path: any) => {
      if (path.startsWith('/match')) {
        return { code: 'NoMatch', matchings: [] };
      }
      if (path.startsWith('/nearest')) {
        const coords = path.split('/')[4]?.split('?')[0];
        const [lng, lat] = coords ? coords.split(',').map(Number) : [80.29, 26.4815];
        return {
          code: 'Ok',
          waypoints: [{ location: [lng, lat] }],
        };
      }
      if (path.startsWith('/route')) {
        return {
          code: 'Ok',
          routes: [
            {
              geometry: {
                coordinates: [
                  [80.29, 26.4815],
                  [80.28, 26.4816], // curve
                  [80.27, 26.4815],
                ],
              },
            },
          ],
        };
      }
      return { code: 'Error' };
    });

    const result = await provider.routePath([p1, p2]);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0]).toEqual({ latitude: 26.4815, longitude: 80.29 });
    expect(result[1]).toEqual({ latitude: 26.4816, longitude: 80.28 });
    expect(result[2]).toEqual({ latitude: 26.4815, longitude: 80.27 });
  });

  it('Tier 3: falls back to snapped sequential waypoints if all routing queries fail', async () => {
    const p1 = { latitude: 26.4815, longitude: 80.29 };
    const p2 = { latitude: 26.4815, longitude: 80.27 };

    vi.spyOn(provider as any, 'get').mockImplementation(async (path: any) => {
      if (path.startsWith('/nearest')) {
        return {
          code: 'Ok',
          waypoints: [{ location: [80.2899, 26.4815] }],
        };
      }
      throw new Error('Network timeout');
    });

    const result = await provider.routePath([p1, p2]);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
