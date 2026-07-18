import type {
  MatchablePlannedSession,
  MatchableRun,
  SessionMatchResult,
} from "./session-matching";

export type ConfidenceLevel =
  | "low"
  | "building"
  | "moderate"
  | "high"
  | "very-high";

export type ConfidencePillarKey =
  | "consistency"
  | "volume"
  | "long-runs"
  | "specificity"
  | "fitness"
  | "durability";

export type ConfidencePillar = {
  key: ConfidencePillarKey;
  label: string;
  score: number;
  weight: number;
  weightedScore: number;
  status: "strong" | "positive" | "developing" | "risk";
  headline: string;
  detail: string;
};

export type Sub3ConfidenceResult = {
  score: number;
  level: ConfidenceLevel;
  label: string;
  summary: string;

  pillars: ConfidencePillar[];

  strongestPillar: ConfidencePillar;
  weakestPillar: ConfidencePillar;

  biggestStrength: string;
  biggestRisk: string;
  nextMilestone: string;

  supportingEvidence: string[];
  risks: string[];
};

export type ConfidenceGoalProfile = {
  id: string;
  label: string;
  targetSeconds: number;

  targetWeeklyDistanceKm: number;
  minimumWeeklyDistanceKm: number;

  targetLongRunKm: number;
  minimumLongRunKm: number;

  consistencyWindowDays: number;
  volumeWindowDays: number;
  longRunWindowDays: number;

  targetRunsPerWeek: number;

  weights: Record<ConfidencePillarKey, number>;
};

export type ConfidenceEngineInput = {
  runs: MatchableRun[];
  plannedSessions?: MatchablePlannedSession[];
  sessionMatches?: SessionMatchResult[];

  predictedMarathonSeconds?: number | null;

  raceDate?: string | null;
  today?: string;

  goal?: ConfidenceGoalProfile;
};

const MS_PER_DAY = 86_400_000;

export const SUB3_GOAL_PROFILE: ConfidenceGoalProfile = {
  id: "sub-3-marathon",
  label: "Sub-3 Marathon",
  targetSeconds: 2 * 3600 + 59 * 60 + 59,

  targetWeeklyDistanceKm: 80,
  minimumWeeklyDistanceKm: 55,

  targetLongRunKm: 32,
  minimumLongRunKm: 24,

  consistencyWindowDays: 42,
  volumeWindowDays: 28,
  longRunWindowDays: 56,

  targetRunsPerWeek: 5,

  weights: {
    consistency: 0.25,
    volume: 0.2,
    "long-runs": 0.2,
    specificity: 0.15,
    fitness: 0.15,
    durability: 0.05,
  },
};

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimalPlaces = 0) {
  const multiplier = 10 ** decimalPlaces;
  return Math.round(value * multiplier) / multiplier;
}

function getTodayDateKey() {
  const today = new Date();

  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseDate(dateValue: string) {
  const dateKey = dateValue.slice(0, 10);
  const parsed = new Date(`${dateKey}T12:00:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDaysBetween(firstDate: string, secondDate: string) {
  const first = parseDate(firstDate);
  const second = parseDate(secondDate);

  if (!first || !second) {
    return null;
  }

  return Math.round(
    Math.abs(first.getTime() - second.getTime()) / MS_PER_DAY
  );
}

function isDateWithinPastDays(
  dateValue: string,
  today: string,
  days: number
) {
  const difference = getDaysBetween(dateValue, today);

  if (difference === null) {
    return false;
  }

  return dateValue.slice(0, 10) <= today && difference < days;
}

function parseTimeToSeconds(value: string) {
  if (!value) {
    return null;
  }

  const parts = value
    .trim()
    .split(":")
    .map((part) => Number(part));

 
