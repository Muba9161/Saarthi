/**
 * Driver achievement rules.
 *
 * Achievements are evaluated from aggregated operational facts, never from UI
 * state. Adding a badge means adding a definition here plus (optionally) a new
 * metric in the aggregation query — no component changes required.
 */

import { AchievementCode } from './enums';

export interface DriverAchievementMetrics {
  totalTrips: number;
  onTimeTrips: number;
  completedTrips: number;
  incidentCount: number;
  /** Consecutive completed trips without a safety incident. */
  incidentFreeStreak: number;
  safetyScore: number;
  timelinessScore: number;
  complianceScore: number;
  vehicleCareScore: number;
  averageCustomerRating: number | null;
  customerRatingCount: number;
  sosAssistsCompleted: number;
  expiredMandatoryDocuments: number;
  totalDistanceKm: number;
  /** Litres per 100 km — lower is better. `null` when no fuel data exists. */
  fuelEfficiencyL100Km: number | null;
}

export interface AchievementDefinition {
  code: AchievementCode;
  name: string;
  description: string;
  /** Short explanation of how to earn it, shown to drivers. */
  criteria: string;
  tier: 'BRONZE' | 'SILVER' | 'GOLD';
  isEarned: (metrics: DriverAchievementMetrics) => boolean;
  /** 0–1 progress towards earning it, for the driver profile UI. */
  progress: (metrics: DriverAchievementMetrics) => number;
}

const ratio = (value: number, target: number): number =>
  target <= 0 ? 0 : Math.max(0, Math.min(1, value / target));

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    code: AchievementCode.FIRST_TRIP,
    name: 'First Trip',
    description: 'Completed the first Saarthi trip.',
    criteria: 'Complete 1 trip.',
    tier: 'BRONZE',
    isEarned: (m) => m.completedTrips >= 1,
    progress: (m) => ratio(m.completedTrips, 1),
  },
  {
    code: AchievementCode.SAFE_DRIVER,
    name: 'Safe Driver',
    description: 'Maintains a consistently high safety score.',
    criteria: 'Safety score of 90+ across at least 10 completed trips.',
    tier: 'GOLD',
    isEarned: (m) => m.safetyScore >= 90 && m.completedTrips >= 10,
    progress: (m) => Math.min(ratio(m.safetyScore, 90), ratio(m.completedTrips, 10)),
  },
  {
    code: AchievementCode.ON_TIME_CHAMPION,
    name: 'On-Time Champion',
    description: 'Delivers reliably within the promised window.',
    criteria: '90% on-time deliveries across at least 20 trips.',
    tier: 'GOLD',
    isEarned: (m) => m.completedTrips >= 20 && m.onTimeTrips / Math.max(1, m.completedTrips) >= 0.9,
    progress: (m) =>
      Math.min(ratio(m.completedTrips, 20), ratio(m.onTimeTrips / Math.max(1, m.completedTrips), 0.9)),
  },
  {
    code: AchievementCode.CENTURY_TRIPS,
    name: '100 Trips',
    description: 'Completed one hundred Saarthi trips.',
    criteria: 'Complete 100 trips.',
    tier: 'GOLD',
    isEarned: (m) => m.completedTrips >= 100,
    progress: (m) => ratio(m.completedTrips, 100),
  },
  {
    code: AchievementCode.ZERO_INCIDENT_STREAK,
    name: 'Zero Incident Streak',
    description: 'A long run of trips without a single safety incident.',
    criteria: '25 consecutive completed trips with no incident.',
    tier: 'SILVER',
    isEarned: (m) => m.incidentFreeStreak >= 25,
    progress: (m) => ratio(m.incidentFreeStreak, 25),
  },
  {
    code: AchievementCode.DOCUMENT_PERFECT,
    name: 'Document Perfect',
    description: 'Every mandatory document valid and verified.',
    criteria: 'Compliance score of 95+ with no expired mandatory documents.',
    tier: 'SILVER',
    isEarned: (m) => m.complianceScore >= 95 && m.expiredMandatoryDocuments === 0,
    progress: (m) => (m.expiredMandatoryDocuments > 0 ? 0 : ratio(m.complianceScore, 95)),
  },
  {
    code: AchievementCode.FUEL_EFFICIENT,
    name: 'Fuel Efficient',
    description: 'Operates the vehicle economically.',
    criteria: 'Average consumption at or below 30 L/100 km over 10+ trips.',
    tier: 'SILVER',
    isEarned: (m) =>
      m.fuelEfficiencyL100Km !== null && m.fuelEfficiencyL100Km <= 30 && m.completedTrips >= 10,
    progress: (m) =>
      m.fuelEfficiencyL100Km === null
        ? 0
        : Math.min(ratio(30, Math.max(1, m.fuelEfficiencyL100Km)), ratio(m.completedTrips, 10)),
  },
  {
    code: AchievementCode.CUSTOMER_FAVOURITE,
    name: 'Customer Favourite',
    description: 'Consistently rated highly by customers.',
    criteria: 'Average customer rating of 4.5+ from at least 10 ratings.',
    tier: 'GOLD',
    isEarned: (m) => (m.averageCustomerRating ?? 0) >= 4.5 && m.customerRatingCount >= 10,
    progress: (m) =>
      Math.min(ratio(m.averageCustomerRating ?? 0, 4.5), ratio(m.customerRatingCount, 10)),
  },
  {
    code: AchievementCode.EMERGENCY_HELPER,
    name: 'Emergency Helper',
    description: 'Answered the call when another driver needed help.',
    criteria: 'Complete assistance for 3 SOS incidents.',
    tier: 'GOLD',
    isEarned: (m) => m.sosAssistsCompleted >= 3,
    progress: (m) => ratio(m.sosAssistsCompleted, 3),
  },
  {
    code: AchievementCode.LONG_HAULER,
    name: 'Long Hauler',
    description: 'Covered serious distance on Saarthi.',
    criteria: 'Drive 10,000 km in total.',
    tier: 'SILVER',
    isEarned: (m) => m.totalDistanceKm >= 10_000,
    progress: (m) => ratio(m.totalDistanceKm, 10_000),
  },
];

export function achievementDefinition(code: AchievementCode): AchievementDefinition | undefined {
  return ACHIEVEMENT_DEFINITIONS.find((definition) => definition.code === code);
}

export interface AchievementEvaluation {
  code: AchievementCode;
  earned: boolean;
  progress: number;
}

export function evaluateAchievements(
  metrics: DriverAchievementMetrics,
): AchievementEvaluation[] {
  return ACHIEVEMENT_DEFINITIONS.map((definition) => ({
    code: definition.code,
    earned: definition.isEarned(metrics),
    progress: Math.max(0, Math.min(1, definition.progress(metrics))),
  }));
}

export function emptyAchievementMetrics(): DriverAchievementMetrics {
  return {
    totalTrips: 0,
    onTimeTrips: 0,
    completedTrips: 0,
    incidentCount: 0,
    incidentFreeStreak: 0,
    safetyScore: 0,
    timelinessScore: 0,
    complianceScore: 0,
    vehicleCareScore: 0,
    averageCustomerRating: null,
    customerRatingCount: 0,
    sosAssistsCompleted: 0,
    expiredMandatoryDocuments: 0,
    totalDistanceKm: 0,
    fuelEfficiencyL100Km: null,
  };
}
