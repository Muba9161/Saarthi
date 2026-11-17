/**
 * Share my ride — riding along in a vehicle that is not on Saarthi.
 *
 * Nobody owns that vehicle here, so nobody is asked: the rider chooses who
 * sees them. Saarthi users they name by mobile number or email are told and can follow
 * them; anyone else follows the live link the rider sends on WhatsApp. The
 * typed vehicle number travels with it as a safety detail. Sharing stops when
 * the rider stops it, or by itself after a while if they forget.
 */

import type { RideShareStatus } from './enums';
import type { TrailPoint } from './route-trail';

/** Fixes in one upload from the rider's phone. */
export const MAX_RIDE_POINTS = 100;

/** Where the rider's phone was, as the live map shows it. */
export interface RideVehicleLocation {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
}

/**
 * A point on the road the rider has covered, coloured as any vehicle's trail
 * is. A ride has no trip, so its `routeState` is always `NO_TRIP`.
 */
export interface RideTrailPoint extends TrailPoint {
  recordedAt: string;
}

/** Sharing stops by itself after this long — a forgotten share is not a tracker. */
export const RIDE_SHARE_HOURS = 12;

/** People a rider can name on one share. */
export const MAX_RIDE_SHARE_CONTACTS = 5;

/** The rider's own view of their share, in Humsafar. */
export interface RideShareView {
  id: string;
  status: RideShareStatus;
  registrationNumber: string | null;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  /** The live link to send to family; it stops showing anything once the share ends. */
  link: string;
  /** The people named who use Saarthi, by the mobile number or email address the rider gave, as stored. */
  contacts: string[];
  /** Whether it also shows on the rider's own owner account in the owner app. */
  sharedWithSelf: boolean;
  /** The key the phone reports with (`X-Ride-Token` on `POST /ride-shares/:id/report`), while sharing. */
  reportingToken: string | null;
  /** Where the rider's phone last was. */
  lastLocation: RideVehicleLocation | null;
}

/** A ride somebody is sharing with me, live — for "Shared with me" and the Home card. */
export interface RideSharedWithMe {
  id: string;
  /** The live link's token, for opening the same live view in the app (`/public/live/:token`). */
  token: string;
  riderName: string;
  registrationNumber: string | null;
  startedAt: string;
  expiresAt: string;
  position: RideVehicleLocation | null;
  /** The viewer's own ride, shared from Humsafar onto their owner account. */
  mine: boolean;
}

/** Whether this account may ride along, and whether its login also holds an owner account to show the ride on. */
export interface RideShareAccess {
  rideAlong: boolean;
  hasOwnerAccount: boolean;
}

/** How long an ended ride's summary is shown to family before it is removed too. */
export const RIDE_SUMMARY_MINUTES = 5;

/**
 * What an ended share came to, shown for [RIDE_SUMMARY_MINUTES] and then
 * removed. It holds no position: the road covered is deleted when the share
 * ends, and these figures go a few minutes later.
 */
export interface RideShareSummary {
  /** Kilometres covered while sharing, along the phone's own fixes. */
  distanceKm: number;
  durationMinutes: number;
  /** Distance over duration; null for a share that lasted no time. */
  avgSpeedKph: number | null;
  /** The fastest speed the phone reported; null when it reported none — never estimated. */
  maxSpeedKph: number | null;
  startedAt: string;
  endedAt: string;
  /** When the summary is removed; not shown after it. */
  shownUntil: string;
}

/**
 * What the live link's socket (`/ws/live`) sends: the whole ride on connecting,
 * then each move — the new position and only the road covered since the last
 * one — and, once, that it has ended.
 */
export type RideShareLiveMessage =
  | { type: 'RIDE_SHARE_SNAPSHOT'; ride: PublicLiveRide }
  | { type: 'RIDE_SHARE_UPDATE'; position: RideVehicleLocation | null; trail: RideTrailPoint[] }
  | { type: 'RIDE_SHARE_ENDED'; endedAt: string; summary: RideShareSummary | null };

/** What the live link shows — a first name, the vehicle's number, and where they are while sharing. */
export interface PublicLiveRide {
  riderName: string;
  registrationNumber: string | null;
  status: RideShareStatus;
  startedAt: string;
  endedAt: string | null;
  /** Null once the share has ended: an ended link shows nobody's whereabouts. */
  position: RideVehicleLocation | null;
  /**
   * The road covered since sharing began — or, asked `from` a time, only
   * what was covered after it — thinned on long rides. Empty once ended.
   */
  trail: RideTrailPoint[];
  /** What the ride came to, once it has ended; null while sharing. */
  summary: RideShareSummary | null;
}
