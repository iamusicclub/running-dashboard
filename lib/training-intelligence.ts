import type {
  ManualSessionStatus,
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

export type TrainingCategoryStatus =
  | "completed"
  | "partial"
  | "missed"
  | "awaiting"
  | "not-applicable";

export type TrainingCategoryAssessment = {
  key:
    | "completion"
    | "distance"
    | "quality"
    | "easy"
    | "longRun"
    | "recovery";
  label: string;
  status: TrainingCategoryStatus;
  statusLabel: string;
  context: string;
};

export type WeeklyTrainingAssessment = {
  label: string;
  tone: TrainingInsightTone;

  plannedSessionCount: number;
  dueSessionCount: number;
  reviewedSessionCount: number;
  unreviewedSessionCount: number;
  completedSessionCount: number;
  partialSessionCount: number;
  missedSessionCount: number;
  restDayCount: number;

  plannedDistanceKm: number | null;
  completedDistanceKm: number;
  distanceDifferenceKm: number | null;
  distanceCompletionPercentage: number | null;

  categoryAssessments: TrainingCategoryAssessment[];

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

type ManualStatusCounts = {
  completed: number;
  partial: number;
  missed: number;
  awaiting: number;
  reviewed: number;
  total: number;
};

function round(value: number, decimals = 1) {
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
    typeof run.distanceMeters ===
      "number" &&
    Number.isFinite(
      run.distanceMeters
    ) &&
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

  const text =
    `${session.title} ${session.rawText}`.toLowerCase();

  return (
    type === "long-run" ||
    text.includes("long run") ||
    text.includes("long-run") ||
    (
      session.distance.maximumKm !==
        null &&
      session.distance.maximumKm >= 18
    )
  );
}

function isQualitySession(
  session: MatchablePlannedSession
) {
  return [
    "tempo",
    "threshold",
    "interval",
    "intervals",
    "marathon-pace",
    "race",
  ].includes(
    normaliseType(
      session.sessionType
    )
  );
}

function isEasySession(
  session: MatchablePlannedSession
) {
  return [
    "easy",
    "steady",
  ].includes(
    normaliseType(
      session.sessionType
    )
  );
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

function toDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(
      date.getMonth() + 1
    ).padStart(2, "0"),
    String(
      date.getDate()
    ).padStart(2, "0"),
  ].join("-");
}

function getDueTrainingMatches(
  matches: SessionMatchResult[],
  today: Date
) {
  const todayKey = toDateKey(today);

  return matches.filter(
    (match) =>
      !isRestSession(
        match.plannedSession
      ) &&
      match.plannedDate <= todayKey
  );
}

function getManualStatusCounts(
  matches: SessionMatchResult[]
): ManualStatusCounts {
  const counts: ManualStatusCounts = {
    completed: 0,
    partial: 0,
    missed: 0,
    awaiting: 0,
    reviewed: 0,
    total: matches.length,
  };

  matches.forEach((match) => {
    const status =
      match.manualStatus;

    if (status === "completed") {
      counts.completed += 1;
      counts.reviewed += 1;
      return;
    }

    if (status === "partial") {
      counts.partial += 1;
      counts.reviewed += 1;
      return;
    }

    if (status === "missed") {
      counts.missed += 1;
      counts.reviewed += 1;
      return;
    }

    counts.awaiting += 1;
  });

  return counts;
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

function getCategoryStatus(
  counts: ManualStatusCounts
): TrainingCategoryStatus {
  if (counts.total === 0) {
    return "not-applicable";
  }

  if (counts.reviewed === 0) {
    return "awaiting";
  }

  if (
    counts.missed === 0 &&
    counts.partial === 0 &&
    counts.awaiting === 0
  ) {
    return "completed";
  }

  if (
    counts.completed === 0 &&
    counts.partial === 0 &&
    counts.awaiting === 0
  ) {
    return "missed";
  }

  return "partial";
}

function getCategoryStatusLabel(
  status: TrainingCategoryStatus
) {
  const labels: Record<
    TrainingCategoryStatus,
    string
  > = {
    completed: "Completed",
    partial: "Mixed",
    missed: "Missed",
    awaiting: "Awaiting review",
    "not-applicable": "Not due",
  };

  return labels[status];
}

function formatStatusContext(
  counts: ManualStatusCounts,
  emptyText: string
) {
  if (counts.total === 0) {
    return emptyText;
  }

  if (counts.reviewed === 0) {
    return `${counts.total} due session${
      counts.total === 1 ? "" : "s"
    } awaiting a manual status.`;
  }

  const parts = [
    counts.completed > 0
      ? `${counts.completed} completed`
      : null,
    counts.partial > 0
      ? `${counts.partial} partial`
      : null,
    counts.missed > 0
      ? `${counts.missed} missed`
      : null,
    counts.awaiting > 0
      ? `${counts.awaiting} awaiting review`
      : null,
  ].filter(
    (part): part is string =>
      part !== null
  );

  return `${parts.join(", ")}.`;
}

function buildCategoryAssessment(
  key:
    TrainingCategoryAssessment["key"],
  label: string,
  matches: SessionMatchResult[],
  emptyText: string
): TrainingCategoryAssessment {
  const counts =
    getManualStatusCounts(matches);

  const status =
    getCategoryStatus(counts);

  return {
    key,
    label,
    status,
    statusLabel:
      getCategoryStatusLabel(status),
    context: formatStatusContext(
      counts,
      emptyText
    ),
  };
}

function getDistanceStatus(
  plannedDistanceKm: number | null,
  completedDistanceKm: number,
  reviewedCount: number
): TrainingCategoryStatus {
  if (
    plannedDistanceKm === null ||
    plannedDistanceKm <= 0
  ) {
    return "not-applicable";
  }

  if (reviewedCount === 0) {
    return "awaiting";
  }

  const percentage =
    (
      completedDistanceKm /
      plannedDistanceKm
    ) * 100;

  if (
    percentage >= 90 &&
    percentage <= 115
  ) {
    return "completed";
  }

  if (percentage < 50) {
    return "missed";
  }

  return "partial";
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

function pluraliseSessions(
  count: number
) {
  return `${count} session${
    count === 1 ? "" : "s"
  }`;
}

function buildStrengths(
  counts: ManualStatusCounts,
  categoryAssessments:
    TrainingCategoryAssessment[],
  completedDistanceKm: number,
  plannedDistanceKm: number | null
) {
  const strengths: TrainingInsight[] =
    [];

  if (
    counts.reviewed > 0 &&
    counts.completed ===
      counts.reviewed &&
    counts.awaiting === 0
  ) {
    strengths.push(
      createInsight(
        "all-due-sessions-completed",
        "All due sessions completed",
        `${pluraliseSessions(
          counts.completed
        )} have been manually marked as completed.`,
        "positive",
        100
      )
    );
  } else if (counts.completed > 0) {
    strengths.push(
      createInsight(
        "completed-sessions",
        "Training completed",
        `${pluraliseSessions(
          counts.completed
        )} have been manually marked as completed.`,
        "positive",
        80 + counts.completed
      )
    );
  }

  const completedCategories =
    categoryAssessments.filter(
      (category) =>
        ![
          "completion",
          "distance",
        ].includes(category.key) &&
        category.status === "completed"
    );

  completedCategories.forEach(
    (category) => {
      strengths.push(
        createInsight(
          `strength-${category.key}`,
          `${category.label} completed`,
          category.context,
          "positive",
          85
        )
      );
    }
  );

  if (
    plannedDistanceKm !== null &&
    plannedDistanceKm > 0
  ) {
    const percentage =
      (
        completedDistanceKm /
        plannedDistanceKm
      ) * 100;

    if (
      percentage >= 90 &&
      percentage <= 115
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
  counts: ManualStatusCounts,
  categoryAssessments:
    TrainingCategoryAssessment[],
  completedDistanceKm: number,
  plannedDistanceKm: number | null
) {
  const concerns: TrainingInsight[] =
    [];

  if (counts.missed > 0) {
    concerns.push(
      createInsight(
        "missed-sessions",
        "Sessions were missed",
        `${pluraliseSessions(
          counts.missed
        )} have been manually marked as missed.`,
        counts.missed >= 2
          ? "critical"
          : "warning",
        100 + counts.missed
      )
    );
  }

  if (counts.partial > 0) {
    concerns.push(
      createInsight(
        "partial-sessions",
        "Sessions were only partly completed",
        `${pluraliseSessions(
          counts.partial
        )} have been manually marked as partial.`,
        "warning",
        85 + counts.partial
      )
    );
  }

  const missedCategories =
    categoryAssessments.filter(
      (category) =>
        ![
          "completion",
          "distance",
        ].includes(category.key) &&
        category.status === "missed"
    );

  missedCategories.forEach(
    (category) => {
      concerns.push(
        createInsight(
          `concern-${category.key}`,
          `${category.label} was missed`,
          category.context,
          "warning",
          90
        )
      );
    }
  );

  if (
    plannedDistanceKm !== null &&
    plannedDistanceKm > 0
  ) {
    const percentageDifference =
      (
        (
          completedDistanceKm -
          plannedDistanceKm
        ) /
        plannedDistanceKm
      ) * 100;

    if (percentageDifference < -15) {
      concerns.push(
        createInsight(
          "weekly-volume-shortfall",
          "Weekly volume is below plan",
          `${round(
            Math.abs(
              percentageDifference
            ),
            0
          )}% less distance has been completed than planned.`,
          percentageDifference < -30
            ? "critical"
            : "warning",
          Math.abs(
            percentageDifference
          )
        )
      );
    }

    if (percentageDifference > 20) {
      concerns.push(
        createInsight(
          "weekly-volume-excess",
          "Weekly volume is above plan",
          `${round(
            percentageDifference,
            0
          )}% more distance has been completed than planned.`,
          "warning",
          percentageDifference
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

function getOverallVerdict(
  counts: ManualStatusCounts
): {
  label: string;
  tone: TrainingInsightTone;
} {
  if (
    counts.total === 0 ||
    counts.reviewed === 0
  ) {
    return {
      label: "Awaiting review",
      tone: "neutral",
    };
  }

  if (
    counts.missed === 0 &&
    counts.partial === 0
  ) {
    return {
      label:
        counts.awaiting > 0
          ? "On track so far"
          : "On track",
      tone: "positive",
    };
  }

  if (
    counts.missed === 0 &&
    counts.partial > 0
  ) {
    return {
      label: "Mostly on track",
      tone: "neutral",
    };
  }

  if (
    counts.missed >= 2 ||
    counts.missed >
      counts.completed
  ) {
    return {
      label: "Needs attention",
      tone: "critical",
    };
  }

  return {
    label: "Mixed week",
    tone: "warning",
  };
}

function buildSummary(
  counts: ManualStatusCounts,
  label: string,
  strengths: TrainingInsight[],
  concerns: TrainingInsight[]
) {
  if (counts.total === 0) {
    return "No training sessions are due yet, so there is nothing to assess.";
  }

  if (counts.reviewed === 0) {
    return `${pluraliseSessions(
      counts.total
    )} are due, but none has been manually reviewed yet.`;
  }

  let summary =
    `${label}: ${counts.completed} completed, ${counts.partial} partial and ${counts.missed} missed.`;

  if (counts.awaiting > 0) {
    summary += ` ${pluraliseSessions(
      counts.awaiting
    )} still ${
      counts.awaiting === 1
        ? "requires"
        : "require"
    } a manual status.`;
  }

  if (strengths.length > 0) {
    summary += ` The clearest positive is ${strengths[0].title.toLowerCase()}.`;
  }

  if (concerns.length > 0) {
    summary += ` The main concern is ${concerns[0].title.toLowerCase()}.`;
  }

  return summary;
}

function getMatchesForCategory(
  dueMatches: SessionMatchResult[],
  predicate: (
    session: MatchablePlannedSession
  ) => boolean
) {
  return dueMatches.filter((match) =>
    predicate(match.plannedSession)
  );
}

export function buildWeeklyTrainingAssessment({
  runs,
  plannedSessions,
  matches,
  today = new Date(),
}: RunAnalysisInput): WeeklyTrainingAssessment {
  const dueMatches =
    getDueTrainingMatches(
      matches,
      today
    );

  const counts =
    getManualStatusCounts(
      dueMatches
    );

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
          (
            completedDistanceKm /
            plannedDistanceKm
          ) * 100
        )
      : null;

  const completionAssessment =
    buildCategoryAssessment(
      "completion",
      "Session completion",
      dueMatches,
      "No training sessions are due yet."
    );

  const distanceStatus =
    getDistanceStatus(
      plannedDistanceKm,
      completedDistanceKm,
      counts.reviewed
    );

  const distanceAssessment:
    TrainingCategoryAssessment = {
      key: "distance",
      label: "Weekly distance",
      status: distanceStatus,
      statusLabel:
        getCategoryStatusLabel(
          distanceStatus
        ),
      context:
        plannedDistanceKm === null
          ? "The coach plan does not contain enough numerical distance targets."
          : `${round(
              completedDistanceKm
            )} km completed against approximately ${round(
              plannedDistanceKm
            )} km planned.`,
    };

  const categoryAssessments:
    TrainingCategoryAssessment[] = [
      completionAssessment,
      distanceAssessment,
      buildCategoryAssessment(
        "quality",
        "Quality sessions",
        getMatchesForCategory(
          dueMatches,
          isQualitySession
        ),
        "No quality session is due yet."
      ),
      buildCategoryAssessment(
        "easy",
        "Easy running",
        getMatchesForCategory(
          dueMatches,
          isEasySession
        ),
        "No easy or steady session is due yet."
      ),
      buildCategoryAssessment(
        "longRun",
        "Long run",
        getMatchesForCategory(
          dueMatches,
          isLongRunSession
        ),
        "The weekly long run is not due yet."
      ),
      buildCategoryAssessment(
        "recovery",
        "Recovery running",
        getMatchesForCategory(
          dueMatches,
          isRecoverySession
        ),
        "No recovery session is due yet."
      ),
    ];

  const strengths = buildStrengths(
    counts,
    categoryAssessments,
    completedDistanceKm,
    plannedDistanceKm
  );

  const concerns = buildConcerns(
    counts,
    categoryAssessments,
    completedDistanceKm,
    plannedDistanceKm
  );

  const verdict =
    getOverallVerdict(counts);

  return {
    label: verdict.label,
    tone: verdict.tone,

    plannedSessionCount:
      plannedSessions.filter(
        (session) =>
          !isRestSession(session)
      ).length,

    dueSessionCount:
      dueMatches.length,

    reviewedSessionCount:
      counts.reviewed,

    unreviewedSessionCount:
      counts.awaiting,

    completedSessionCount:
      counts.completed,

    partialSessionCount:
      counts.partial,

    missedSessionCount:
      counts.missed,

    restDayCount:
      plannedSessions.filter(
        isRestSession
      ).length,

    plannedDistanceKm:
      plannedDistanceKm === null
        ? null
        : round(
            plannedDistanceKm
          ),

    completedDistanceKm:
      round(completedDistanceKm),

    distanceDifferenceKm:
      distanceDifferenceKm === null
        ? null
        : round(
            distanceDifferenceKm
          ),

    distanceCompletionPercentage,

    categoryAssessments,

    strengths,
    concerns,

    summary: buildSummary(
      counts,
      verdict.label,
      strengths,
      concerns
    ),
  };
}

export function isManualSessionStatus(
  value: unknown
): value is Exclude<
  ManualSessionStatus,
  null
> {
  return (
    value === "completed" ||
    value === "partial" ||
    value === "missed"
  );
}
