/**
 * Explainable driver scoring.
 *
 * Rules:
 *  - every score change originates from a typed event with a human reason;
 *  - category weights and event effects are configuration, never hard-coded
 *    in the UI;
 *  - the overall score is a deterministic function of the category scores.
 */

import { ScoreCategory, ScoreEventType } from './enums';

export interface ScoringWeights {
  SAFETY: number;
  RELIABILITY: number;
  TIMELINESS: number;
  COMPLIANCE: number;
  VEHICLE_CARE: number;
}

export interface ScoreEventRule {
  category: ScoreCategory;
  /** Points applied to the category score (positive or negative). */
  points: number;
  /** Default human-readable explanation; callers may refine it. */
  reason: string;
}

export interface ScoringConfig {
  /** Score a brand-new driver starts on, per category. */
  baselineScore: number;
  minScore: number;
  maxScore: number;
  weights: ScoringWeights;
  rules: Record<ScoreEventType, ScoreEventRule>;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  baselineScore: 75,
  minScore: 0,
  maxScore: 100,
  weights: {
    SAFETY: 0.3,
    RELIABILITY: 0.2,
    TIMELINESS: 0.2,
    COMPLIANCE: 0.15,
    VEHICLE_CARE: 0.15,
  },
  rules: {
    [ScoreEventType.TRIP_COMPLETED_ON_TIME]: {
      category: ScoreCategory.TIMELINESS,
      points: 3,
      reason: 'Delivered the trip on or before the expected arrival time.',
    },
    [ScoreEventType.TRIP_COMPLETED_LATE]: {
      category: ScoreCategory.TIMELINESS,
      points: -4,
      reason: 'Trip arrived after the expected arrival time.',
    },
    [ScoreEventType.TRIP_CANCELLED_BY_DRIVER]: {
      category: ScoreCategory.RELIABILITY,
      points: -8,
      reason: 'Trip was cancelled after the driver had accepted it.',
    },
    [ScoreEventType.SPEED_VIOLATION]: {
      category: ScoreCategory.SAFETY,
      points: -5,
      reason: 'Recorded speed exceeded the configured safe limit.',
    },
    [ScoreEventType.HARSH_BRAKING]: {
      category: ScoreCategory.SAFETY,
      points: -2,
      reason: 'Harsh braking detected during the trip.',
    },
    [ScoreEventType.HARSH_ACCELERATION]: {
      category: ScoreCategory.SAFETY,
      points: -2,
      reason: 'Harsh acceleration detected during the trip.',
    },
    [ScoreEventType.ROUTE_DEVIATION]: {
      category: ScoreCategory.RELIABILITY,
      points: -3,
      reason: 'Vehicle left the planned route beyond the allowed corridor.',
    },
    [ScoreEventType.DOCUMENT_EXPIRED]: {
      category: ScoreCategory.COMPLIANCE,
      points: -10,
      reason: 'A mandatory document was allowed to expire.',
    },
    [ScoreEventType.DOCUMENT_RENEWED]: {
      category: ScoreCategory.COMPLIANCE,
      points: 5,
      reason: 'A mandatory document was renewed and verified.',
    },
    [ScoreEventType.CUSTOMER_POSITIVE_RATING]: {
      category: ScoreCategory.RELIABILITY,
      points: 4,
      reason: 'Customer rated the delivery positively.',
    },
    [ScoreEventType.CUSTOMER_NEGATIVE_RATING]: {
      category: ScoreCategory.RELIABILITY,
      points: -6,
      reason: 'Customer rated the delivery negatively.',
    },
    [ScoreEventType.INCIDENT]: {
      category: ScoreCategory.SAFETY,
      points: -15,
      reason: 'A safety incident was recorded against this driver.',
    },
    [ScoreEventType.MAINTENANCE_REPORTED]: {
      category: ScoreCategory.VEHICLE_CARE,
      points: 3,
      reason: 'Driver proactively reported a vehicle issue.',
    },
    [ScoreEventType.MAINTENANCE_NEGLECTED]: {
      category: ScoreCategory.VEHICLE_CARE,
      points: -7,
      reason: 'Scheduled maintenance was overdue while the truck kept operating.',
    },
    [ScoreEventType.SOS_ASSISTANCE_PROVIDED]: {
      category: ScoreCategory.SAFETY,
      points: 6,
      reason: 'Driver responded to another Saarthi driver in an emergency.',
    },
    // Raised from connected-hardware telemetry rather than phone GPS. The
    // penalty is deliberately smaller than a speed violation: idling wastes
    // fuel and is worth flagging, but it endangers nobody.
    [ScoreEventType.EXCESSIVE_IDLING]: {
      category: ScoreCategory.VEHICLE_CARE,
      points: -2,
      reason: 'Left the engine idling for longer than the fleet allows.',
    },
    [ScoreEventType.TELEMETRY_SAFE_DRIVING]: {
      category: ScoreCategory.SAFETY,
      points: 2,
      reason: 'Completed a monitored trip with no harsh braking, acceleration or overspeed.',
    },
    [ScoreEventType.MANUAL_ADJUSTMENT]: {
      category: ScoreCategory.RELIABILITY,
      points: 0,
      reason: 'Manual adjustment by an authorised fleet administrator.',
    },
  },
};

export type CategoryScores = Record<ScoreCategory, number>;

export function baselineCategoryScores(
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): CategoryScores {
  return {
    [ScoreCategory.SAFETY]: config.baselineScore,
    [ScoreCategory.RELIABILITY]: config.baselineScore,
    [ScoreCategory.TIMELINESS]: config.baselineScore,
    [ScoreCategory.COMPLIANCE]: config.baselineScore,
    [ScoreCategory.VEHICLE_CARE]: config.baselineScore,
  };
}

export function clampScore(value: number, config: ScoringConfig = DEFAULT_SCORING_CONFIG): number {
  return Math.max(config.minScore, Math.min(config.maxScore, value));
}

export function ruleFor(
  eventType: ScoreEventType,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): ScoreEventRule {
  const rule = config.rules[eventType];
  if (!rule) {
    throw new Error(`No scoring rule configured for event type "${eventType}"`);
  }
  return rule;
}

export interface AppliedScoreEvent {
  category: ScoreCategory;
  points: number;
  reason: string;
}

/**
 * Recompute category scores from the baseline plus an ordered event list.
 * Deterministic: the same events always yield the same scores.
 */
export function computeCategoryScores(
  events: readonly AppliedScoreEvent[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): CategoryScores {
  const scores = baselineCategoryScores(config);
  for (const event of events) {
    const current = scores[event.category] ?? config.baselineScore;
    scores[event.category] = clampScore(current + event.points, config);
  }
  return scores;
}

export function computeOverallScore(
  scores: CategoryScores,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): number {
  const weighted =
    scores[ScoreCategory.SAFETY] * config.weights.SAFETY +
    scores[ScoreCategory.RELIABILITY] * config.weights.RELIABILITY +
    scores[ScoreCategory.TIMELINESS] * config.weights.TIMELINESS +
    scores[ScoreCategory.COMPLIANCE] * config.weights.COMPLIANCE +
    scores[ScoreCategory.VEHICLE_CARE] * config.weights.VEHICLE_CARE;
  return Math.round(clampScore(weighted, config));
}

export interface ScoreBreakdown {
  overall: number;
  categories: CategoryScores;
  strengths: ScoreCategory[];
  weaknesses: ScoreCategory[];
  recommendations: string[];
}

const IMPROVEMENT_ADVICE: Record<ScoreCategory, string> = {
  [ScoreCategory.SAFETY]:
    'Reduce speed violations and harsh braking events — keep within posted limits and brake early.',
  [ScoreCategory.RELIABILITY]:
    'Avoid cancelling accepted trips and stay on the planned route to improve reliability.',
  [ScoreCategory.TIMELINESS]:
    'Plan departures with buffer time and report delays early to improve on-time performance.',
  [ScoreCategory.COMPLIANCE]:
    'Renew licence and vehicle documents before they expire to protect the compliance score.',
  [ScoreCategory.VEHICLE_CARE]:
    'Report vehicle issues promptly and keep scheduled maintenance up to date.',
};

const STRENGTH_THRESHOLD = 85;
const WEAKNESS_THRESHOLD = 70;

export function buildScoreBreakdown(
  categories: CategoryScores,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): ScoreBreakdown {
  const entries = Object.entries(categories) as [ScoreCategory, number][];
  const strengths = entries
    .filter(([, value]) => value >= STRENGTH_THRESHOLD)
    .map(([category]) => category);
  const weaknesses = entries
    .filter(([, value]) => value < WEAKNESS_THRESHOLD)
    .sort((a, b) => a[1] - b[1])
    .map(([category]) => category);

  return {
    overall: computeOverallScore(categories, config),
    categories,
    strengths,
    weaknesses,
    recommendations: weaknesses.map((category) => IMPROVEMENT_ADVICE[category]),
  };
}

/** Presentation band for a score — used consistently across UI surfaces. */
export type ScoreBand = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'AT_RISK';

export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return 'EXCELLENT';
  if (score >= 75) return 'GOOD';
  if (score >= 60) return 'FAIR';
  return 'AT_RISK';
}

// ---------------------------------------------------------------------------
// Safety thresholds used by the tracking pipeline to raise scoring events
// ---------------------------------------------------------------------------

export interface SafetyThresholds {
  /** km/h above which a speed violation event is raised. */
  speedLimitKph: number;
  /** Sustained km/h delta (drop) between samples that counts as harsh braking. */
  harshBrakingDeltaKph: number;
  /** Sustained km/h delta (gain) between samples that counts as harsh acceleration. */
  harshAccelerationDeltaKph: number;
  /** Metres from the planned route before a deviation is raised. */
  routeDeviationMeters: number;
  /** Minutes past the expected arrival before a trip is flagged delayed. */
  delayToleranceMinutes: number;
}

export const DEFAULT_SAFETY_THRESHOLDS: SafetyThresholds = {
  speedLimitKph: 80,
  harshBrakingDeltaKph: 25,
  harshAccelerationDeltaKph: 25,
  routeDeviationMeters: 750,
  delayToleranceMinutes: 20,
};
