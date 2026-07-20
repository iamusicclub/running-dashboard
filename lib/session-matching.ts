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
  unverifiedCount: number;
  completionPercentage: number;
  averageExecutionScore: number | null;
};

type PaceRange = {
  fastestSecondsPerKm: number;
  slowestSecondsPerKm: number;
};

const MS_PER_DAY = 86_400_000;

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimalPlaces = 0) {
  const multiplier = 10 ** decimalPlaces;
  return Math.round(value * multiplier) / multiplier;
}

function normaliseText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function getTodayDateKey() {
  const today = new Date();

  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}

function getRunDateKey(run: MatchableRun) {
  return run.date?.slice(0, 10) ?? "";
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

function getWeightedAveragePace(runs: MatchableRun[]) {
  const usableRuns = runs.filter(
    (run) =>
      getRunDistanceKm(run) > 0 &&
      getRunTimeSeconds(run) > 0
  );

  if (usableRuns.length === 0) {
    return null;
  }

  const totalDistanceKm = usableRuns.reduce(
    (sum, run) => sum + getRunDistanceKm(run),
    0
  );

  const totalTimeSeconds = usableRuns.reduce(
    (sum, run) => sum + getRunTimeSeconds(run),
    0
  );

  if (totalDistanceKm <= 0 || totalTimeSeconds <= 0) {
    return null;
  }

  return totalTimeSeconds / totalDistanceKm;
}

function formatDistance(distanceKm: number) {
  return `${round(distanceKm, 1).toFixed(1)} km`;
}

function formatPace(secondsPerKm: number) {
  const roundedSeconds = Math.round(secondsPerKm);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

function normaliseSessionType(value: string) {
  const text = normaliseText(value);

  if (!text) {
    return "other";
  }

  if (text.includes("rest")) {
    return "rest";
  }

  if (
    text.includes("interval") ||
    text.includes("repetition") ||
    text.includes("reps") ||
    text.includes("vo2")
  ) {
    return "interval";
  }

  if (text.includes("threshold")) {
    return "threshold";
  }

  if (text.includes("tempo")) {
    return "tempo";
  }

  if (
    text.includes("marathon pace") ||
    text === "mp" ||
    text.includes("race pace")
  ) {
    return "marathon-pace";
  }

  if (text.includes("long")) {
    return "long-run";
  }

  if (text.includes("recovery")) {
    return "recovery";
  }

  if (
    text.includes("progressive") ||
    text.includes("progression") ||
    text.includes("steady")
  ) {
    return "steady";
  }

  if (
    text.includes("easy") ||
    text.includes("aerobic")
  ) {
    return "easy";
  }

  if (
    text.includes("race") ||
    text.includes("parkrun")
  ) {
    return "race";
  }

  if (
    text.includes("cross") ||
    text.includes("bike") ||
    text.includes("cycle") ||
    text.includes("swim")
  ) {
    return "cross-training";
  }

  return text;
}

function classifyRun(run: MatchableRun) {

  const recordedType =
    normaliseSessionType(
      run.runType
    );

  const recognisedTypes =
    new Set([
      "recovery",
      "easy",
      "steady",
      "tempo",
      "threshold",
      "interval",
      "marathon-pace",
      "long-run",
      "race",
      "cross-training",
    ]);

  if (
    recognisedTypes.has(
      recordedType
    )
  ) {
    return recordedType;
  }

  const distanceKm = getRunDistanceKm(run);

  const paceSecondsPerKm =

    getRunPaceSecondsPerKm(run);

  const usableLaps = (run.laps || []).filter(

    (lap) =>

      typeof lap.distance === "number" &&

      lap.distance > 0 &&

      (typeof lap.moving_time === "number" ||

        typeof lap.elapsed_time === "number")

  );

  const lapPaces = usableLaps

    .map((lap) => {

      const distanceKm =

        (lap.distance || 0) / 1000;

      const timeSeconds =

        lap.moving_time ||

        lap.elapsed_time ||

        0;

      if (

        distanceKm <= 0 ||

        timeSeconds <= 0

      ) {

        return null;

      }

      return timeSeconds / distanceKm;

    })

    .filter(

      (pace): pace is number =>

        pace !== null &&

        Number.isFinite(pace)

    );

  if (lapPaces.length >= 4) {

    const fastestLap = Math.min(

      ...lapPaces

    );

    const slowestLap = Math.max(

      ...lapPaces

    );

    const paceVariation =

      slowestLap - fastestLap;

    if (paceVariation >= 45) {

      return "interval";

    }

    if (

      paceVariation >= 20 &&

      distanceKm >= 8

    ) {

      return "steady";

    }

  }

  if (distanceKm >= 18) {

    return "long-run";

  }

  if (

    typeof run.workoutType === "number"

  ) {

    /*

      Strava workout-type values vary by

      activity source, so this is deliberately

      conservative. A populated workout type

      supports a structured-session classification

      without relying on the activity title.

    */

    if (

      run.workoutType === 3 ||

      run.workoutType === 11

    ) {

      return "interval";

    }

    if (

      run.workoutType === 1 ||

      run.workoutType === 2

    ) {

      return "race";

    }

  }

  if (

    paceSecondsPerKm !== null &&

    paceSecondsPerKm <= 250 &&

    distanceKm >= 8

  ) {

    return "steady";

  }

  if (

    paceSecondsPerKm !== null &&

    paceSecondsPerKm >= 300

  ) {

    return "recovery";

  }

  return "easy";

}

function sessionTypesAreCompatible(
  plannedType: string,
  actualType: string
) {
  if (plannedType === actualType) {
    return true;
  }

  const compatibleGroups = [
    ["easy", "recovery"],
    ["tempo", "threshold"],
    ["steady", "marathon-pace"],
    ["race", "tempo", "threshold"],
  ];

  return compatibleGroups.some(
    (group) =>
      group.includes(plannedType) &&
      group.includes(actualType)
  );
}

function scoreDistance(
  session: MatchablePlannedSession,
  completedDistanceKm: number
): SessionMatchComponent {
  const minimumKm = session.distance.minimumKm;
  const maximumKm = session.distance.maximumKm;

  if (minimumKm === null && maximumKm === null) {
    return {
      key: "distance",
      label: "Distance",
      score: 0,
      available: false,
      explanation:
        "No numerical distance target was available.",
    };
  }

  if (completedDistanceKm <= 0) {
    return {
      key: "distance",
      label: "Distance",
      score: 0,
      available: true,
      explanation: "No completed distance was recorded.",
    };
  }

  const lowerBound = minimumKm ?? maximumKm ?? 0;
  const upperBound = maximumKm ?? minimumKm ?? lowerBound;

  if (
    completedDistanceKm >= lowerBound &&
    completedDistanceKm <= upperBound
  ) {
    return {
      key: "distance",
      label: "Distance",
      score: 100,
      available: true,
      explanation: `${formatDistance(
        completedDistanceKm
      )} was within the planned range.`,
    };
  }

  if (completedDistanceKm < lowerBound) {
    const completionRatio =
      lowerBound > 0
        ? completedDistanceKm / lowerBound
        : 0;

    return {
      key: "distance",
      label: "Distance",
      score: Math.round(clamp(completionRatio * 100)),
      available: true,
      explanation: `${formatDistance(
        completedDistanceKm
      )} was ${formatDistance(
        lowerBound - completedDistanceKm
      )} below the planned minimum.`,
    };
  }

  const excessKm = completedDistanceKm - upperBound;
  const excessRatio =
    upperBound > 0 ? excessKm / upperBound : 0;

  return {
    key: "distance",
    label: "Distance",
    score: Math.round(clamp(100 - excessRatio * 60, 40, 100)),
    available: true,
    explanation: `${formatDistance(
      completedDistanceKm
    )} was ${formatDistance(
      excessKm
    )} above the planned maximum.`,
  };
}

function parsePaceValue(minutes: string, seconds: string) {
  const parsedMinutes = Number(minutes);
  const parsedSeconds = Number(seconds);

  if (
    !Number.isFinite(parsedMinutes) ||
    !Number.isFinite(parsedSeconds)
  ) {
    return null;
  }

  return parsedMinutes * 60 + parsedSeconds;
}

function extractPaceRange(
  targetPaceText: string | null
): PaceRange | null {
  if (!targetPaceText) {
    return null;
  }

  const matches = Array.from(
    targetPaceText.matchAll(/(\d{1,2}):(\d{2})/g)
  )
    .map((match) => parsePaceValue(match[1], match[2]))
    .filter(
      (value): value is number =>
        value !== null
    );

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return {
      fastestSecondsPerKm: matches[0] - 5,
      slowestSecondsPerKm: matches[0] + 5,
    };
  }

  return {
    fastestSecondsPerKm: Math.min(...matches),
    slowestSecondsPerKm: Math.max(...matches),
  };
}

function scorePace(
  session: MatchablePlannedSession,
  matchedRuns: MatchableRun[]
): SessionMatchComponent {
  const paceRange = extractPaceRange(
    session.targetPaceText
  );

  if (!paceRange) {
    return {
      key: "pace",
      label: "Pace",
      score: 0,
      available: false,
      explanation:
        "No numerical pace target was available.",
    };
  }

  const actualPace = getWeightedAveragePace(matchedRuns);

  if (actualPace === null) {
    return {
      key: "pace",
      label: "Pace",
      score: 0,
      available: false,
      explanation:
        "The matched activity did not contain enough data to calculate pace.",
    };
  }

  if (
    actualPace >= paceRange.fastestSecondsPerKm &&
    actualPace <= paceRange.slowestSecondsPerKm
  ) {
    return {
      key: "pace",
      label: "Pace",
      score: 100,
      available: true,
      explanation: `${formatPace(
        actualPace
      )} was within the planned pace range.`,
    };
  }

  const deviation =
    actualPace < paceRange.fastestSecondsPerKm
      ? paceRange.fastestSecondsPerKm - actualPace
      : actualPace - paceRange.slowestSecondsPerKm;

  const direction =
    actualPace < paceRange.fastestSecondsPerKm
      ? "faster"
      : "slower";

  return {
    key: "pace",
    label: "Pace",
    score: Math.round(clamp(100 - deviation * 2.5, 25, 100)),
    available: true,
    explanation: `${formatPace(
      actualPace
    )} was approximately ${Math.round(
      deviation
    )} sec/km ${direction} than planned.`,
  };
}

function scoreSessionType(
  session: MatchablePlannedSession,
  matchedRuns: MatchableRun[]
): SessionMatchComponent {
  if (session.isRestDay) {
    return {
      key: "session-type",
      label: "Recovery compliance",
      score: matchedRuns.length === 0 ? 100 : 20,
      available: true,
      explanation:
        matchedRuns.length === 0
          ? "No run was recorded on the planned rest day."
          : "Running activity was recorded on the planned rest day.",
    };
  }

  if (matchedRuns.length === 0) {
    return {
      key: "session-type",
      label: "Session type",
      score: 0,
      available: true,
      explanation: "No matching activity was found.",
    };
  }

  const plannedType = normaliseSessionType(
    session.sessionType
  );

  const actualTypes = matchedRuns.map(classifyRun);

  if (actualTypes.includes(plannedType)) {
    return {
      key: "session-type",
      label: "Session type",
      score: 100,
      available: true,
      explanation:
        "The recorded workout type matched the planned session.",
    };
  }

  if (
    actualTypes.some((actualType) =>
      sessionTypesAreCompatible(plannedType, actualType)
    )
  ) {
    return {
      key: "session-type",
      label: "Session type",
      score: 78,
      available: true,
      explanation:
        "The recorded workout provided a broadly similar training stimulus.",
    };
  }

  if (
    plannedType === "long-run" &&
    matchedRuns.some((run) => getRunDistanceKm(run) >= 16)
  ) {
    return {
      key: "session-type",
      label: "Session type",
      score: 82,
      available: true,
      explanation:
        "The recorded distance supports classification as a long run.",
    };
  }

  return {
    key: "session-type",
    label: "Session type",
    score: 45,
    available: true,
    explanation:
      "A run was completed, but the recorded workout type did not clearly match the plan.",
  };
}

function calculateExecutionScore(
  components: SessionMatchComponent[]
) {
  const weights: Record<
    SessionMatchComponentKey,
    number
  > = {
    distance: 0.45,
    "session-type": 0.35,
    pace: 0.2,
    structure: 0,
    "heart-rate": 0,
  };

  const availableComponents = components.filter(
    (component) =>
      component.available &&
      weights[component.key] > 0
  );

  if (availableComponents.length === 0) {
    return null;
  }

  const totalWeight = availableComponents.reduce(
    (sum, component) =>
      sum + weights[component.key],
    0
  );

  const weightedScore = availableComponents.reduce(
    (sum, component) =>
      sum +
      component.score * weights[component.key],
    0
  );

  return Math.round(weightedScore / totalWeight);
}

function getStatusLabel(status: SessionMatchStatus) {
  const labels: Record<SessionMatchStatus, string> = {
    completed: "Completed",
    partial: "Partially completed",
    missed: "Missed",
    rest: "Rest observed",
    upcoming: "Upcoming",
    unverified: "Awaiting verification",
  };

  return labels[status];
}

function getSessionStatus(
  session: MatchablePlannedSession,
  matchedRuns: MatchableRun[],
  score: number | null
): SessionMatchStatus {
  const today = getTodayDateKey();

  if (session.plannedDate > today) {
    return "upcoming";
  }

  if (session.isRestDay) {
    return matchedRuns.length === 0
      ? "rest"
      : "partial";
  }

  if (
    session.plannedDate === today &&
    matchedRuns.length === 0
  ) {
    return "unverified";
  }

  if (matchedRuns.length === 0) {
    return "missed";
  }

  if (score === null) {
    return "unverified";
  }

  if (score >= 70) {
    return "completed";
  }

  return "partial";
}

function buildVerdict(
  status: SessionMatchStatus,
  score: number | null
) {
  if (status === "upcoming") {
    return {
      verdict: "Session not yet due",
      detail:
        "This session will be assessed after its planned date.",
    };
  }

  if (status === "rest") {
    return {
      verdict: "Recovery instruction followed",
      detail:
        "No running activity was recorded on the planned rest day.",
    };
  }

  if (status === "unverified") {
    return {
      verdict: "Session awaiting verification",
      detail:
        "The session is scheduled for today or cannot yet be assessed reliably.",
    };
  }

  if (status === "missed") {
    return {
      verdict: "Planned session not detected",
      detail:
        "No matching running activity was found for the planned date.",
    };
  }

  if (score !== null && score >= 90) {
    return {
      verdict: `Excellent execution (${score}%)`,
      detail:
        "The completed activity aligned closely with the coach's plan.",
    };
  }

  if (score !== null && score >= 80) {
    return {
      verdict: `Strong execution (${score}%)`,
      detail:
        "The main requirements of the planned session were achieved.",
    };
  }

  if (score !== null && score >= 70) {
    return {
      verdict: `Session completed (${score}%)`,
      detail:
        "The session was completed with some variation from the plan.",
    };
  }

  return {
    verdict:
      score === null
        ? "Activity requires review"
        : `Partial execution (${score}%)`,
    detail:
      "A run was recorded, but it did not sufficiently match the planned distance, pace or workout type.",
  };
}

function getRunsForSessionDate(
  session: MatchablePlannedSession,
  runs: MatchableRun[]
) {
  return runs.filter(
    (run) =>
      getRunDateKey(run) ===
      session.plannedDate
  );
}

function getSessionTimingDetail(
  session: MatchablePlannedSession,
  matchedRuns: MatchableRun[]
) {
  const matchedRun =
    matchedRuns[0] || null;

  if (!matchedRun) {
    return null;
  }

  const daysDifference =
    getSignedDaysBetweenDates(
      getRunDateKey(matchedRun),
      session.plannedDate
    );

  if (
    daysDifference === null ||
    daysDifference === 0
  ) {
    return null;
  }

  const absoluteDays =
    Math.abs(daysDifference);

  const dayLabel =
    absoluteDays === 1
      ? "day"
      : "days";

  return daysDifference > 0
    ? `Completed ${absoluteDays} ${dayLabel} later than planned.`
    : `Completed ${absoluteDays} ${dayLabel} earlier than planned.`;
}

type CandidateRunMatch = {
  run: MatchableRun;
  executionScore: number;
  dateDistance: number;
  candidateScore: number;
};

function parseDateKey(value: string) {
  const match = value
    .slice(0, 10)
    .match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(
    year,
    month - 1,
    day
  );

  date.setHours(0, 0, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function getSignedDaysBetweenDates(
  laterDate: string,
  earlierDate: string
) {
  const later = parseDateKey(laterDate);
  const earlier = parseDateKey(
    earlierDate
  );

  if (!later || !earlier) {
    return null;
  }

  return Math.round(
    (later.getTime() -
      earlier.getTime()) /
      MS_PER_DAY
  );
}

function getMatchingWindowDays(
  session: MatchablePlannedSession
) {
  const sessionType =
    normaliseSessionType(
      session.sessionType
    );

  if (
    sessionType === "long-run" ||
    sessionType === "race"
  ) {
    return 2;
  }

  if (
    sessionType === "interval" ||
    sessionType === "threshold" ||
    sessionType === "tempo" ||
    sessionType === "marathon-pace"
  ) {
    return 3;
  }

  return 2;
}

function isRunEligibleForSession(
  session: MatchablePlannedSession,
  run: MatchableRun
) {
  const runDate = getRunDateKey(run);

  const daysDifference =
    getSignedDaysBetweenDates(
      runDate,
      session.plannedDate
    );

  if (daysDifference === null) {
    return false;
  }

  return (
    Math.abs(daysDifference) <=
    getMatchingWindowDays(session)
  );
}

function scoreCandidateRun(
  session: MatchablePlannedSession,
  run: MatchableRun
): CandidateRunMatch {
  const completedDistanceKm =
    getRunDistanceKm(run);

  const components: SessionMatchComponent[] =
    [
      scoreDistance(
        session,
        completedDistanceKm
      ),
      scoreSessionType(
        session,
        [run]
      ),
      scorePace(session, [run]),
    ];

  const executionScore =
    calculateExecutionScore(
      components
    ) ?? 0;

  const dateDifference =
    getSignedDaysBetweenDates(
      getRunDateKey(run),
      session.plannedDate
    );

  const dateDistance =
    dateDifference === null
      ? 99
      : Math.abs(dateDifference);

  /*
    Execution quality is the primary factor.
    Date proximity is only a tie-breaker.

    A perfect run one day late should beat a
    weak run completed on the planned day.
  */
  const timingPenalty =
    dateDistance * 4;

  return {
    run,
    executionScore,
    dateDistance,
    candidateScore:
      executionScore -
      timingPenalty,
  };
}

function selectBestRunForSession(
  session: MatchablePlannedSession,
  runs: MatchableRun[],
  usedRunIds: Set<string>
) {
  const candidates = runs
    .filter(
      (run) =>
        !usedRunIds.has(run.id) &&
        isRunEligibleForSession(
          session,
          run
        )
    )
    .map((run) =>
      scoreCandidateRun(
        session,
        run
      )
    )
    .filter(
      (candidate) =>
        candidate.executionScore >= 40
    )
    .sort((first, second) => {
      if (
        second.candidateScore !==
        first.candidateScore
      ) {
        return (
          second.candidateScore -
          first.candidateScore
        );
      }

      if (
        first.dateDistance !==
        second.dateDistance
      ) {
        return (
          first.dateDistance -
          second.dateDistance
        );
      }

      return (
        second.executionScore -
        first.executionScore
      );
    });

  return candidates[0] || null;
}

export function matchSessionToRuns(
  session: MatchablePlannedSession,
  allRuns: MatchableRun[]
): SessionMatchResult {
  const matchedRuns = getRunsForSessionDate(
    session,
    allRuns
  );

  const completedDistanceKm = round(
    matchedRuns.reduce(
      (sum, run) => sum + getRunDistanceKm(run),
      0
    ),
    2
  );

  const plannedMinimumDistanceKm =
    session.distance.minimumKm;

  const plannedMaximumDistanceKm =
    session.distance.maximumKm;

  const distanceDifferenceKm =
    plannedMinimumDistanceKm === null
      ? null
      : round(
          completedDistanceKm -
            plannedMinimumDistanceKm,
          2
        );

  const components: SessionMatchComponent[] =
    session.isRestDay
      ? [scoreSessionType(session, matchedRuns)]
      : [
          scoreDistance(
            session,
            completedDistanceKm
          ),
          scoreSessionType(
            session,
            matchedRuns
          ),
          scorePace(session, matchedRuns),
        ];

  const executionScore = session.isRestDay
    ? matchedRuns.length === 0
      ? 100
      : 20
    : matchedRuns.length === 0
    ? 0
    : calculateExecutionScore(components);

  const status = getSessionStatus(
    session,
    matchedRuns,
    executionScore
  );

  const displayedScore =
    status === "upcoming" ||
    status === "unverified"
      ? null
      : executionScore;

  const verdict = buildVerdict(
  status,
  displayedScore
);

const timingDetail =
  getSessionTimingDetail(
    session,
    matchedRuns
  );

const resultDetail =
  timingDetail &&
  (status === "completed" ||
    status === "partial")
    ? `${verdict.detail} ${timingDetail}`
    : verdict.detail;

  return {
    sessionId: session.id,
    plannedDate: session.plannedDate,
    status,
    statusLabel: getStatusLabel(status),
    score: displayedScore,
    verdict: verdict.verdict,
    detail: resultDetail,

    plannedSession: session,
    matchedRuns,
    matchedRunIds: matchedRuns.map((run) => run.id),

    completedDistanceKm,
    plannedMinimumDistanceKm,
    plannedMaximumDistanceKm,
    distanceDifferenceKm,

    components,
  };
}

export function matchTrainingWeek(
  sessions: MatchablePlannedSession[],
  runs: MatchableRun[]
): SessionMatchResult[] {
  const sortedSessions = sessions
    .slice()
    .sort((first, second) => {
      /*
        Allocate key sessions first so an easy
        run cannot consume the best candidate for
        a marathon-pace, interval or long session.
      */
      if (
        first.isKeySession !==
        second.isKeySession
      ) {
        return first.isKeySession
          ? -1
          : 1;
      }

      return first.plannedDate.localeCompare(
        second.plannedDate
      );
    });

  const usedRunIds =
    new Set<string>();

  const resultsBySessionId =
    new Map<
      string,
      SessionMatchResult
    >();

  for (const session of sortedSessions) {
        const today = getTodayDateKey();

    if (session.plannedDate > today) {
      const result =
        matchSessionToRuns(
          session,
          []
        );

      resultsBySessionId.set(
        session.id,
        result
      );

      continue;
    }
    
    if (session.isRestDay) {
      const result =
        matchSessionToRuns(
          session,
          runs
        );

      resultsBySessionId.set(
        session.id,
        result
      );

      continue;
    }
    const bestCandidate =
      selectBestRunForSession(
        session,
        runs,
        usedRunIds
      );

    const candidateRuns =
      bestCandidate
        ? [bestCandidate.run]
        : [];

    if (bestCandidate) {
      usedRunIds.add(
        bestCandidate.run.id
      );
    }

    /*
      Passing only the selected candidate means
      matchSessionToRuns can continue performing
      the detailed distance, pace and type scoring
      without changing its public interface.
    */
    const candidateDateSession:
      MatchablePlannedSession =
      bestCandidate
        ? {
            ...session,
            plannedDate:
              getRunDateKey(
                bestCandidate.run
              ),
          }
        : session;

    const rawResult =
      matchSessionToRuns(
        candidateDateSession,
        candidateRuns
      );

    const timingDetail =
      getSessionTimingDetail(
        session,
        candidateRuns
      );

    const result: SessionMatchResult =
      {
        ...rawResult,
        sessionId: session.id,
        plannedDate:
          session.plannedDate,
        plannedSession: session,
        detail:
          timingDetail &&
          (rawResult.status ===
            "completed" ||
            rawResult.status ===
              "partial")
            ? `${rawResult.detail} ${timingDetail}`
            : rawResult.detail,
      };

    resultsBySessionId.set(
      session.id,
      result
    );
  }

  return sessions
    .slice()
    .sort((first, second) =>
      first.plannedDate.localeCompare(
        second.plannedDate
      )
    )
    .map(
      (session) =>
        resultsBySessionId.get(
          session.id
        ) ??
        matchSessionToRuns(
          session,
          []
        )
    );
}

export function calculateWeekExecution(
  matches: SessionMatchResult[]
): WeekExecution {
  const dueTrainingMatches = matches.filter(
    (match) =>
      match.status !== "upcoming" &&
      match.status !== "unverified" &&
      !match.plannedSession.isRestDay
  );

  const completedCount = dueTrainingMatches.filter(
    (match) => match.status === "completed"
  ).length;

  const partialCount = dueTrainingMatches.filter(
    (match) => match.status === "partial"
  ).length;

  const missedCount = dueTrainingMatches.filter(
    (match) => match.status === "missed"
  ).length;

  const restCount = matches.filter(
    (match) => match.status === "rest"
  ).length;

  const upcomingCount = matches.filter(
    (match) => match.status === "upcoming"
  ).length;

  const unverifiedCount = matches.filter(
    (match) => match.status === "unverified"
  ).length;

  const scoredMatches = matches.filter(
    (
      match
    ): match is SessionMatchResult & {
      score: number;
    } =>
      typeof match.score === "number" &&
      Number.isFinite(match.score) &&
      !match.plannedSession.isRestDay
  );

  const averageExecutionScore =
    scoredMatches.length === 0
      ? null
      : Math.round(
          scoredMatches.reduce(
            (sum, match) => sum + match.score,
            0
          ) / scoredMatches.length
        );

  const completionPercentage =
    dueTrainingMatches.length === 0
      ? 0
      : Math.round(
          (completedCount /
            dueTrainingMatches.length) *
            100
        );

  return {
    plannedCount: matches.length,
    dueCount: dueTrainingMatches.length,
    completedCount,
    partialCount,
    missedCount,
    restCount,
    upcomingCount,
    unverifiedCount,
    completionPercentage,
    averageExecutionScore,
  };
}

export function getDaysBetweenDates(
  firstDate: string,
  secondDate: string
) {
  const first = new Date(`${firstDate.slice(0, 10)}T12:00:00`);
  const second = new Date(`${secondDate.slice(0, 10)}T12:00:00`);

  if (
    Number.isNaN(first.getTime()) ||
    Number.isNaN(second.getTime())
  ) {
    return null;
  }

  return Math.round(
    Math.abs(
      first.getTime() - second.getTime()
    ) / MS_PER_DAY
  );
}
