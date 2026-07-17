export type MatchableLap = {
  distance?: number | null;
  elapsed_time?: number | null;
  moving_time?: number | null;
  average_speed?: number | null;
  average_heartrate?: number | null;
  name?: string | null;
};

export type MatchableRun = {
  id: string;
  date: string;
  distance: string;
  time: string;
  runType: string;
  avgHr: string;
  elevation: string;

  name?: string;
  notes?: string;
  source?: string;

  distanceMeters?: number;
  movingTimeSeconds?: number;
  paceSecondsPerKm?: number | null;
  averageHeartrate?: number | null;
  workoutType?: number | null;
  laps?: MatchableLap[];
};

export type MatchablePlannedDistance = {
  minimumKm: number | null;
  maximumKm: number | null;
  display: string;
};

export type MatchablePlannedSession = {
  id: string;
  sourceRowNumber: number;
  weekEndingDate: string;
  plannedDate: string;
  dayName: string;
  dayIndex: number;
  rawText: string;
  title: string;
  sessionType: string;
  isRestDay: boolean;
  isKeySession: boolean;
  distance: MatchablePlannedDistance;
  targetPaceText: string | null;
};

export type SessionMatchStatus =
  | "completed"
  | "partial"
  | "missed"
  | "rest"
  | "upcoming"
  | "unverified";

export type SessionMatchComponentKey =
  | "distance"
  | "pace"
  | "session-type"
  | "structure"
  | "heart-rate";

export type SessionMatchComponent = {
  key: SessionMatchComponentKey;
  label: string;
  score: number;
  available: boolean;
  explanation: string;
};

export type SessionMatchResult = {
  sessionId: string;
  plannedDate: string;
  status: SessionMatchStatus;
  statusLabel: string;
  score: number | null;
  verdict: string;
  detail: string;
  plannedSession: MatchablePlannedSession;
  matchedRuns: MatchableRun[];
  matchedRunIds: string[];
  completedDistanceKm: number;
  plannedMinimumDistanceKm: number | null;
  plannedMaximumDistanceKm: number | null;
  distanceDifferenceKm: number | null;
  components: SessionMatchComponent[];
};

export type WeekExecution = {
  plannedCount: number;
  dueCount: number;
  completedCount: number;
  partialCount: number;
  missedCount: number;
  restCount: number;
  upcomingCount: number;
  completionPercentage: number;
  averageExecutionScore: number | null;
};

type PaceRange = {
  minimumSecondsPerKm: number;
  maximumSecondsPerKm: number;
};

const DAY_IN_MILLISECONDS = 86_400_000;

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimals = 0) {
  const multiplier = 10 ** decimals;

  return Math.round(value * multiplier) / multiplier;
}

function parseDate(value: string) {
  if (!value) {
    return null;
  }

  const cleanValue = value.slice(0, 10);
  const parsed = new Date(`${cleanValue}T12:00:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function todayDateKey() {
  const today = new Date();

  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}

function getRunDateKey(run: MatchableRun) {
  return run.date ? run.date.slice(0, 10) : "";
}

function timeToSeconds(value: string) {
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

  return (
    parts[0] * 3600 +
    parts[1] * 60 +
    parts[2]
  );
}

function getRunDistanceKm(run: MatchableRun) {
  if (
    typeof run.distanceMeters === "number" &&
    Number.isFinite(run.distanceMeters) &&
    run.distanceMeters > 0
  ) {
    return run.distanceMeters / 1000;
  }

  const parsed = Number.parseFloat(run.distance || "");

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
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

  return timeToSeconds(run.time) || 0;
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

function getWeightedAveragePace(runs: MatchableRun[]) {
  const totalDistanceKm = runs.reduce(
    (sum, run) => sum + getRunDistanceKm(run),
    0
  );

  const totalTimeSeconds = runs.reduce(
    (sum, run) => sum + getRunTimeSeconds(run),
    0
  );

  if (totalDistanceKm <= 0 || totalTimeSeconds <= 0) {
    return null;
  }

  return totalTimeSeconds / totalDistanceKm;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normaliseText(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/[_–—-]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRunTypeText(run: MatchableRun) {
  return normaliseText(
    [
      run.runType,
      run.name,
      run.notes,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function getExpectedRunTypeTerms(sessionType: string) {
  const normalisedType = normaliseText(sessionType);

  const termsByType: Record<string, string[]> = {
    easy: [
      "easy",
      "aerobic",
      "recovery",
      "general",
    ],
    recovery: [
      "recovery",
      "easy",
      "shakeout",
    ],
    steady: [
      "steady",
      "aerobic",
      "moderate",
    ],
    tempo: [
      "tempo",
      "threshold",
      "controlled",
      "progression",
    ],
    threshold: [
      "threshold",
      "tempo",
      "cruise",
      "interval",
    ],
    interval: [
      "interval",
      "repetition",
      "reps",
      "track",
      "speed",
      "vo2",
    ],
    "marathon pace": [
      "marathon pace",
      "marathon",
      "mp",
      "race pace",
    ],
    "marathon-pace": [
      "marathon pace",
      "marathon",
      "mp",
      "race pace",
    ],
    "long run": [
      "long run",
      "long",
      "endurance",
    ],
    "long-run": [
      "long run",
      "long",
      "endurance",
    ],
    race: [
      "race",
      "parkrun",
      "time trial",
      "competition",
    ],
    "cross training": [
      "cross training",
      "cycling",
      "bike",
      "swim",
      "elliptical",
    ],
    "cross-training": [
      "cross training",
      "cycling",
      "bike",
      "swim",
      "elliptical",
    ],
  };

  return termsByType[normalisedType] || [
    normalisedType,
  ];
}

function calculateSessionTypeScore(
  session: MatchablePlannedSession,
  runs: MatchableRun[]
) {
  if (session.isRestDay) {
    return runs.length === 0 ? 100 : 20;
  }

  if (runs.length === 0) {
    return 0;
  }

  const expectedTerms = getExpectedRunTypeTerms(
    session.sessionType
  );

  const combinedRunText = runs
    .map(getRunTypeText)
    .join(" ");

  if (
    expectedTerms.some(
      (term) =>
        term &&
        combinedRunText.includes(
          normaliseText(term)
        )
    )
  ) {
    return 100;
  }

  const plannedType = normaliseText(
    session.sessionType
  );

  if (
    plannedType === "easy" ||
    plannedType === "recovery"
  ) {
    return 75;
  }

  if (
    plannedType === "long run" ||
    plannedType === "long-run"
  ) {
    const totalDistance = runs.reduce(
      (sum, run) =>
        sum + getRunDistanceKm(run),
      0
    );

    if (totalDistance >= 18) {
      return 85;
    }

    if (totalDistance >= 14) {
      return 65;
    }
  }

  return 50;
}

function calculateDistanceScore(
  session: MatchablePlannedSession,
  completedDistanceKm: number
) {
  const minimumKm =
    session.distance.minimumKm;

  const maximumKm =
    session.distance.maximumKm;

  if (
    minimumKm === null &&
    maximumKm === null
  ) {
    return {
      available: false,
      score: 100,
      explanation:
        "No numerical distance target was available.",
    };
  }

  const targetMinimum =
    minimumKm ?? maximumKm ?? 0;

  const targetMaximum =
    maximumKm ?? minimumKm ?? 0;

  if (completedDistanceKm <= 0) {
    return {
      available: true,
      score: 0,
      explanation:
        "No completed distance was detected.",
    };
  }

  if (
    completedDistanceKm >= targetMinimum &&
    completedDistanceKm <= targetMaximum
  ) {
    return {
      available: true,
      score: 100,
      explanation: `${completedDistanceKm.toFixed(
        1
      )} km completed against a planned range of ${targetMinimum.toFixed(
        1
      )}–${targetMaximum.toFixed(1)} km.`,
    };
  }

  if (completedDistanceKm < targetMinimum) {
    const shortfall =
      targetMinimum - completedDistanceKm;

    const percentage =
      targetMinimum > 0
        ? completedDistanceKm /
          targetMinimum
        : 0;

    return {
      available: true,
      score: clampScore(
        percentage * 100
      ),
      explanation: `${completedDistanceKm.toFixed(
        1
      )} km completed, ${shortfall.toFixed(
        1
      )} km below the minimum planned distance.`,
    };
  }

  const excess =
    completedDistanceKm - targetMaximum;

  const excessPercentage =
    targetMaximum > 0
      ? excess / targetMaximum
      : 0;

  const score = clampScore(
    100 - excessPercentage * 60
  );

  return {
    available: true,
    score,
    explanation: `${completedDistanceKm.toFixed(
      1
    )} km completed, ${excess.toFixed(
      1
    )} km above the maximum planned distance.`,
  };
}

function paceStringToSeconds(
  value: string
) {
  const match = value.match(
    /(\d{1,2}):(\d{2})/
  );

  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);

  if (
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return null;
  }

  return minutes * 60 + seconds;
}

function extractTargetPaceRange(
  targetPaceText: string | null
) {
  if (!targetPaceText) {
    return null;
  }

  const matches = Array.from(
    targetPaceText.matchAll(
      /(\d{1,2}:\d{2})/g
    )
  )
    .map((match) =>
      paceStringToSeconds(match[1])
    )
    .filter(
      (value): value is number =>
        value !== null
    );

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return {
      fastestSecondsPerKm:
        matches[0],
      slowestSecondsPerKm:
        matches[0],
    };
  }

  return {
    fastestSecondsPerKm: Math.min(
      ...matches
    ),
    slowestSecondsPerKm: Math.max(
      ...matches
    ),
  };
}

function formatPaceSeconds(
  value: number
) {
  const rounded = Math.round(value);
  const minutes = Math.floor(
    rounded / 60
  );
  const seconds = rounded % 60;

  return `${minutes}:${String(
    seconds
  ).padStart(2, "0")} /km`;
}

function calculatePaceScore(
  session: MatchablePlannedSession,
  runs: MatchableRun[]
) {
  const targetRange =
    extractTargetPaceRange(
      session.targetPaceText
    );

  if (!targetRange) {
    return {
      available: false,
      score: 100,
      explanation:
        "No numerical pace target was available.",
    };
  }

  const actualPace =
    getWeightedAveragePace(runs);

  if (actualPace === null) {
    return {
      available: false,
      score: 100,
      explanation:
        "The completed run did not contain enough data to calculate pace.",
    };
  }

  const {
    fastestSecondsPerKm,
    slowestSecondsPerKm,
  } = targetRange;

  if (
    actualPace >= fastestSecondsPerKm &&
    actualPace <= slowestSecondsPerKm
  ) {
    return {
      available: true,
      score: 100,
      explanation: `${formatPaceSeconds(
        actualPace
      )} was within the planned pace range.`,
    };
  }

  const deviation =
    actualPace < fastestSecondsPerKm
      ? fastestSecondsPerKm -
        actualPace
      : actualPace -
        slowestSecondsPerKm;

  const score = clampScore(
    100 - deviation * 2
  );

  const direction =
    actualPace <
    fastestSecondsPerKm
      ? "faster"
      : "slower";

  return {
    available: true,
    score,
    explanation: `${formatPaceSeconds(
      actualPace
    )} was ${Math.round(
      deviation
    )} sec/km ${direction} than the planned range.`,
  };
}

function calculateStructureScore(
  session: MatchablePlannedSession,
  runs: MatchableRun[]
) {
  if (runs.length === 0) {
    return {
      available: true,
      score: 0,
      explanation:
        "No matching activity was detected.",
    };
  }

  const plannedType = normaliseText(
    session.sessionType
  );

  const structureSensitiveTypes = [
    "interval",
    "threshold",
    "tempo",
    "marathon pace",
    "marathon-pace",
  ];

  if (
    !structureSensitiveTypes.includes(
      plannedType
    )
  ) {
    return {
      available: false,
      score: 100,
      explanation:
        "Detailed workout structure was not required for this session type.",
    };
  }

  const laps = runs.flatMap(
    (run) =>
      Array.isArray(run.laps)
        ? run.laps
        : []
  );

  if (laps.length === 0) {
    const typeScore =
      calculateSessionTypeScore(
        session,
        runs
      );

    return {
      available: true,
      score: Math.min(
        75,
        typeScore
      ),
      explanation:
        "The activity was detected, but detailed Strava lap data was unavailable to verify the planned repetitions.",
    };
  }

  const meaningfulLaps =
    laps.filter((lap) => {
      const distance =
        typeof lap.distance === "number"
          ? lap.distance
          : 0;

      const movingTime =
        typeof lap.moving_time ===
        "number"
          ? lap.moving_time
          : 0;

      return (
        distance >= 200 &&
        movingTime > 0
      );
    });

  if (meaningfulLaps.length >= 3) {
    return {
      available: true,
      score: 90,
      explanation: `${meaningfulLaps.length} meaningful laps were available, providing evidence that the workout structure was completed.`,
    };
  }

  return {
    available: true,
    score: 65,
    explanation:
      "Some lap data was available, but there was not enough detail to verify the full planned structure.",
  };
}

function getStatusLabel(
  status: SessionMatchStatus
) {
  const labels: Record<
    SessionMatchStatus,
    string
  > = {
    completed: "Completed",
    partial: "Partially completed",
    missed: "Missed",
    upcoming: "Upcoming",
    unverified: "Awaiting verification",
    rest: "Rest day observed",
  };

  return labels[status];
}

function getSessionStatus(
  session: MatchablePlannedSession,
  runs: MatchableRun[],
  score: number | null
): SessionMatchStatus {
  const todayKey =
    new Date()
      .toISOString()
      .slice(0, 10);

  if (session.isRestDay) {
    if (runs.length === 0) {
      return session.plannedDate >
        todayKey
        ? "upcoming"
        : "rest";
    }

    return session.plannedDate >
      todayKey
      ? "upcoming"
      : "partial";
  }

  if (
    session.plannedDate > todayKey
  ) {
    return "upcoming";
  }

  if (
    session.plannedDate === todayKey &&
    runs.length === 0
  ) {
    return "unverified";
  }

  if (runs.length === 0) {
    return "missed";
  }

  if (score === null) {
    return "unverified";
  }

  if (score >= 75) {
    return "completed";
  }

  if (score >= 35) {
    return "partial";
  }

  return "missed";
}

function buildVerdict(
  status: SessionMatchStatus,
  score: number | null,
  session: MatchablePlannedSession,
  completedDistanceKm: number
) {
  if (status === "upcoming") {
    return {
      verdict: "Session is still upcoming.",
      detail:
        "No execution assessment is required yet.",
    };
  }

  if (status === "unverified") {
    return {
      verdict:
        "Session has not yet been verified.",
      detail:
        "The session is scheduled for today and no matching Strava activity has been detected yet.",
    };
  }

  if (status === "rest") {
    return {
      verdict:
        "Planned recovery day observed.",
      detail:
        "No run was detected on the planned rest day.",
    };
  }

  if (
    status === "missed" &&
    completedDistanceKm === 0
  ) {
    return {
      verdict:
        "Planned session not detected.",
      detail:
        "No matching Strava activity was found for this date.",
    };
  }

  if (score !== null && score >= 90) {
    return {
      verdict:
        "Excellent execution.",
      detail:
        "The completed activity aligned closely with the coach's planned session.",
    };
  }

  if (score !== null && score >= 75) {
    return {
      verdict:
        "Session completed well.",
      detail:
        "The main requirements of the planned session were achieved.",
    };
  }

  if (score !== null && score >= 50) {
    return {
      verdict:
        "Session partially matched the plan.",
      detail:
        "A run was completed, but one or more important session requirements were not fully met.",
    };
  }

  if (session.isRestDay) {
    return {
      verdict:
        "Additional activity was completed on a planned rest day.",
      detail:
        "This may be acceptable, but it reduces recovery compliance for the week.",
    };
  }

  return {
    verdict:
      "Completed activity did not closely match the planned session.",
    detail:
      "Review the distance, workout type and available pace evidence.",
  };
}

function getRunsForSessionDate(
  session: MatchablePlannedSession,
  runs: MatchableRun[]
) {
  return runs.filter(
    (run) =>
      run.date.slice(0, 10) ===
      session.plannedDate
  );
}

export function matchSessionToRuns(
  session: MatchablePlannedSession,
  allRuns: MatchableRun[]
): SessionMatchResult {
  const matchingRuns =
    getRunsForSessionDate(
      session,
      allRuns
    );

  const completedDistanceKm =
    matchingRuns.reduce(
      (sum, run) =>
        sum + getRunDistanceKm(run),
      0
    );

  if (session.isRestDay) {
    const restScore =
      matchingRuns.length === 0
        ? 100
        : 20;

    const status =
      getSessionStatus(
        session,
        matchingRuns,
        restScore
      );

    const verdict = buildVerdict(
      status,
      restScore,
      session,
      completedDistanceKm
    );

    return {
      sessionId: session.id,
      plannedDate:
        session.plannedDate,
      status,
      statusLabel:
        getStatusLabel(status),
      score:
        status === "upcoming"
          ? null
          : restScore,
      verdict: verdict.verdict,
      detail: verdict.detail,
      matchedRuns: matchingRuns,
      completedDistanceKm,
      components: [
        {
          key: "session-type",
          label: "Recovery compliance",
          available: true,
          score: restScore,
          explanation:
            matchingRuns.length === 0
              ? "No running activity was recorded."
              : `${matchingRuns.length} running activity${
                  matchingRuns.length === 1
                    ? " was"
                    : "ies were"
                } recorded on the planned rest day.`,
        },
      ],
    };
  }

  const distance =
    calculateDistanceScore(
      session,
      completedDistanceKm
    );

  const pace =
    calculatePaceScore(
      session,
      matchingRuns
    );

  const structure =
    calculateStructureScore(
      session,
      matchingRuns
    );

  const typeScore =
    calculateSessionTypeScore(
      session,
      matchingRuns
    );

  const components: SessionMatchComponent[] =
    [
      {
        key: "distance",
        label: "Distance",
        available:
          distance.available,
        score: distance.score,
        explanation:
          distance.explanation,
      },
      {
        key: "session-type",
        label: "Session type",
        available: true,
        score: typeScore,
        explanation:
          matchingRuns.length === 0
            ? "No activity was available to assess the planned session type."
            : typeScore >= 85
            ? "The activity description and recorded workout type were consistent with the plan."
            : "The activity was completed, but its recorded type did not clearly match the planned workout.",
      },
      {
        key: "pace",
        label: "Pace",
        available: pace.available,
        score: pace.score,
        explanation:
          pace.explanation,
      },
      {
        key: "structure",
        label: "Workout structure",
        available:
          structure.available,
        score: structure.score,
        explanation:
          structure.explanation,
      },
    ];

  const availableComponents =
    components.filter(
      (component) =>
        component.available
    );

  const weightedScore =
    matchingRuns.length === 0
      ? 0
      : availableComponents.reduce(
          (total, component) => {
            const weight =
              component.key ===
              "distance"
                ? 0.35
                : component.key ===
                  "session-type"
                ? 0.25
                : component.key ===
                  "pace"
                ? 0.2
                : 0.2;

            return (
              total +
              component.score * weight
            );
          },
          0
        );

  const availableWeight =
    availableComponents.reduce(
      (total, component) => {
        if (
          component.key === "distance"
        ) {
          return total + 0.35;
        }

        if (
          component.key ===
          "session-type"
        ) {
          return total + 0.25;
        }

        return total + 0.2;
      },
      0
    );

  const score =
    matchingRuns.length === 0
      ? 0
      : availableWeight > 0
      ? clampScore(
          weightedScore /
            availableWeight
        )
      : null;

  const status = getSessionStatus(
    session,
    matchingRuns,
    score
  );

  const verdict = buildVerdict(
    status,
    score,
    session,
    completedDistanceKm
  );

  return {
    sessionId: session.id,
    plannedDate:
      session.plannedDate,
    status,
    statusLabel:
      getStatusLabel(status),
    score:
      status === "upcoming" ||
      status === "unverified"
        ? null
        : score,
    verdict: verdict.verdict,
    detail: verdict.detail,
    matchedRuns: matchingRuns,
    completedDistanceKm,
    components,
  };
}

export function matchTrainingWeek(
  sessions: MatchablePlannedSession[],
  runs: MatchableRun[]
) {
  return sessions
    .slice()
    .sort(
      (a, b) =>
        a.plannedDate.localeCompare(
          b.plannedDate
        )
    )
    .map((session) =>
      matchSessionToRuns(
        session,
        runs
      )
    );
}

export function calculateWeekExecution(
  matches: SessionMatchResult[]
): WeekExecutionSummary {
  const dueMatches = matches.filter(
    (match) =>
      match.status !== "upcoming" &&
      match.status !==
        "unverified"
  );

  const scoredMatches =
    dueMatches.filter(
      (
        match
      ): match is SessionMatchResult & {
        score: number;
      } =>
        typeof match.score ===
          "number" &&
        Number.isFinite(match.score)
    );

  const completedCount =
    dueMatches.filter(
      (match) =>
        match.status ===
          "completed" ||
        match.status === "rest"
    ).length;

  const partialCount =
    dueMatches.filter(
      (match) =>
        match.status === "partial"
    ).length;

  const missedCount =
    dueMatches.filter(
      (match) =>
        match.status === "missed"
    ).length;

  const dueCount =
    dueMatches.length;

  const averageExecutionScore =
    scoredMatches.length > 0
      ? Math.round(
          scoredMatches.reduce(
            (sum, match) =>
              sum + match.score,
            0
          ) /
            scoredMatches.length
        )
      : null;

  const completionPercentage =
    dueCount > 0
      ? Math.round(
          (completedCount /
            dueCount) *
            100
        )
      : 0;

  return {
    plannedCount:
      matches.length,
    dueCount,
    completedCount,
    partialCount,
    missedCount,
    pendingCount:
      matches.filter(
        (match) =>
          match.status ===
            "upcoming"
      ).length,
    unverifiedCount:
      matches.filter(
        (match) =>
          match.status ===
            "unverified"
      ).length,
    averageExecutionScore,
    completionPercentage,
  };
}
