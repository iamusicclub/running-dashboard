import type {
  MatchablePlannedSession,
  MatchableRun,
  SessionMatchResult,
} from "./session-matching";

export type TrainingInsightTone =
  | "positive"
  | "neutral"
  | "warning"
  | "critical";

export type TrainingInsight = {
  id: string;
  title: string;
  detail: string;
  tone: TrainingInsightTone;
  priority: number;
};

export type TrainingCategoryScore = {
  key:
    | "completion"
    | "distance"
    | "quality"
    | "easy"
    | "longRun"
    | "recovery";

  label: string;
  score: number | null;
  context: string;
};

export type WeeklyTrainingAssessment = {
  score: number | null;
  label: string;
  tone: TrainingInsightTone;

  plannedSessionCount: number;
  dueSessionCount: number;
  completedSessionCount: number;
  partialSessionCount: number;
  missedSessionCount: number;
  restDayCount: number;

  plannedDistanceKm: number | null;
  completedDistanceKm: number;
  distanceDifferenceKm: number | null;
  distanceCompletionPercentage: number | null;

  categoryScores: TrainingCategoryScore[];

  strengths: TrainingInsight[];
  concerns: TrainingInsight[];
  summary: string;
};

export type RunAnalysisInput = {
  runs: MatchableRun[];
  plannedSessions: MatchablePlannedSession[];
  matches: SessionMatchResult[];
  today?: Date;
};

type PlannedDistanceSummary = {
  minimumKm: number;
  maximumKm: number;
  hasDistanceTargets: boolean;
};

function clamp(
  value: number,
  minimum: number,
  maximum: number
) {
  return Math.min(
    maximum,
    Math.max(minimum, value)
  );
}

function round(
  value: number,
  decimals = 1
) {
  const multiplier = 10 ** decimals;

  return (
    Math.round(value * multiplier) /
    multiplier
  );
}

function getRunDistanceKm(
  run: MatchableRun
) {
  if (
    typeof run.distanceMeters === "number" &&
    Number.isFinite(run.distanceMeters) &&
    run.distanceMeters > 0
  ) {
    return run.distanceMeters / 1000;
  }

  const parsed = Number.parseFloat(
    run.distance || "0"
  );

  return Number.isFinite(parsed) &&
    parsed > 0
    ? parsed
    : 0;
}

function getRunTimeSeconds(
  run: MatchableRun
) {
  if (
    typeof run.movingTimeSeconds === "number" &&
    Number.isFinite(
      run.movingTimeSeconds
    ) &&
    run.movingTimeSeconds > 0
  ) {
    return run.movingTimeSeconds;
  }

  const value = run.time || "";

  const parts = value
    .split(":")
    .map(Number);

  if (
    parts.some((part) =>
      Number.isNaN(part)
    )
  ) {
    return 0;
  }

  if (parts.length === 2) {
    return (
      parts[0] * 60 +
      parts[1]
    );
  }

  if (parts.length === 3) {
    return (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    );
  }

  return 0;
}

function getRunPaceSecondsPerKm(
  run: MatchableRun
) {
  if (
    typeof run.paceSecondsPerKm === "number" &&
    Number.isFinite(
      run.paceSecondsPerKm
    ) &&
    run.paceSecondsPerKm > 0
  ) {
    return run.paceSecondsPerKm;
  }

  const distanceKm =
    getRunDistanceKm(run);

  const timeSeconds =
    getRunTimeSeconds(run);

  if (
    distanceKm <= 0 ||
    timeSeconds <= 0
  ) {
    return null;
  }

  return timeSeconds / distanceKm;
}

function normaliseType(value: string) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function isRestSession(
  session: MatchablePlannedSession
) {
  return (
    session.isRestDay ||
    normaliseType(
      session.sessionType
    ) === "rest"
  );
}

function isLongRunSession(
  session: MatchablePlannedSession
) {
  const type = normaliseType(
    session.sessionType
  );

  const text = `${session.title} ${session.rawText}`
    .toLowerCase();

  return (
    type === "long-run" ||
    text.includes("long run") ||
    text.includes("long-run") ||
    (session.distance.maximumKm !==
      null &&
      session.distance.maximumKm >= 18)
  );
}

function isQualitySession(
  session: MatchablePlannedSession
) {
  const type = normaliseType(
    session.sessionType
  );

  return [
    "tempo",
    "threshold",
    "interval",
    "intervals",
    "marathon-pace",
    "race",
  ].includes(type);
}

function isEasySession(
  session: MatchablePlannedSession
) {
  const type = normaliseType(
    session.sessionType
  );

  return [
    "easy",
    "steady",
  ].includes(type);
}

function isRecoverySession(
  session: MatchablePlannedSession
) {
  return (
    normaliseType(
      session.sessionType
    ) === "recovery"
  );
}

function getPlannedDistanceSummary(
  sessions: MatchablePlannedSession[]
): PlannedDistanceSummary {
  let minimumKm = 0;
  let maximumKm = 0;
  let hasDistanceTargets = false;

  sessions.forEach((session) => {
    if (isRestSession(session)) {
      return;
    }

    const minimum =
      session.distance.minimumKm;

    const maximum =
      session.distance.maximumKm;

    if (
      minimum === null &&
      maximum === null
    ) {
      return;
    }

    hasDistanceTargets = true;

    minimumKm +=
      minimum ?? maximum ?? 0;

    maximumKm +=
      maximum ?? minimum ?? 0;
  });

  return {
    minimumKm,
    maximumKm,
    hasDistanceTargets,
  };
}

function calculateAverageScore(
  results: SessionMatchResult[]
) {
  const scored = results.filter(
    (
      result
    ): result is SessionMatchResult & {
      score: number;
    } =>
      result.score !== null &&
      Number.isFinite(result.score)
  );

  if (scored.length === 0) {
    return null;
  }

  return Math.round(
    scored.reduce(
      (sum, result) =>
        sum + result.score,
      0
    ) / scored.length
  );
}

function getDueMatches(
  matches: SessionMatchResult[]
) {
  return matches.filter(
    (match) =>
      match.status !== "not-due"
  );
}

function calculateCompletionScore(
  dueMatches: SessionMatchResult[]
) {
  if (dueMatches.length === 0) {
    return null;
  }

  const points = dueMatches.reduce(
    (total, match) => {
      if (
        match.status === "completed" ||
        match.status === "rest"
      ) {
        return total + 1;
      }

      if (
        match.status === "partial"
      ) {
        return total + 0.5;
      }

      return total;
    },
    0
  );

  return Math.round(
    (points / dueMatches.length) *
      100
  );
}

function calculateCategoryScore(
  sessions: MatchablePlannedSession[],
  matches: SessionMatchResult[],
  predicate: (
    session: MatchablePlannedSession
  ) => boolean
) {
  const relevantSessionIds = new Set(
    sessions
      .filter(predicate)
      .map((session) => session.id)
  );

  const relevantMatches =
    matches.filter((match) =>
      relevantSessionIds.has(
        match.sessionId
      )
    );

  return calculateAverageScore(
    relevantMatches
  );
}

function calculateRestScore(
  sessions: MatchablePlannedSession[],
  matches: SessionMatchResult[]
) {
  const restIds = new Set(
    sessions
      .filter(isRestSession)
      .map((session) => session.id)
  );

  const restMatches = matches.filter(
    (match) =>
      restIds.has(match.sessionId) &&
      match.status !== "not-due"
  );

  if (restMatches.length === 0) {
    return null;
  }

  const score = restMatches.reduce(
    (sum, match) => {
      if (
        match.status === "rest"
      ) {
        return sum + 100;
      }

      if (
        match.score !== null
      ) {
        return sum + match.score;
      }

      return sum;
    },
    0
  );

  return Math.round(
    score / restMatches.length
  );
}

function getScoreLabel(
  score: number | null
) {
  if (score === null) {
    return "Awaiting evidence";
  }

  if (score >= 90) {
    return "Excellent";
  }

  if (score >= 80) {
    return "Strong";
  }

  if (score >= 70) {
    return "Good";
  }

  if (score >= 55) {
    return "Mixed";
  }

  return "Needs attention";
}

function getScoreTone(
  score: number | null
): TrainingInsightTone {
  if (score === null) {
    return "neutral";
  }

  if (score >= 80) {
    return "positive";
  }

  if (score >= 60) {
    return "neutral";
  }

  if (score >= 40) {
    return "warning";
  }

  return "critical";
}

function createInsight(
  id: string,
  title: string,
  detail: string,
  tone: TrainingInsightTone,
  priority: number
): TrainingInsight {
  return {
    id,
    title,
    detail,
    tone,
    priority,
  };
}

function buildStrengths(
  categoryScores: TrainingCategoryScore[],
  matches: SessionMatchResult[],
  completedDistanceKm: number,
  plannedDistanceKm: number | null
) {
  const strengths: TrainingInsight[] = [];

  categoryScores.forEach(
    (category) => {
      if (
        category.score !== null &&
        category.score >= 85
      ) {
        strengths.push(
          createInsight(
            `strength-${category.key}`,
            `${category.label} is strong`,
            category.context,
            "positive",
            category.score
          )
        );
      }
    }
  );

  const excellentMatches =
    matches.filter(
      (match) =>
        match.score !== null &&
        match.score >= 90
    );

  if (excellentMatches.length > 0) {
    strengths.push(
      createInsight(
        "excellent-sessions",
        "High-quality execution",
        `${excellentMatches.length} due session${
          excellentMatches.length === 1
            ? ""
            : "s"
        } scored at least 90%.`,
        "positive",
        95
      )
    );
  }

  if (
    plannedDistanceKm !== null &&
    plannedDistanceKm > 0
  ) {
    const percentage =
      (completedDistanceKm /
        plannedDistanceKm) *
      100;

    if (
      percentage >= 95 &&
      percentage <= 110
    ) {
      strengths.push(
        createInsight(
          "volume-close-to-plan",
          "Weekly volume is aligned",
          `${round(
            completedDistanceKm
          )} km completed against approximately ${round(
            plannedDistanceKm
          )} km planned.`,
          "positive",
          90
        )
      );
    }
  }

  return strengths
    .sort(
      (first, second) =>
        second.priority -
        first.priority
    )
    .slice(0, 4);
}

function buildConcerns(
  categoryScores: TrainingCategoryScore[],
  matches: SessionMatchResult[],
  completedDistanceKm: number,
  plannedDistanceKm: number | null
) {
  const concerns: TrainingInsight[] = [];

  categoryScores.forEach(
    (category) => {
      if (
        category.score !== null &&
        category.score < 65
      ) {
        concerns.push(
          createInsight(
            `concern-${category.key}`,
            `${category.label} needs attention`,
            category.context,
            category.score < 45
              ? "critical"
              : "warning",
            100 - category.score
          )
        );
      }
    }
  );

  const missedMatches =
    matches.filter(
      (match) =>
        match.status === "missed"
    );

  if (missedMatches.length > 0) {
    concerns.push(
      createInsight(
        "missed-sessions",
        "Sessions were missed",
        `${missedMatches.length} due session${
          missedMatches.length === 1
            ? ""
            : "s"
        } did not have a matching Strava activity.`,
        missedMatches.length >= 2
          ? "critical"
          : "warning",
        100
      )
    );
  }

  const partialMatches =
    matches.filter(
      (match) =>
        match.status === "partial"
    );

  if (partialMatches.length > 0) {
    concerns.push(
      createInsight(
        "partial-sessions",
        "Some sessions only partially matched",
        `${partialMatches.length} session${
          partialMatches.length === 1
            ? ""
            : "s"
        } materially differed from the coach plan.`,
        "warning",
        75
      )
    );
  }

  if (
    plannedDistanceKm !== null &&
    plannedDistanceKm > 0
  ) {
    const difference =
      completedDistanceKm -
      plannedDistanceKm;

    const percentage =
      (difference /
        plannedDistanceKm) *
      100;

    if (percentage < -15) {
      concerns.push(
        createInsight(
          "weekly-volume-shortfall",
          "Weekly volume is below plan",
          `${round(
            Math.abs(percentage),
            0
          )}% less distance has been completed than planned.`,
          percentage < -30
            ? "critical"
            : "warning",
          Math.abs(percentage)
        )
      );
    }

    if (percentage > 20) {
      concerns.push(
        createInsight(
          "weekly-volume-excess",
          "Weekly volume is above plan",
          `${round(
            percentage,
            0
          )}% more distance has been completed than planned.`,
          "warning",
          percentage
        )
      );
    }
  }

  return concerns
    .sort(
      (first, second) =>
        second.priority -
        first.priority
    )
    .slice(0, 4);
}

function buildSummary(
  score: number | null,
  completedCount: number,
  partialCount: number,
  missedCount: number,
  strengths: TrainingInsight[],
  concerns: TrainingInsight[]
) {
  if (score === null) {
    return "There is not yet enough completed training evidence to assess this week.";
  }

  const scoreDescription =
    score >= 90
      ? "an excellent"
      : score >= 80
      ? "a strong"
      : score >= 70
      ? "a good"
      : score >= 55
      ? "a mixed"
      : "a weak";

  let summary =
    `This is ${scoreDescription} training week so far, with an execution score of ${score}%. `;

  summary += `${completedCount} session${
    completedCount === 1 ? "" : "s"
  } completed`;

  if (partialCount > 0) {
    summary += `, ${partialCount} partially matched`;
  }

  if (missedCount > 0) {
    summary += ` and ${missedCount} missed`;
  }

  summary += ".";

  if (strengths.length > 0) {
    summary += ` The clearest positive is ${strengths[0].title.toLowerCase()}.`;
  }

  if (concerns.length > 0) {
    summary += ` The main concern is ${concerns[0].title.toLowerCase()}.`;
  }

  return summary;
}

export function buildWeeklyTrainingAssessment({
  runs,
  plannedSessions,
  matches,
}: RunAnalysisInput): WeeklyTrainingAssessment {
  const dueMatches =
    getDueMatches(matches);

  const completedSessionCount =
    dueMatches.filter(
      (match) =>
        match.status === "completed" ||
        match.status === "rest"
    ).length;

  const partialSessionCount =
    dueMatches.filter(
      (match) =>
        match.status === "partial"
    ).length;

  const missedSessionCount =
    dueMatches.filter(
      (match) =>
        match.status === "missed"
    ).length;

  const restDayCount =
    plannedSessions.filter(
      isRestSession
    ).length;

  const completedDistanceKm =
    runs.reduce(
      (sum, run) =>
        sum + getRunDistanceKm(run),
      0
    );

  const plannedDistanceSummary =
    getPlannedDistanceSummary(
      plannedSessions
    );

  const plannedDistanceKm =
    plannedDistanceSummary.hasDistanceTargets
      ? (
          plannedDistanceSummary.minimumKm +
          plannedDistanceSummary.maximumKm
        ) / 2
      : null;

  const distanceDifferenceKm =
    plannedDistanceKm !== null
      ? completedDistanceKm -
        plannedDistanceKm
      : null;

  const distanceCompletionPercentage =
    plannedDistanceKm !== null &&
    plannedDistanceKm > 0
      ? Math.round(
          (completedDistanceKm /
            plannedDistanceKm) *
            100
        )
      : null;

  const completionScore =
    calculateCompletionScore(
      dueMatches
    );

  const distanceScore =
    plannedDistanceKm !== null &&
    plannedDistanceKm > 0
      ? clamp(
          100 -
            Math.abs(
              (completedDistanceKm -
                plannedDistanceKm) /
                plannedDistanceKm
            ) *
              160,
          0,
          100
        )
      : null;

  const qualityScore =
    calculateCategoryScore(
      plannedSessions,
      matches,
      isQualitySession
    );

  const easyScore =
    calculateCategoryScore(
      plannedSessions,
      matches,
      isEasySession
    );

  const longRunScore =
    calculateCategoryScore(
      plannedSessions,
      matches,
      isLongRunSession
    );

  const recoveryScore =
    calculateCategoryScore(
      plannedSessions,
      matches,
      isRecoverySession
    );

  const categoryScores: TrainingCategoryScore[] =
    [
      {
        key: "completion",
        label: "Session completion",
        score: completionScore,
        context:
          completionScore === null
            ? "No sessions are due yet."
            : `${completedSessionCount} completed, ${partialSessionCount} partial and ${missedSessionCount} missed.`,
      },
      {
        key: "distance",
        label: "Distance accuracy",
        score:
          distanceScore === null
            ? null
            : Math.round(
                distanceScore
              ),
        context:
          plannedDistanceKm === null
            ? "The coach plan does not contain enough numerical distance targets."
            : `${round(
                completedDistanceKm
              )} km completed against approximately ${round(
                plannedDistanceKm
              )} km planned.`,
      },
      {
        key: "quality",
        label: "Quality sessions",
        score: qualityScore,
        context:
          qualityScore === null
            ? "No quality session has been assessed yet."
            : `${getScoreLabel(
                qualityScore
              )} execution across due quality work.`,
      },
      {
        key: "easy",
        label: "Easy running",
        score: easyScore,
        context:
          easyScore === null
            ? "No easy session has been assessed yet."
            : `${getScoreLabel(
                easyScore
              )} adherence to easy and steady sessions.`,
      },
      {
        key: "longRun",
        label: "Long run",
        score: longRunScore,
        context:
          longRunScore === null
            ? "The weekly long run has not yet been assessed."
            : `${getScoreLabel(
                longRunScore
              )} long-run execution.`,
      },
      {
        key: "recovery",
        label: "Recovery compliance",
        score: recoveryScore,
        context:
          recoveryScore === null
            ? "No recovery session has been assessed yet."
            : `${getScoreLabel(
                recoveryScore
              )} recovery-session adherence.`,
      },
    ];

  const weightedCategories = [
    {
      score: completionScore,
      weight: 0.3,
    },
    {
      score:
        distanceScore === null
          ? null
          : Math.round(distanceScore),
      weight: 0.2,
    },
    {
      score: qualityScore,
      weight: 0.2,
    },
    {
      score: longRunScore,
      weight: 0.15,
    },
    {
      score: easyScore,
      weight: 0.08,
    },
    {
      score: recoveryScore,
      weight: 0.07,
    },
  ].filter(
    (
      category
    ): category is {
      score: number;
      weight: number;
    } => category.score !== null
  );

  const availableWeight =
    weightedCategories.reduce(
      (sum, category) =>
        sum + category.weight,
      0
    );

  const score =
    availableWeight > 0
      ? Math.round(
          weightedCategories.reduce(
            (sum, category) =>
              sum +
              category.score *
                category.weight,
            0
          ) / availableWeight
        )
      : null;

  const strengths = buildStrengths(
    categoryScores,
    dueMatches,
    completedDistanceKm,
    plannedDistanceKm
  );

  const concerns = buildConcerns(
    categoryScores,
    dueMatches,
    completedDistanceKm,
    plannedDistanceKm
  );

  return {
    score,
    label: getScoreLabel(score),
    tone: getScoreTone(score),

    plannedSessionCount:
      plannedSessions.length,

    dueSessionCount:
      dueMatches.length,

    completedSessionCount,
    partialSessionCount,
    missedSessionCount,
    restDayCount,

    plannedDistanceKm:
      plannedDistanceKm === null
        ? null
        : round(plannedDistanceKm),

    completedDistanceKm:
      round(completedDistanceKm),

    distanceDifferenceKm:
      distanceDifferenceKm === null
        ? null
        : round(distanceDifferenceKm),

    distanceCompletionPercentage,

    categoryScores,

    strengths,
    concerns,

    summary: buildSummary(
      score,
      completedSessionCount,
      partialSessionCount,
      missedSessionCount,
      strengths,
      concerns
    ),
  };
}
