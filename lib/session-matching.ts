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

export type ManualSessionStatus =
  | "completed"
  | "partial"
  | "missed"
  | null;

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
  manualStatus: ManualSessionStatus;
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
};

type PaceRange = {
  fastestSecondsPerKm: number;
  slowestSecondsPerKm: number;
};

type CandidateRunMatch = {
  session: MatchablePlannedSession;
  run: MatchableRun;
  compatibilityScore: number;
  sessionTypeScore: number;
  dateDifference: number;
  dateDistance: number;
  assignmentScore: number;
};

type AssignmentState = {
  totalScore: number;
  assignments: Map<string, MatchableRun>;
};

const MS_PER_DAY = 86_400_000;

const RECOGNISED_SESSION_TYPES = new Set([
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

function clamp(
  value: number,
  minimum = 0,
  maximum = 100
) {
  return Math.min(
    maximum,
    Math.max(minimum, value)
  );
}

function round(
  value: number,
  decimalPlaces = 0
) {
  const multiplier =
    10 ** decimalPlaces;

  return (
    Math.round(value * multiplier) /
    multiplier
  );
}

function normaliseText(
  value: string | null | undefined
) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[ââ]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function getTodayDateKey() {
  const today = new Date();

  return [
    today.getFullYear(),
    String(
      today.getMonth() + 1
    ).padStart(2, "0"),
    String(
      today.getDate()
    ).padStart(2, "0"),
  ].join("-");
}

function getRunDateKey(
  run: MatchableRun
) {
  return run.date?.slice(0, 10) ?? "";
}

function parseDateKey(
  value: string
) {
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
  const later =
    parseDateKey(laterDate);

  const earlier =
    parseDateKey(earlierDate);

  if (!later || !earlier) {
    return null;
  }

  return Math.round(
    (
      later.getTime() -
      earlier.getTime()
    ) / MS_PER_DAY
  );
}

function parseTimeToSeconds(
  value: string
) {
  if (!value) {
    return null;
  }

  const parts = value
    .trim()
    .split(":")
    .map((part) =>
      Number(part)
    );

  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some(
      (part) =>
        !Number.isFinite(part)
    )
  ) {
    return null;
  }

  if (parts.length === 2) {
    return (
      parts[0] * 60 +
      parts[1]
    );
  }

  return (
    parts[0] * 3600 +
    parts[1] * 60 +
    parts[2]
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
    return (
      run.distanceMeters / 1000
    );
  }

  const parsedDistance =
    Number.parseFloat(
      run.distance ?? ""
    );

  return (
    Number.isFinite(
      parsedDistance
    ) &&
    parsedDistance > 0
      ? parsedDistance
      : 0
  );
}

function getRunTimeSeconds(
  run: MatchableRun
) {
  if (
    typeof run.movingTimeSeconds ===
      "number" &&
    Number.isFinite(
      run.movingTimeSeconds
    ) &&
    run.movingTimeSeconds > 0
  ) {
    return run.movingTimeSeconds;
  }

  return (
    parseTimeToSeconds(
      run.time
    ) ?? 0
  );
}

function getRunPaceSecondsPerKm(
  run: MatchableRun
) {
  if (
    typeof run.paceSecondsPerKm ===
      "number" &&
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

  return (
    timeSeconds / distanceKm
  );
}

function getWeightedAveragePace(
  runs: MatchableRun[]
) {
  const usableRuns =
    runs.filter(
      (run) =>
        getRunDistanceKm(run) >
          0 &&
        getRunTimeSeconds(run) >
          0
    );

  if (
    usableRuns.length === 0
  ) {
    return null;
  }

  const totalDistanceKm =
    usableRuns.reduce(
      (sum, run) =>
        sum +
        getRunDistanceKm(run),
      0
    );

  const totalTimeSeconds =
    usableRuns.reduce(
      (sum, run) =>
        sum +
        getRunTimeSeconds(run),
      0
    );

  if (
    totalDistanceKm <= 0 ||
    totalTimeSeconds <= 0
  ) {
    return null;
  }

  return (
    totalTimeSeconds /
    totalDistanceKm
  );
}

type DistanceComponent = {
  minimumKm: number;
  maximumKm: number;
  startIndex: number;
  endIndex: number;
  description: string;
};

function extractDistanceComponents(
  rawText: string
): DistanceComponent[] {
  const text = rawText
    .toLowerCase()
    .replace(/[ââ]/g, "-");

  const expression =
    /(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)(?:\s*(?:\/|-|to)\s*(\d+(?:\.\d+)?))?\s*km\b/g;

  const matches =
    Array.from(
      text.matchAll(expression)
    );

  return matches.map(
    (match, index) => {
      const multiplier =
        match[1]
          ? Number(match[1])
          : 1;

      const first =
        Number(match[2]);

      const second =
        match[3]
          ? Number(match[3])
          : first;

      const startIndex =
        match.index ?? 0;

      const endIndex =
        index + 1 <
        matches.length
          ? matches[index + 1]
              .index ??
            text.length
          : text.length;

      return {
        minimumKm:
          Math.min(
            first,
            second
          ) * multiplier,
        maximumKm:
          Math.max(
            first,
            second
          ) * multiplier,
        startIndex,
        endIndex,
        description:
          text.slice(
            startIndex,
            endIndex
          ),
      };
    }
  );
}

function getTargetBlockBoundaries(
  session: MatchablePlannedSession
) {
  const components =
    extractDistanceComponents(
      session.rawText
    );

  if (components.length < 2) {
    return null;
  }

  const targetIndex =
    components.findIndex(
      (component) =>
        /\b(?:mp|m\s*pace|marathon\s*pace|tempo|threshold|10k\s*(?:pace|effort)|5k\s*(?:pace|effort)|hm\s*(?:pace|effort))\b/.test(
          component.description
        ) ||
        /\d{1,2}:\d{2}/.test(
          component.description
        )
    );

  if (targetIndex < 0) {
    return null;
  }

  const distanceBeforeKm =
    components
      .slice(0, targetIndex)
      .reduce(
        (sum, component) =>
          sum +
          component.maximumKm,
        0
      );

  const distanceAfterKm =
    components
      .slice(targetIndex + 1)
      .reduce(
        (sum, component) =>
          sum +
          component.maximumKm,
        0
      );

  return {
    distanceBeforeKm,
    distanceAfterKm,
    targetMinimumKm:
      components[targetIndex]
        .minimumKm,
    targetMaximumKm:
      components[targetIndex]
        .maximumKm,
  };
}

function getStructuredTargetPace(
  session: MatchablePlannedSession,
  matchedRuns: MatchableRun[]
) {
  if (matchedRuns.length !== 1) {
    return null;
  }

  const boundaries =
    getTargetBlockBoundaries(
      session
    );

  const run = matchedRuns[0];
  const laps = run.laps || [];

  if (
    !boundaries ||
    laps.length === 0
  ) {
    return null;
  }

  const runDistanceKm =
    getRunDistanceKm(run);

  const blockStartKm =
    boundaries.distanceBeforeKm;

  const blockEndKm =
    runDistanceKm -
    boundaries.distanceAfterKm;

  const blockDistanceKm =
    blockEndKm -
    blockStartKm;

  if (
    blockDistanceKm <= 0 ||
    blockDistanceKm <
      boundaries.targetMinimumKm -
        0.25 ||
    blockDistanceKm >
      boundaries.targetMaximumKm +
        0.25
  ) {
    return null;
  }

  let cursorKm = 0;
  let targetDistanceKm = 0;
  let targetTimeSeconds = 0;

  for (const lap of laps) {
    if (
      typeof lap.distance !==
        "number" ||
      lap.distance <= 0
    ) {
      continue;
    }

    const timeSeconds =
      typeof lap.moving_time ===
        "number" &&
      lap.moving_time > 0
        ? lap.moving_time
        : typeof lap.elapsed_time ===
              "number" &&
            lap.elapsed_time > 0
          ? lap.elapsed_time
          : 0;

    const lapDistanceKm =
      lap.distance / 1000;

    const lapStartKm = cursorKm;
    const lapEndKm =
      cursorKm + lapDistanceKm;

    cursorKm = lapEndKm;

    if (timeSeconds <= 0) {
      continue;
    }

    const overlapKm =
      Math.max(
        0,
        Math.min(
          lapEndKm,
          blockEndKm
        ) -
          Math.max(
            lapStartKm,
            blockStartKm
          )
      );

    if (overlapKm <= 0) {
      continue;
    }

    targetDistanceKm +=
      overlapKm;

    targetTimeSeconds +=
      timeSeconds *
      (overlapKm /
        lapDistanceKm);
  }

  if (
    targetDistanceKm <
      blockDistanceKm - 0.25 ||
    targetTimeSeconds <= 0
  ) {
    return null;
  }

  return {
    paceSecondsPerKm:
      targetTimeSeconds /
      targetDistanceKm,
    distanceKm:
      targetDistanceKm,
  };
}

function getLapPaces(
  run: MatchableRun
) {
  return (run.laps || [])
    .map((lap) => {
      if (
        typeof lap.distance !==
          "number" ||
        lap.distance <= 0
      ) {
        return null;
      }

      const timeSeconds =
        typeof lap.moving_time ===
          "number" &&
        lap.moving_time > 0
          ? lap.moving_time
          : typeof lap.elapsed_time ===
                "number" &&
              lap.elapsed_time > 0
            ? lap.elapsed_time
            : 0;

      if (timeSeconds <= 0) {
        return null;
      }

      return (
        timeSeconds /
        (lap.distance / 1000)
      );
    })
    .filter(
      (
        pace
      ): pace is number =>
        pace !== null &&
        Number.isFinite(pace)
    );
}

function formatDistance(
  distanceKm: number
) {
  return `${round(
    distanceKm,
    1
  ).toFixed(1)} km`;
}

function formatPace(
  secondsPerKm: number
) {
  const roundedSeconds =
    Math.round(secondsPerKm);

  const minutes =
    Math.floor(
      roundedSeconds / 60
    );

  const seconds =
    roundedSeconds % 60;

  return `${minutes}:${String(
    seconds
  ).padStart(2, "0")}/km`;
}

function normaliseSessionType(
  value: string
) {
  const text =
    normaliseText(value);

  if (!text) {
    return "other";
  }

  if (text.includes("rest")) {
    return "rest";
  }

  if (
    text.includes("interval") ||
    text.includes(
      "repetition"
    ) ||
    text.includes("reps") ||
    text.includes("vo2")
  ) {
    return "interval";
  }

  if (
    text.includes("threshold")
  ) {
    return "threshold";
  }

  if (text.includes("tempo")) {
    return "tempo";
  }

  if (
    text.includes(
      "marathon pace"
    ) ||
    text === "mp" ||
    text.includes("race pace")
  ) {
    return "marathon-pace";
  }

  if (text.includes("long")) {
    return "long-run";
  }

  if (
    text.includes("recovery") ||
    text.includes("rec run") ||
    text.includes("rec pace")
  ) {
    return "recovery";
  }

  if (
    text.includes(
      "progressive"
    ) ||
    text.includes(
      "progression"
    ) ||
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

function classifyRun(
  run: MatchableRun
) {
  const recordedType =
    normaliseSessionType(
      run.runType
    );

  const distanceKm =
    getRunDistanceKm(run);

  const paceSecondsPerKm =
    getRunPaceSecondsPerKm(
      run
    );

  if (
    recordedType ===
    "recovery"
  ) {
    return "recovery";
  }

  if (
    recordedType === "easy"
  ) {
    if (
      paceSecondsPerKm !==
        null &&
      paceSecondsPerKm >= 300
    ) {
      return "recovery";
    }

    return "easy";
  }

  if (
    RECOGNISED_SESSION_TYPES.has(
      recordedType
    )
  ) {
    return recordedType;
  }

  const lapPaces =
    getLapPaces(run);

  if (lapPaces.length >= 4) {
    const fastestLap =
      Math.min(...lapPaces);

    const slowestLap =
      Math.max(...lapPaces);

    const paceVariation =
      slowestLap -
      fastestLap;

    if (
      paceVariation >= 45
    ) {
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
    typeof run.workoutType ===
    "number"
  ) {
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
  if (
    plannedType === actualType
  ) {
    return true;
  }

  const compatibleGroups = [
    ["easy", "recovery"],
    ["tempo", "threshold"],
    [
      "steady",
      "marathon-pace",
    ],
    [
      "race",
      "tempo",
      "threshold",
    ],
  ];

  return compatibleGroups.some(
    (group) =>
      group.includes(
        plannedType
      ) &&
      group.includes(actualType)
  );
}

function scoreDistance(
  session: MatchablePlannedSession,
  completedDistanceKm: number
): SessionMatchComponent {
  const minimumKm =
    session.distance.minimumKm;

  const maximumKm =
    session.distance.maximumKm;

  if (
    minimumKm === null &&
    maximumKm === null
  ) {
    return {
      key: "distance",
      label: "Distance",
      score: 0,
      available: false,
      explanation:
        "No numerical distance target was available.",
    };
  }

  if (
    completedDistanceKm <= 0
  ) {
    return {
      key: "distance",
      label: "Distance",
      score: 0,
      available: true,
      explanation:
        "No completed distance was recorded.",
    };
  }

  const lowerBound =
    minimumKm ??
    maximumKm ??
    0;

  const upperBound =
    maximumKm ??
    minimumKm ??
    lowerBound;

  const toleranceKm = 0.05;

  if (
    completedDistanceKm >=
      lowerBound -
        toleranceKm &&
    completedDistanceKm <=
      upperBound +
        toleranceKm
  ) {
    return {
      key: "distance",
      label: "Distance",
      score: 100,
      available: true,
      explanation: `${formatDistance(
        completedDistanceKm
      )} matched the planned distance.`,
    };
  }

  if (
    completedDistanceKm <
    lowerBound
  ) {
    const completionRatio =
      lowerBound > 0
        ? completedDistanceKm /
          lowerBound
        : 0;

    return {
      key: "distance",
      label: "Distance",
      score: Math.round(
        clamp(
          completionRatio * 100
        )
      ),
      available: true,
      explanation: `${formatDistance(
        completedDistanceKm
      )} was ${formatDistance(
        lowerBound -
          completedDistanceKm
      )} below the planned minimum.`,
    };
  }

  const excessKm =
    completedDistanceKm -
    upperBound;

  const excessRatio =
    upperBound > 0
      ? excessKm /
        upperBound
      : 0;

  return {
    key: "distance",
    label: "Distance",
    score: Math.round(
      clamp(
        100 -
          excessRatio * 60,
        40,
        100
      )
    ),
    available: true,
    explanation: `${formatDistance(
      completedDistanceKm
    )} was ${formatDistance(
      excessKm
    )} above the planned maximum.`,
  };
}

function parsePaceValue(
  minutes: string,
  seconds: string
) {
  const parsedMinutes =
    Number(minutes);

  const parsedSeconds =
    Number(seconds);

  if (
    !Number.isFinite(
      parsedMinutes
    ) ||
    !Number.isFinite(
      parsedSeconds
    )
  ) {
    return null;
  }

  return (
    parsedMinutes * 60 +
    parsedSeconds
  );
}

function extractPaceRange(
  targetPaceText:
    | string
    | null
): PaceRange | null {
  if (!targetPaceText) {
    return null;
  }

  const matches = Array.from(
    targetPaceText.matchAll(
      /(\d{1,2}):(\d{2})/g
    )
  )
    .map((match) =>
      parsePaceValue(
        match[1],
        match[2]
      )
    )
    .filter(
      (
        value
      ): value is number =>
        value !== null
    );

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return {
      fastestSecondsPerKm:
        matches[0] - 5,
      slowestSecondsPerKm:
        matches[0] + 5,
    };
  }

  return {
    fastestSecondsPerKm:
      Math.min(...matches),

    slowestSecondsPerKm:
      Math.max(...matches),
  };
}

function scorePace(
  session: MatchablePlannedSession,
  matchedRuns: MatchableRun[]
): SessionMatchComponent {
  const plannedType =
    normaliseSessionType(
      session.sessionType
    );

  const paceRange =
    extractPaceRange(
      session.targetPaceText
    );

  const structuredTarget =
    paceRange &&
    (
      plannedType ===
        "marathon-pace" ||
      plannedType === "tempo" ||
      plannedType ===
        "threshold"
    )
      ? getStructuredTargetPace(
          session,
          matchedRuns
        )
      : null;

  const actualPace =
    structuredTarget
      ?.paceSecondsPerKm ??
    getWeightedAveragePace(
      matchedRuns
    );

  const paceContext =
    structuredTarget
      ? ` across the ${formatDistance(
          structuredTarget.distanceKm
        )} target block`
      : "";

  if (!paceRange) {
    if (
      plannedType ===
        "recovery" &&
      actualPace !== null
    ) {
      const recoveryThreshold =
        300;

      if (
        actualPace >=
        recoveryThreshold
      ) {
        return {
          key: "pace",
          label: "Pace",
          score: 100,
          available: true,
          explanation: `${formatPace(
            actualPace
          )} was consistent with recovery pace.`,
        };
      }

      const deviation =
        recoveryThreshold -
        actualPace;

      return {
        key: "pace",
        label: "Pace",
        score: Math.round(
          clamp(
            100 -
              deviation * 2.5,
            40,
            100
          )
        ),
        available: true,
        explanation: `${formatPace(
          actualPace
        )} was approximately ${Math.round(
          deviation
        )} sec/km faster than the recovery threshold.`,
      };
    }

    return {
      key: "pace",
      label: "Pace",
      score: 0,
      available: false,
      explanation:
        "No numerical pace target was available.",
    };
  }

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
    actualPace >=
      paceRange.fastestSecondsPerKm &&
    actualPace <=
      paceRange.slowestSecondsPerKm
  ) {
    return {
      key: "pace",
      label: "Pace",
      score: 100,
      available: true,
      explanation: `${formatPace(
        actualPace
      )}${paceContext} was within the planned pace range.`,
    };
  }

  const deviation =
    actualPace <
    paceRange.fastestSecondsPerKm
      ? paceRange.fastestSecondsPerKm -
        actualPace
      : actualPace -
        paceRange.slowestSecondsPerKm;

  const direction =
    actualPace <
    paceRange.fastestSecondsPerKm
      ? "faster"
      : "slower";

  return {
    key: "pace",
    label: "Pace",
    score: Math.round(
      clamp(
        100 -
          deviation * 2.5,
        25,
        100
      )
    ),
    available: true,
    explanation: `${formatPace(
      actualPace
    )}${paceContext} was approximately ${Math.round(
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
      label:
        "Recovery compliance",
      score:
        matchedRuns.length === 0
          ? 100
          : 20,
      available: true,
      explanation:
        matchedRuns.length === 0
          ? "No run was recorded on the planned rest day."
          : "Running activity was recorded on the planned rest day.",
    };
  }

  if (
    matchedRuns.length === 0
  ) {
    return {
      key: "session-type",
      label: "Session type",
      score: 0,
      available: true,
      explanation:
        "No matching activity was found.",
    };
  }

  const plannedType =
    normaliseSessionType(
      session.sessionType
    );

  const actualTypes =
    matchedRuns.map(
      classifyRun
    );

  if (
    actualTypes.includes(
      plannedType
    )
  ) {
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
    actualTypes.some(
      (actualType) =>
        sessionTypesAreCompatible(
          plannedType,
          actualType
        )
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
    plannedType ===
      "long-run" &&
    matchedRuns.some(
      (run) =>
        getRunDistanceKm(run) >=
        16
    )
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

function calculateCompatibilityScore(
  components: SessionMatchComponent[]
) {
  const availableComponents =
    components.filter(
      (component) =>
        component.available
    );

  if (
    availableComponents.length === 0
  ) {
    return 0;
  }

  const total =
    availableComponents.reduce(
      (sum, component) =>
        sum + component.score,
      0
    );

  return Math.round(
    total /
      availableComponents.length
  );
}

function getStatusLabel(
  status: SessionMatchStatus
) {
  const labels: Record<
    SessionMatchStatus,
    string
  > = {
    completed: "Completed",
    partial:
      "Partially completed",
    missed: "Missed",
    rest: "Rest observed",
    upcoming: "Upcoming",
    unverified:
      "Awaiting verification",
  };

  return labels[status];
}

function getSessionStatus(
  session: MatchablePlannedSession,
  matchedRuns: MatchableRun[]
): SessionMatchStatus {
  const today =
    getTodayDateKey();

  if (
    session.plannedDate >
    today
  ) {
    return "upcoming";
  }

  if (session.isRestDay) {
    return matchedRuns.length ===
      0
      ? "rest"
      : "partial";
  }

  if (
    session.plannedDate ===
      today &&
    matchedRuns.length === 0
  ) {
    return "unverified";
  }

  if (
    matchedRuns.length === 0
  ) {
    return "missed";
  }

  return "completed";
}

function buildVerdict(
  status: SessionMatchStatus
) {
  switch (status) {
    case "completed":
      return {
        verdict: "Activity matched",
        detail:
          "A completed activity has been matched to the planned session.",
      };

    case "partial":
      return {
        verdict:
          "Review required",
        detail:
          "Activity was recorded, but the planned rest or session structure requires review.",
      };

    case "missed":
      return {
        verdict: "No activity matched",
        detail:
          "No suitable activity was matched to this planned session.",
      };

    case "rest":
      return {
        verdict: "Rest day observed",
        detail:
          "No running activity was recorded on the planned rest day.",
      };

    case "upcoming":
      return {
        verdict: "Upcoming",
        detail:
          "This session has not yet taken place.",
      };

    case "unverified":
    default:
      return {
        verdict:
          "Awaiting verification",
        detail:
          "Completion has not yet been confirmed.",
      };
  }
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
    matchedRuns[0] ?? null;

  if (!matchedRun) {
    return null;
  }

  const daysDifference =
    getSignedDaysBetweenDates(
      getRunDateKey(
        matchedRun
      ),
      session.plannedDate
    );

  if (
    daysDifference === null ||
    daysDifference === 0
  ) {
    return null;
  }

  const absoluteDays =
    Math.abs(
      daysDifference
    );

  const dayLabel =
    absoluteDays === 1
      ? "day"
      : "days";

  return daysDifference > 0
    ? `Completed ${absoluteDays} ${dayLabel} later than planned.`
    : `Completed ${absoluteDays} ${dayLabel} earlier than planned.`;
}

function buildComponents(
  session: MatchablePlannedSession,
  matchedRuns: MatchableRun[]
): SessionMatchComponent[] {
  if (session.isRestDay) {
    return [
      scoreSessionType(
        session,
        matchedRuns
      ),
    ];
  }

  const completedDistanceKm =
    matchedRuns.reduce(
      (sum, run) =>
        sum +
        getRunDistanceKm(run),
      0
    );

  return [
    scoreDistance(
      session,
      completedDistanceKm
    ),
    scoreSessionType(
      session,
      matchedRuns
    ),
    scorePace(
      session,
      matchedRuns
    ),
  ];
}

function buildSessionMatchResult(
  session: MatchablePlannedSession,
  matchedRuns: MatchableRun[]
): SessionMatchResult {
  const completedDistanceKm =
    round(
      matchedRuns.reduce(
        (sum, run) =>
          sum +
          getRunDistanceKm(
            run
          ),
        0
      ),
      2
    );

  const plannedMinimumDistanceKm =
    session.distance.minimumKm;

  const plannedMaximumDistanceKm =
    session.distance.maximumKm;

  const distanceDifferenceKm =
    plannedMinimumDistanceKm ===
    null
      ? null
      : round(
          completedDistanceKm -
            plannedMinimumDistanceKm,
          2
        );

  const components =
    buildComponents(
      session,
      matchedRuns
    );

  const status =
    getSessionStatus(
      session,
      matchedRuns
    );

  const verdict =
    buildVerdict(status);

  const timingDetail =
    getSessionTimingDetail(
      session,
      matchedRuns
    );

  const detail =
    timingDetail &&
    (
      status === "completed" ||
      status === "partial"
    )
      ? `${verdict.detail} ${timingDetail}`
      : verdict.detail;

  return {
    sessionId: session.id,
    plannedDate:
      session.plannedDate,
    status,
    statusLabel:
      getStatusLabel(status),
    manualStatus: null,
    verdict: verdict.verdict,
    detail,

    plannedSession: session,
    matchedRuns,
    matchedRunIds:
      matchedRuns.map(
        (run) => run.id
      ),

    completedDistanceKm,
    plannedMinimumDistanceKm,
    plannedMaximumDistanceKm,
    distanceDifferenceKm,

    components,
  };
}

function getMatchingWindowDays(
  session: MatchablePlannedSession
) {
  const sessionType =
    normaliseSessionType(
      session.sessionType
    );

  if (
    sessionType ===
      "long-run" ||
    sessionType === "race"
  ) {
    return 2;
  }

  if (
    sessionType ===
      "interval" ||
    sessionType ===
      "threshold" ||
    sessionType === "tempo" ||
    sessionType ===
      "marathon-pace"
  ) {
    return 3;
  }

  return 2;
}

function isRunWithinWindow(
  session: MatchablePlannedSession,
  run: MatchableRun
) {
  const daysDifference =
    getSignedDaysBetweenDates(
      getRunDateKey(run),
      session.plannedDate
    );

  if (
    daysDifference === null
  ) {
    return false;
  }

  return (
    Math.abs(
      daysDifference
    ) <=
    getMatchingWindowDays(
      session
    )
  );
}

function scoreCandidateRun(
  session: MatchablePlannedSession,
  run: MatchableRun
): CandidateRunMatch | null {
  const runDate =
    getRunDateKey(run);

  const dateDifference =
    getSignedDaysBetweenDates(
      runDate,
      session.plannedDate
    );

  if (
    dateDifference === null
  ) {
    return null;
  }

  const components =
    buildComponents(
      session,
      [run]
    );

  const compatibilityScore =
    calculateCompatibilityScore(
      components
    );

  const sessionTypeComponent =
    components.find(
      (component) =>
        component.key ===
        "session-type"
    );

  const sessionTypeScore =
    sessionTypeComponent?.score ??
    0;

  const dateDistance =
    Math.abs(
      dateDifference
    );

  const isExactDate =
    dateDistance === 0;

  if (
    !isExactDate &&
    sessionTypeScore < 70
  ) {
    return null;
  }

  if (
    compatibilityScore < 40
  ) {
    return null;
  }

  const exactDateBonus =
    isExactDate ? 20 : 0;

  const timingPenalty =
    dateDistance * 6;

  const assignmentScore =
    compatibilityScore +
    exactDateBonus -
    timingPenalty;

  return {
    session,
    run,
    compatibilityScore,
    sessionTypeScore,
    dateDifference,
    dateDistance,
    assignmentScore,
  };
}

function buildCandidateMap(
  sessions:
    MatchablePlannedSession[],
  runs: MatchableRun[]
) {
  const candidateMap =
    new Map<
      string,
      CandidateRunMatch[]
    >();

  const today =
    getTodayDateKey();

  const eligibleRuns =
    runs.filter((run) => {
      const runDate =
        getRunDateKey(run);

      return (
        Boolean(runDate) &&
        runDate <= today
      );
    });

  for (const session of sessions) {
    const candidates =
      eligibleRuns
        .filter((run) =>
          isRunWithinWindow(
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
          (
            candidate
          ): candidate is CandidateRunMatch =>
            candidate !== null
        )
        .sort(
          (first, second) => {
            if (
              second.assignmentScore !==
              first.assignmentScore
            ) {
              return (
                second.assignmentScore -
                first.assignmentScore
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
              second.compatibilityScore -
              first.compatibilityScore
            );
          }
        );

    candidateMap.set(
      session.id,
      candidates
    );
  }

  return candidateMap;
}

function solveGlobalAssignment(
  sessions:
    MatchablePlannedSession[],
  candidateMap: Map<
    string,
    CandidateRunMatch[]
  >
) {
  let bestState: AssignmentState =
    {
      totalScore:
        Number.NEGATIVE_INFINITY,
      assignments: new Map(),
    };

  function search(
    sessionIndex: number,
    usedRunIds: Set<string>,
    assignments: Map<
      string,
      MatchableRun
    >,
    totalScore: number
  ) {
    if (
      sessionIndex >=
      sessions.length
    ) {
      if (
        totalScore >
        bestState.totalScore
      ) {
        bestState = {
          totalScore,
          assignments:
            new Map(assignments),
        };
      }

      return;
    }

    const session =
      sessions[sessionIndex];

    const candidates =
      candidateMap.get(
        session.id
      ) ?? [];

    search(
      sessionIndex + 1,
      usedRunIds,
      assignments,
      totalScore
    );

    for (
      const candidate of candidates
    ) {
      if (
        usedRunIds.has(
          candidate.run.id
        )
      ) {
        continue;
      }

      usedRunIds.add(
        candidate.run.id
      );

      assignments.set(
        session.id,
        candidate.run
      );

      search(
        sessionIndex + 1,
        usedRunIds,
        assignments,
        totalScore +
          candidate.assignmentScore
      );

      assignments.delete(
        session.id
      );

      usedRunIds.delete(
        candidate.run.id
      );
    }
  }

  search(
    0,
    new Set<string>(),
    new Map<
      string,
      MatchableRun
    >(),
    0
  );

  return bestState.assignments;
}

export function matchSessionToRuns(
  session: MatchablePlannedSession,
  allRuns: MatchableRun[]
): SessionMatchResult {
  const matchedRuns =
    getRunsForSessionDate(
      session,
      allRuns
    );

  return buildSessionMatchResult(
    session,
    matchedRuns
  );
}

export function matchTrainingWeek(
  sessions:
    MatchablePlannedSession[],
  runs: MatchableRun[]
): SessionMatchResult[] {
  const today =
    getTodayDateKey();

  const orderedSessions =
    sessions
      .slice()
      .sort((first, second) =>
        first.plannedDate.localeCompare(
          second.plannedDate
        )
      );

  const assignableSessions =
    orderedSessions.filter(
      (session) =>
        !session.isRestDay &&
        session.plannedDate <=
          today
    );

  const candidateMap =
    buildCandidateMap(
      assignableSessions,
      runs
    );

  const assignments =
    solveGlobalAssignment(
      assignableSessions,
      candidateMap
    );

  return orderedSessions.map(
    (session) => {
      if (
        session.plannedDate >
        today
      ) {
        return buildSessionMatchResult(
          session,
          []
        );
      }

      if (session.isRestDay) {
        const restDayRuns =
          getRunsForSessionDate(
            session,
            runs
          );

        return buildSessionMatchResult(
          session,
          restDayRuns
        );
      }

      const matchedRun =
        assignments.get(
          session.id
        );

      return buildSessionMatchResult(
        session,
        matchedRun
          ? [matchedRun]
          : []
      );
    }
  );
}

export function calculateWeekExecution(
  matches: SessionMatchResult[]
): WeekExecution {
  const dueTrainingMatches =
    matches.filter(
      (match) =>
        match.status !==
          "upcoming" &&
        match.status !==
          "unverified" &&
        !match.plannedSession
          .isRestDay
    );

  const completedCount =
    dueTrainingMatches.filter(
      (match) =>
        match.status ===
        "completed"
    ).length;

  const partialCount =
    dueTrainingMatches.filter(
      (match) =>
        match.status ===
        "partial"
    ).length;

  const missedCount =
    dueTrainingMatches.filter(
      (match) =>
        match.status ===
        "missed"
    ).length;

  const restCount =
    matches.filter(
      (match) =>
        match.status === "rest"
    ).length;

  const upcomingCount =
    matches.filter(
      (match) =>
        match.status ===
        "upcoming"
    ).length;

  const unverifiedCount =
    matches.filter(
      (match) =>
        match.status ===
        "unverified"
    ).length;

  const completionPercentage =
    dueTrainingMatches.length ===
    0
      ? 0
      : Math.round(
          (
            completedCount /
            dueTrainingMatches.length
          ) * 100
        );

  return {
    plannedCount:
      matches.length,
    dueCount:
      dueTrainingMatches.length,
    completedCount,
    partialCount,
    missedCount,
    restCount,
    upcomingCount,
    unverifiedCount,
    completionPercentage,
  };
}

export function getDaysBetweenDates(
  firstDate: string,
  secondDate: string
) {
  const first =
    parseDateKey(
      firstDate
    );

  const second =
    parseDateKey(
      secondDate
    );

  if (!first || !second) {
    return null;
  }

  return Math.round(
    Math.abs(
      first.getTime() -
        second.getTime()
    ) / MS_PER_DAY
  );
}
