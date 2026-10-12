import { describe, expect, it } from 'vitest';
import { destinationPoint } from './geo';
import { STOP_DWELL_MS, nextStopVisit, type StopFix, type StopVisit } from './stop-visit';

const gate = { latitude: 26.4499, longitude: 80.3319 };
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 11, 10, 0) + minutes * 60_000);
const metresNorth = (metres: number) => destinationPoint(gate, 0, metres);

function stop(overrides: Partial<StopVisit> = {}): StopVisit {
  return { ...gate, reachingSince: null, reachedAt: null, leftAt: null, ...overrides };
}

function fix(metres: number, speedKph: number, minutes: number): StopFix {
  return { position: metresNorth(metres), speedKph, at: at(minutes) };
}

describe('stop visit from GPS', () => {
  it('starts waiting when the vehicle slows to a stop inside the radius', () => {
    expect(nextStopVisit(stop(), fix(120, 2, 0))).toEqual({ kind: 'REACHING', reachingSince: at(0) });
  });

  it('does not start waiting for a vehicle driving through', () => {
    expect(nextStopVisit(stop(), fix(50, 40, 0))).toEqual({ kind: 'NONE' });
  });

  it('counts a stop reached once the vehicle stays, timed from when it first stopped', () => {
    const waiting = stop({ reachingSince: at(0) });
    expect(nextStopVisit(waiting, fix(60, 0, 1))).toEqual({ kind: 'NONE' });
    expect(nextStopVisit(waiting, fix(60, 0, STOP_DWELL_MS / 60_000))).toEqual({
      kind: 'REACHED',
      reachedAt: at(0),
    });
  });

  it('keeps waiting while the vehicle moves about inside the yard', () => {
    expect(nextStopVisit(stop({ reachingSince: at(0) }), fix(150, 12, 1))).toEqual({ kind: 'NONE' });
  });

  it('drops the wait when the vehicle leaves before it is over', () => {
    expect(nextStopVisit(stop({ reachingSince: at(0) }), fix(400, 30, 1))).toEqual({
      kind: 'NOT_REACHING',
    });
  });

  it('records leaving at the first position back outside, with the time spent there', () => {
    expect(nextStopVisit(stop({ reachedAt: at(0) }), fix(300, 20, 48))).toEqual({
      kind: 'LEFT',
      leftAt: at(48),
      minutesAtStop: 48,
    });
  });

  it('does not read GPS wander at the gate as leaving', () => {
    expect(nextStopVisit(stop({ reachedAt: at(0) }), fix(230, 0, 5))).toEqual({ kind: 'NONE' });
  });

  it('ignores a late-arriving position older than the step it would decide', () => {
    expect(nextStopVisit(stop({ reachedAt: at(10) }), fix(400, 30, 5))).toEqual({ kind: 'NONE' });
    expect(nextStopVisit(stop({ reachingSince: at(10) }), fix(400, 30, 5))).toEqual({ kind: 'NONE' });
  });

  it('is finished with a stop once the vehicle has left it', () => {
    expect(
      nextStopVisit(stop({ reachedAt: at(0), leftAt: at(30) }), fix(10, 0, 60)),
    ).toEqual({ kind: 'NONE' });
  });
});
