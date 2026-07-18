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

  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !Number.isFinite(part))
  ) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function getRunDistanceKm(run: MatchableRun) {
  if (
    typeof run.distanceMeters === "number" &&
    Number.isFinite(run.distanceMeters) &&
    run.distanceMeters > 0
  ) {
    return run.distanceMeters / 1000;
  }

  const parsedDistance = Number.parseFloat(run.distance ?? "");

  return Number.isFinite(parsedDistance) && parsedDistance > 0
    ? parsedDistance
    : 0;
}

function getRunTimeSeconds(run: MatchableRun) {
  if (
    typeof run.movingTimeSeconds === "number" &&
    Number.isFinite(run.movingTimeSeconds) &&
    run.movingTimeSeconds > 0
  ) {
    return run.movingTimeSeconds;
  }

  return parseTimeToSeconds(run.time) ?? 0;
}

function getRunPaceSecondsPerKm(run: MatchableRun) {
  if (
    typeof run.paceSecondsPerKm === "number" &&
    Number.isFinite(run.paceSecondsPerKm) &&
    run.paceSecondsPerKm > 0
  ) {
    return run.paceSecondsPerKm;
  }

  const distanceKm = getRunDistanceKm(run);
  const timeSeconds = getRunTimeSeconds(run);

  if (distanceKm <= 0 || timeSeconds <= 0) {
    return null;
  }

  return timeSeconds / distanceKm;
}

function normaliseText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function getRunText(run: MatchableRun) {
  return normaliseText(
    [run.runType, run.name, run.notes].filter(Boolean).join(" ")
  );
}

function isQualityRun(run: MatchableRun) {
  const text = getRunText(run);

  return [
    "interval",
    "reps",
    "repetition",
    "threshold",
    "tempo",
    "marathon pace",
    "race pace",
    "progressive",
    "progression",
    "track",
  ].some((keyword) => text.includes(keyword));
}

function isMarathonSpecificRun(run: MatchableRun) {
  const text = getRunText(run);

  return (
    text.includes("marathon pace") ||
    text.includes("race pace") ||
    /\bmp\b/.test(text)
  );
}

function isEasyOrRecoveryRun(run: MatchableRun) {
  const text = getRunText(run);

  return (
    text.includes("easy") ||
    text.includes("recovery") ||
    text.includes("aerobic")
  );
}

function groupRunsByWeek(
  runs: MatchableRun[],
  today: string,
  windowDays: number
) {
  const validRuns = runs.filter((run) =>
    isDateWithinPastDays(run.date, today, windowDays)
  );

  const todayDate = parseDate(today);

  if (!todayDate) {
    return [];
  }

  const weekCount = Math.max(1, Math.ceil(windowDays / 7));

  return Array.from({ length: weekCount }, (_, weekIndex) => {
    const startDaysAgo = weekIndex * 7;
    const endDaysAgo = startDaysAgo + 6;

    const weekRuns = validRuns.filter((run) => {
      const difference = getDaysBetween(run.date, today);

      return (
        difference !== null &&
        difference >= startDaysAgo &&
        difference <= endDaysAgo
      );
    });

    return {
      weekIndex,
      runs: weekRuns,
      distanceKm: weekRuns.reduce(
        (sum, run) => sum + getRunDistanceKm(run),
        0
      ),
    };
  });
}

function getPillarStatus(score: number): ConfidencePillar["status"] {
  if (score >= 85) {
    return "strong";
  }

  if (score >= 70) {
    return "positive";
  }

  if (score >= 50) {
    return "developing";
  }

  return "risk";
}

function createPillar(
  key: ConfidencePillarKey,
  label: string,
  score: number,
  weight: number,
  headline: string,
  detail: string
): ConfidencePillar {
  const roundedScore = Math.round(clamp(score));

  return {
    key,
    label,
    score: roundedScore,
    weight,
    weightedScore: round(roundedScore * weight, 2),
    status: getPillarStatus(roundedScore),
    headline,
    detail,
  };
}

function scoreConsistency(
  runs: MatchableRun[],
  today: string,
  goal: ConfidenceGoalProfile
) {
  const weeks = groupRunsByWeek(
    runs,
    today,
    goal.consistencyWindowDays
  );

  const expectedRuns =
    weeks.length * goal.targetRunsPerWeek;

  const completedRuns = weeks.reduce(
    (sum, week) => sum + week.runs.length,
    0
  );

  const runCompletionScore =
    expectedRuns > 0
      ? clamp((completedRuns / expectedRuns) * 100)
      : 0;

  const activeWeeks = weeks.filter(
    (week) => week.runs.length >= Math.max(3, goal.targetRunsPerWeek - 1)
  ).length;

  const activeWeekScore =
    weeks.length > 0
      ? (activeWeeks / weeks.length) * 100
      : 0;

  const score = runCompletionScore * 0.65 + activeWeekScore * 0.35;

  return createPillar(
    "consistency",
    "Consistency",
    score,
    goal.weights.consistency,
    completedRuns >= expectedRuns * 0.9
      ? "Training frequency is consistent"
      : "Training frequency can improve",
    `${completedRuns} runs completed across the last ${weeks.length} weeks, against an indicative target of ${expectedRuns}.`
  );
}

function scoreVolume(
  runs: MatchableRun[],
  today: string,
  goal: ConfidenceGoalProfile
) {
  const weeks = groupRunsByWeek(
    runs,
    today,
    goal.volumeWindowDays
  );

  const averageWeeklyDistance =
    weeks.length > 0
      ? weeks.reduce(
          (sum, week) => sum + week.distanceKm,
          0
        ) / weeks.length
      : 0;

  let score: number;

  if (averageWeeklyDistance >= goal.targetWeeklyDistanceKm) {
    score = 100;
  } else if (
    averageWeeklyDistance >= goal.minimumWeeklyDistanceKm
  ) {
    const range =
      goal.targetWeeklyDistanceKm -
      goal.minimumWeeklyDistanceKm;

    score =
      65 +
      ((averageWeeklyDistance -
        goal.minimumWeeklyDistanceKm) /
        Math.max(range, 1)) *
        35;
  } else {
    score =
      (averageWeeklyDistance /
        goal.minimumWeeklyDistanceKm) *
      65;
  }

  return createPillar(
    "volume",
    "Training volume",
    score,
    goal.weights.volume,
    averageWeeklyDistance >= goal.minimumWeeklyDistanceKm
      ? "Aerobic volume supports the goal"
      : "Weekly volume is below the desired range",
    `Average weekly distance over the last ${weeks.length} weeks is ${round(
      averageWeeklyDistance,
      1
    )} km.`
  );
}

function scoreLongRuns(
  runs: MatchableRun[],
  today: string,
  goal: ConfidenceGoalProfile
) {
  const recentRuns = runs
    .filter((run) =>
      isDateWithinPastDays(
        run.date,
        today,
        goal.longRunWindowDays
      )
    )
    .map((run) => ({
      run,
      distanceKm: getRunDistanceKm(run),
    }))
    .filter(({ distanceKm }) => distanceKm >= 16)
    .sort((first, second) => second.distanceKm - first.distanceKm);

  const longestRunKm = recentRuns[0]?.distanceKm ?? 0;

  const meaningfulLongRuns = recentRuns.filter(
    ({ distanceKm }) =>
      distanceKm >= goal.minimumLongRunKm
  ).length;

  const distanceScore =
    longestRunKm >= goal.targetLongRunKm
      ? 100
      : longestRunKm >= goal.minimumLongRunKm
      ? 70 +
        ((longestRunKm - goal.minimumLongRunKm) /
          Math.max(
            goal.targetLongRunKm - goal.minimumLongRunKm,
            1
          )) *
          30
      : (longestRunKm / goal.minimumLongRunKm) * 70;

  const frequencyScore = clamp(
    (meaningfulLongRuns / 3) * 100
  );

  const score = distanceScore * 0.7 + frequencyScore * 0.3;

  return createPillar(
    "long-runs",
    "Long-run progression",
    score,
    goal.weights["long-runs"],
    longestRunKm >= goal.targetLongRunKm
      ? "Target long-run distance has been demonstrated"
      : longestRunKm >= goal.minimumLongRunKm
      ? "Long-run progression is developing well"
      : "Long-run endurance remains underdeveloped",
    `Longest run in the last ${Math.round(
      goal.longRunWindowDays / 7
    )} weeks is ${round(longestRunKm, 1)} km, with ${meaningfulLongRuns} run${
      meaningfulLongRuns === 1 ? "" : "s"
    } at or above ${goal.minimumLongRunKm} km.`
  );
}

function scoreSpecificity(
  runs: MatchableRun[],
  sessionMatches: SessionMatchResult[],
  today: string,
  goal: ConfidenceGoalProfile
) {
  const recentRuns = runs.filter((run) =>
    isDateWithinPastDays(run.date, today, 42)
  );

  const qualityRuns = recentRuns.filter(isQualityRun);
  const marathonSpecificRuns = recentRuns.filter(
    isMarathonSpecificRun
  );

  const completedQualitySessions = sessionMatches.filter(
    (match) =>
      match.status === "completed" &&
      match.plannedSession.isKeySession
  ).length;

  const dueQualitySessions = sessionMatches.filter(
    (match) =>
      match.status !== "upcoming" &&
      match.status !== "unverified" &&
      match.plannedSession.isKeySession
  ).length;

  const planExecutionScore =
    dueQualitySessions > 0
      ? clamp(
          (completedQualitySessions / dueQualitySessions) *
            100
        )
      : null;

  const qualityFrequencyScore = clamp(
    (qualityRuns.length / 6) * 100
  );

  const marathonSpecificScore = clamp(
    (marathonSpecificRuns.length / 3) * 100
  );

  const score =
    planExecutionScore === null
      ? qualityFrequencyScore * 0.65 +
        marathonSpecificScore * 0.35
      : planExecutionScore * 0.5 +
        qualityFrequencyScore * 0.3 +
        marathonSpecificScore * 0.2;

  return createPillar(
    "specificity",
    "Marathon-specific work",
    score,
    goal.weights.specificity,
    marathonSpecificRuns.length >= 2
      ? "Marathon-specific work is established"
      : qualityRuns.length >= 3
      ? "Quality work is present but specificity can improve"
      : "More goal-specific quality work is needed",
    `${qualityRuns.length} quality run${
      qualityRuns.length === 1 ? "" : "s"
    } and ${marathonSpecificRuns.length} marathon-specific run${
      marathonSpecificRuns.length === 1 ? "" : "s"
    } were identified in the last six weeks.`
  );
}

function scoreFitness(
  runs: MatchableRun[],
  predictedMarathonSeconds: number | null | undefined,
  goal: ConfidenceGoalProfile
) {
  if (
    typeof predictedMarathonSeconds === "number" &&
    Number.isFinite(predictedMarathonSeconds) &&
    predictedMarathonSeconds > 0
  ) {
    const differenceSeconds =
      predictedMarathonSeconds - goal.targetSeconds;

    let score: number;

    if (differenceSeconds <= -300) {
      score = 100;
    } else if (differenceSeconds <= 0) {
      score = 90 + (Math.abs(differenceSeconds) / 300) * 10;
    } else if (differenceSeconds <= 600) {
      score = 90 - (differenceSeconds / 600) * 30;
    } else if (differenceSeconds <= 1800) {
      score = 60 - ((differenceSeconds - 600) / 1200) * 30;
    } else {
      score = 20;
    }

    return createPillar(
      "fitness",
      "Fitness indicators",
      score,
      goal.weights.fitness,
      predictedMarathonSeconds <= goal.targetSeconds
        ? "Current prediction supports sub-3"
        : "Current prediction remains outside sub-3",
      `Current marathon prediction is ${formatDuration(
        predictedMarathonSeconds
      )}, compared with the target of ${formatDuration(
        goal.targetSeconds
      )}.`
    );
  }

  const recentRuns = runs
    .filter((run) => {
      const distance = getRunDistanceKm(run);
      const pace = getRunPaceSecondsPerKm(run);

      return (
        distance >= 10 &&
        pace !== null &&
        pace <= 270
      );
    })
    .slice(0, 10);

  const score = clamp((recentRuns.length / 4) * 75);

  return createPillar(
    "fitness",
    "Fitness indicators",
    score,
    goal.weights.fitness,
    recentRuns.length >= 3
      ? "Recent faster running provides positive evidence"
      : "Fitness evidence is currently limited",
    predictedMarathonSeconds
      ? "A reliable marathon prediction could not be assessed."
      : "No marathon prediction was supplied, so recent faster runs were used as a limited proxy."
  );
}

function scoreDurability(
  runs: MatchableRun[],
  sessionMatches: SessionMatchResult[],
  today: string,
  goal: ConfidenceGoalProfile
) {
  const recentRuns = runs.filter((run) =>
    isDateWithinPastDays(run.date, today, 28)
  );

  const runningDays = new Set(
    recentRuns.map((run) => run.date.slice(0, 10))
  );

  const missedSessions = sessionMatches.filter(
    (match) => match.status === "missed"
  ).length;

  const dueSessions = sessionMatches.filter(
    (match) =>
      match.status !== "upcoming" &&
      match.status !== "unverified" &&
      !match.plannedSession.isRestDay
  ).length;

  const missedRate =
    dueSessions > 0 ? missedSessions / dueSessions : 0;

  const easyRuns = recentRuns.filter(isEasyOrRecoveryRun);
  const easyRunRatio =
    recentRuns.length > 0
      ? easyRuns.length / recentRuns.length
      : 0;

  const frequencyPenalty =
    runningDays.size > 24
      ? 15
      : runningDays.size > 20
      ? 5
      : 0;

  const score = clamp(
    100 -
      missedRate * 45 -
      Math.max(0, 0.45 - easyRunRatio) * 50 -
      frequencyPenalty
  );

  return createPillar(
    "durability",
    "Durability",
    score,
    goal.weights.durability,
    score >= 80
      ? "Training load appears sustainable"
      : score >= 60
      ? "Recovery balance should be monitored"
      : "Current execution suggests elevated interruption risk",
    `${recentRuns.length} runs were completed over the last four weeks, with ${Math.round(
      easyRunRatio * 100
    )}% classified as easy or recovery running.`
  );
}

function formatDuration(totalSeconds: number) {
  const roundedSeconds = Math.round(totalSeconds);
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor(
    (roundedSeconds % 3600) / 60
  );
  const seconds = roundedSeconds % 60;

  return `${hours}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")}`;
}

function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 90) {
    return "very-high";
  }

  if (score >= 80) {
    return "high";
  }

  if (score >= 65) {
    return "moderate";
  }

  if (score >= 50) {
    return "building";
  }

  return "low";
}

function getConfidenceLabel(level: ConfidenceLevel) {
  const labels: Record<ConfidenceLevel, string> = {
    low: "Low confidence",
    building: "Building",
    moderate: "Moderate confidence",
    high: "High confidence",
    "very-high": "Very high confidence",
  };

  return labels[level];
}

function buildSummary(
  score: number,
  strongest: ConfidencePillar,
  weakest: ConfidencePillar
) {
  if (score >= 90) {
    return `The evidence strongly supports the sub-3 goal. ${strongest.label.toLowerCase()} is the clearest strength, while ${weakest.label.toLowerCase()} remains the main area to consolidate.`;
  }

  if (score >= 80) {
    return `Strong foundations are in place for a sub-3 attempt. ${strongest.label} is providing positive evidence, with the next opportunity coming from ${weakest.label.toLowerCase()}.`;
  }

  if (score >= 65) {
    return `The sub-3 goal remains realistic, but the evidence is not yet complete. The strongest signal is ${strongest.label.toLowerCase()}, while ${weakest.label.toLowerCase()} requires further development.`;
  }

  if (score >= 50) {
    return `The foundations are developing, but several key sub-3 indicators still need to improve. The immediate priority is ${weakest.label.toLowerCase()}.`;
  }

  return `The current evidence does not yet support a confident sub-3 prediction. The main limiting factor is ${weakest.label.toLowerCase()}.`;
}

function getNextMilestone(
  pillars: ConfidencePillar[],
  goal: ConfidenceGoalProfile
) {
  const weakest = [...pillars].sort(
    (first, second) => first.score - second.score
  )[0];

  switch (weakest.key) {
    case "consistency":
      return "Complete five runs per week for the next three weeks.";

    case "volume":
      return `Build average weekly distance toward ${goal.targetWeeklyDistanceKm} km.`;

    case "long-runs":
      return `Complete a controlled ${goal.targetLongRunKm} km long run.`;

    case "specificity":
      return "Complete a marathon-pace session within the coach's prescribed pace range.";

    case "fitness":
      return "Record a race or benchmark session that provides stronger marathon-fitness evidence.";

    case "durability":
      return "Complete the next two weeks without an unplanned interruption.";

    default:
      return "Continue executing the coach's plan consistently.";
  }
}

export function calculateSub3Confidence(
  input: ConfidenceEngineInput
): Sub3ConfidenceResult {
  const goal = input.goal ?? SUB3_GOAL_PROFILE;
  const today = input.today ?? getTodayDateKey();
  const sessionMatches = input.sessionMatches ?? [];

  const pillars: ConfidencePillar[] = [
    scoreConsistency(input.runs, today, goal),
    scoreVolume(input.runs, today, goal),
    scoreLongRuns(input.runs, today, goal),
    scoreSpecificity(
      input.runs,
      sessionMatches,
      today,
      goal
    ),
    scoreFitness(
      input.runs,
      input.predictedMarathonSeconds,
      goal
    ),
    scoreDurability(
      input.runs,
      sessionMatches,
      today,
      goal
    ),
  ];

  const score = Math.round(
    pillars.reduce(
      (sum, pillar) => sum + pillar.weightedScore,
      0
    )
  );

  const sortedPillars = [...pillars].sort(
    (first, second) => second.score - first.score
  );

  const strongestPillar = sortedPillars[0];
  const weakestPillar =
    sortedPillars[sortedPillars.length - 1];

  const level = getConfidenceLevel(score);

  const supportingEvidence = sortedPillars
    .filter((pillar) => pillar.score >= 70)
    .slice(0, 3)
    .map(
      (pillar) =>
        `${pillar.label}: ${pillar.headline.toLowerCase()}.`
    );

  const risks = [...pillars]
    .sort((first, second) => first.score - second.score)
    .filter((pillar) => pillar.score < 70)
    .slice(0, 3)
    .map(
      (pillar) =>
        `${pillar.label}: ${pillar.headline.toLowerCase()}.`
    );

  return {
    score,
    level,
    label: getConfidenceLabel(level),
    summary: buildSummary(
      score,
      strongestPillar,
      weakestPillar
    ),

    pillars,

    strongestPillar,
    weakestPillar,

    biggestStrength: strongestPillar.headline,
    biggestRisk: weakestPillar.headline,
    nextMilestone: getNextMilestone(pillars, goal),

    supportingEvidence,
    risks,
  };
}
