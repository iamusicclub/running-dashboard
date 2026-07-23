"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";

import { db } from "../lib/firebase";

import {
  calculateWeekExecution,
  matchSessionToRuns,
  matchTrainingWeek,
  type MatchableRun,
  type SessionMatchResult,
} from "../lib/session-matching";

import {
  calculateSub3Confidence,
  type ConfidencePillar,
} from "../lib/sub3-confidence";

import {
  buildWeeklyTrainingAssessment,
  type WeeklyTrainingAssessment,
} from "../lib/training-intelligence";

import WeeklyTrainingVerdict from "./components/WeeklyTrainingVerdict";

type Run = MatchableRun;

type PlannedDistance = {
  minimumKm: number | null;
  maximumKm: number | null;
  display: string;
};

type PlannedSession = {
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
  distance: PlannedDistance;
  targetPaceText: string | null;
};

type TrainingWeek = {
  id: string;
  sourceRowNumber: number;
  weekEndingDate: string;
  weekStartingDate: string;
  totalVolumeText: string;
  totalVolumeKm: number | null;
  performanceText: string;
  phase: string | null;
  sessions: PlannedSession[];
};

type TrainingPlanResponse = {
  success: boolean;
  parsedWeekCount?: number;
  parsedSessionCount?: number;
  availableYears?: number[];
  firstWeek?: string | null;
  finalWeek?: string | null;
  warning?: string | null;
  weeks?: TrainingWeek[];
  sessions?: PlannedSession[];
  error?: string;
};

const MALAGA_RACE_NAME = "Málaga Marathon";
const MALAGA_RACE_DATE = "2026-11-08";
const MARATHON_DISTANCE_KM = 42.195;
const TARGET_TIME = "2:59:59";
const BLOCK_START_DATE = "2026-07-20";

function timeToSeconds(value: string) {
  if (!value) return null;

  const parts = value.split(":").map(Number);

  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    );
  }

  return null;
}

function secondsToTime(value: number | null) {
  if (
    value === null ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return "N/A";
  }

  const rounded = Math.round(value);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor(
    (rounded % 3600) / 60
  );
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(
    2,
    "0"
  )}`;
}

function formatPace(value: number | null) {
  if (
    value === null ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return "N/A";
  }

  const rounded = Math.round(value);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;

  return `${minutes}:${String(seconds).padStart(
    2,
    "0"
  )} /km`;
}

function parseDate(value: string) {
  if (!value) return null;

  const cleanValue = value.slice(0, 10);

  const [year, month, day] = cleanValue
    .split("-")
    .map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

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

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today;
}

function getDaysBetween(
  later: Date,
  earlier: Date
) {
  const laterCopy = new Date(later);
  const earlierCopy = new Date(earlier);

  laterCopy.setHours(0, 0, 0, 0);
  earlierCopy.setHours(0, 0, 0, 0);

  return Math.round(
    (laterCopy.getTime() -
      earlierCopy.getTime()) /
      86400000
  );
}

function getDaysAgo(value: string) {
  const date = parseDate(value);

  if (!date) return 9999;

  return getDaysBetween(
    startOfToday(),
    date
  );
}

function getDaysToRace() {
  const raceDate = parseDate(
    MALAGA_RACE_DATE
  );

  if (!raceDate) return null;

  return getDaysBetween(
    raceDate,
    startOfToday()
  );
}

function getTrainingWeekNumber() {
  const blockStart = parseDate(
    BLOCK_START_DATE
  );

  if (!blockStart) return 0;

  const today = startOfToday();

  if (today < blockStart) {
    return 0;
  }

  const weekNumber =
    Math.floor(
      getDaysBetween(
        today,
        blockStart
      ) / 7
    ) + 1;

  return Math.min(
    16,
    Math.max(1, weekNumber)
  );
}

function getTrainingPhase(
  weekNumber: number
) {
  if (weekNumber <= 0) return "Pre-block";
  if (weekNumber <= 4) return "Base";
  if (weekNumber <= 10) return "Quality";
  if (weekNumber <= 13) return "Sharpen";

  return "Taper";
}

function getRunDistanceKm(run: Run) {
  if (
    typeof run.distanceMeters === "number" &&
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

function getRunTimeSeconds(run: Run) {
  if (
    typeof run.movingTimeSeconds === "number" &&
    run.movingTimeSeconds > 0
  ) {
    return run.movingTimeSeconds;
  }

  return timeToSeconds(run.time) || 0;
}

function getRunPaceSeconds(run: Run) {
  if (
    typeof run.paceSecondsPerKm === "number" &&
    run.paceSecondsPerKm > 0
  ) {
    return run.paceSecondsPerKm;
  }

  const distanceKm =
    getRunDistanceKm(run);

  const timeSeconds =
    getRunTimeSeconds(run);

  if (!distanceKm || !timeSeconds) {
    return null;
  }

  return timeSeconds / distanceKm;
}

function formatDisplayDate(value: string) {
  const date = parseDate(value);

  if (!date) return "Date not set";

  return date.toLocaleDateString(
    "en-GB",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  );
}

function formatWeekLabel(
  week: TrainingWeek | null
) {
  if (!week) {
    return "Current week";
  }

  return `${formatDisplayDate(
    week.weekStartingDate
  )} – ${formatDisplayDate(
    week.weekEndingDate
  )}`;
}

function getMonday(date: Date) {
  const result = new Date(date);
  const currentDay = result.getDay();

  const offset =
    currentDay === 0
      ? -6
      : 1 - currentDay;

  result.setHours(0, 0, 0, 0);

  result.setDate(
    result.getDate() + offset
  );

  return result;
}

function getCurrentWeekDates() {
  const monday = getMonday(new Date());

  return Array.from(
    { length: 7 },
    (_, index) => {
      const date = new Date(monday);

      date.setDate(
        monday.getDate() + index
      );

      return date;
    }
  );
}

function findCurrentTrainingWeek(
  weeks: TrainingWeek[]
) {
  const todayKey = dateKey(new Date());

  return (
    weeks.find(
      (week) =>
        todayKey >=
          week.weekStartingDate &&
        todayKey <=
          week.weekEndingDate
    ) || null
  );
}

function getSessionTypeLabel(
  sessionType: string
) {
  const labels: Record<string, string> = {
    recovery: "Recovery",
    easy: "Easy",
    steady: "Steady",
    tempo: "Tempo",
    threshold: "Threshold",
    interval: "Intervals",
    "marathon-pace": "Marathon pace",
    "long-run": "Long run",
    race: "Race effort",
    rest: "Rest",
    "cross-training": "Cross training",
    other: "Session",
  };

  return labels[sessionType] || "Session";
}

function getMatchStatusClass(
  result: SessionMatchResult | null
) {
  if (!result) return "";

  if (
    result.status === "completed" ||
    result.status === "rest"
  ) {
    return "day-status-completed";
  }

  if (result.status === "partial") {
    return "day-status-partial";
  }

  if (result.status === "missed") {
    return "day-status-missed";
  }

  if (result.status === "unverified") {
    return "day-status-today";
  }

  return "";
}

function getScoreToneClass(
  score: number | null
) {
  if (score === null) {
    return "execution-score-neutral";
  }

  if (score >= 85) {
    return "execution-score-success";
  }

  if (score >= 68) {
    return "execution-score-primary";
  }

  return "execution-score-warning";
}

function getConfidenceBadgeClass(
  score: number
) {
  if (score >= 80) {
    return "status-badge-success";
  }

  if (score >= 65) {
    return "status-badge-primary";
  }

  if (score >= 50) {
    return "status-badge-warning";
  }

  return "status-badge-danger";
}

function getConfidenceStatusLabel(
  score: number
) {
  if (score >= 90) {
    return "Very high confidence";
  }

  if (score >= 80) {
    return "On track";
  }

  if (score >= 65) {
    return "Goal remains realistic";
  }

  if (score >= 50) {
    return "Building";
  }

  return "Evidence developing";
}

function getPillarToneClass(
  pillar: ConfidencePillar
) {
  if (pillar.score >= 85) {
    return "confidence-pillar-strong";
  }

  if (pillar.score >= 70) {
    return "confidence-pillar-positive";
  }

  if (pillar.score >= 50) {
    return "confidence-pillar-developing";
  }

  return "confidence-pillar-risk";
}

function MetricCard({
  label,
  value,
  context,
}: {
  label: string;
  value: string;
  context: string;
}) {
  return (
    <article className="surface-card metric-card">
      <p className="metric-label">
        {label}
      </p>

      <p className="metric-value">
        {value}
      </p>

      <p className="metric-context">
        {context}
      </p>
    </article>
  );
}

export default function HomePage() {
  const [runs, setRuns] = useState<Run[]>([]);

  const [
    trainingWeeks,
    setTrainingWeeks,
  ] = useState<TrainingWeek[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [loadError, setLoadError] =
    useState("");

  const [planWarning, setPlanWarning] =
    useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        setLoadError("");
        setPlanWarning("");

        const runsRequest = getDocs(
          query(
            collection(db, "runs"),
            orderBy("date", "desc")
          )
        );

        const planRequest = fetch(
          "/api/training-plan",
          {
            cache: "no-store",
          }
        ).then(async (response) => {
          const result =
            (await response.json()) as TrainingPlanResponse;

          if (
            !response.ok ||
            !result.success
          ) {
            throw new Error(
              result.error ||
                "The coach training plan could not be loaded."
            );
          }

          return result;
        });

        const [
          runsSnapshot,
          planResponse,
        ] = await Promise.all([
          runsRequest,
          planRequest,
        ]);

        const loadedRuns: Run[] =
          runsSnapshot.docs.map(
            (document) => {
              const data =
                document.data();

              return {
                id: document.id,
                date: data.date || "",
                distance: String(
                  data.distance || ""
                ),
                time: String(
                  data.time || ""
                ),
                runType:
                  data.runType || "",
                avgHr: String(
                  data.avgHr || ""
                ),
                elevation: String(
                  data.elevation || ""
                ),
                name: data.name || "",
                notes: data.notes || "",
                source: data.source || "",

                distanceMeters:
                  typeof data.distanceMeters ===
                  "number"
                    ? data.distanceMeters
                    : undefined,

                movingTimeSeconds:
                  typeof data.movingTimeSeconds ===
                  "number"
                    ? data.movingTimeSeconds
                    : undefined,

                paceSecondsPerKm:
                  typeof data.paceSecondsPerKm ===
                  "number"
                    ? data.paceSecondsPerKm
                    : null,

                averageHeartrate:
                  typeof data.averageHeartrate ===
                  "number"
                    ? data.averageHeartrate
                    : null,

                workoutType:
                  typeof data.workoutType ===
                  "number"
                    ? data.workoutType
                    : null,

                laps: Array.isArray(data.laps)
                  ? data.laps
                  : undefined,
              };
            }
          );

        setRuns(loadedRuns);

        setTrainingWeeks(
          planResponse.weeks || []
        );

        if (planResponse.warning) {
          setPlanWarning(
            planResponse.warning
          );
        }
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Project Sub-3 could not be loaded."
        );
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  const currentTrainingWeek =
    useMemo(
      () =>
        findCurrentTrainingWeek(
          trainingWeeks
        ),
      [trainingWeeks]
    );

  const todayKey = dateKey(new Date());

  const todaySession =
    currentTrainingWeek?.sessions.find(
      (session) =>
        session.plannedDate === todayKey
    ) || null;

  const currentWeekDates = useMemo(
    () => getCurrentWeekDates(),
    []
  );

  const runsByDate = useMemo(() => {
    const map = new Map<
      string,
      Run[]
    >();

    runs.forEach((run) => {
      const key = run.date.slice(0, 10);

      if (!key) return;

      const existingRuns =
        map.get(key) || [];

      existingRuns.push(run);
      map.set(key, existingRuns);
    });

    return map;
  }, [runs]);

  const sessionsByDate = useMemo(() => {
    const map = new Map<
      string,
      PlannedSession
    >();

    currentTrainingWeek?.sessions.forEach(
      (session) => {
        map.set(
          session.plannedDate,
          session
        );
      }
    );

    return map;
  }, [currentTrainingWeek]);

  const weeklyMatches = useMemo(
    () =>
      currentTrainingWeek
        ? matchTrainingWeek(
            currentTrainingWeek.sessions,
            runs
          )
        : [],
    [currentTrainingWeek, runs]
  );

  const matchesByDate = useMemo(() => {
    const map = new Map<
      string,
      SessionMatchResult
    >();

    weeklyMatches.forEach((result) => {
      map.set(
        result.plannedDate,
        result
      );
    });

    return map;
  }, [weeklyMatches]);

  const todayMatch = useMemo(
    () =>
      todaySession
        ? matchSessionToRuns(
            todaySession,
            runs
          )
        : null,
    [todaySession, runs]
  );

  const weekExecution = useMemo(
    () =>
      calculateWeekExecution(
        weeklyMatches
      ),
    [weeklyMatches]
  );

  const currentWeekRuns = useMemo(() => {
    if (!currentTrainingWeek) {
      return [];
    }

    return runs.filter((run) => {
      const runDate =
        run.date.slice(0, 10);

      return (
        runDate >=
          currentTrainingWeek.weekStartingDate &&
        runDate <=
          currentTrainingWeek.weekEndingDate
      );
    });
  }, [currentTrainingWeek, runs]);

  const weeklyAssessment: WeeklyTrainingAssessment =
    useMemo(
      () =>
        buildWeeklyTrainingAssessment({
          runs: currentWeekRuns,
          plannedSessions:
            currentTrainingWeek?.sessions || [],
          matches: weeklyMatches,
        }),
      [
        currentWeekRuns,
        currentTrainingWeek,
        weeklyMatches,
      ]
    );

  const sub3Confidence = useMemo(
    () =>
      calculateSub3Confidence({
        runs,
        sessionMatches: weeklyMatches,
        plannedSessions:
          currentTrainingWeek?.sessions ||
          [],
        predictedMarathonSeconds: null,
        raceDate: MALAGA_RACE_DATE,
        today: todayKey,
      }),
    [
      runs,
      weeklyMatches,
      currentTrainingWeek,
      todayKey,
    ]
  );

  const latestRun = runs[0] || null;

  const recent28DayRuns = runs.filter(
    (run) => {
      const daysAgo =
        getDaysAgo(run.date);

      return (
        daysAgo >= 0 &&
        daysAgo <= 28
      );
    }
  );

  const weeklyMileage =
    recent28DayRuns.reduce(
      (sum, run) =>
        sum + getRunDistanceKm(run),
      0
    ) / 4;

  const longestRecentRun = runs
    .filter((run) => {
      const daysAgo =
        getDaysAgo(run.date);

      return (
        daysAgo >= 0 &&
        daysAgo <= 42
      );
    })
    .reduce(
      (maximum, run) =>
        Math.max(
          maximum,
          getRunDistanceKm(run)
        ),
      0
    );

  const targetSeconds =
    timeToSeconds(TARGET_TIME) ||
    10799;

  const targetPace = formatPace(
    targetSeconds /
      MARATHON_DISTANCE_KM
  );

  const trainingWeekNumber =
    getTrainingWeekNumber();

  const trainingPhase =
    currentTrainingWeek?.phase ||
    getTrainingPhase(
      trainingWeekNumber
    );

  const daysToRace =
    getDaysToRace();

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />

        <p>
          Loading Project Sub-3...
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <section className="dark-card error-card">
        <p className="page-eyebrow">
          Project Sub-3
        </p>

        <h1>
          Mission Control could not load
        </h1>

        <p>{loadError}</p>
      </section>
    );
  }

  return (
    <div className="page-stack project-dashboard">
      {planWarning && (
        <div className="plan-warning">
          <strong>
            Training-plan note:
          </strong>{" "}
          {planWarning}
        </div>
      )}

      <section className="dark-card hero-card">
        <div className="hero-main">
          <div>
            <p className="hero-kicker">
              Project Sub-3
              <span>/</span>
              Málaga 2026
            </p>

            <h1>{MALAGA_RACE_NAME}</h1>

            <p className="hero-description">
              Execute the coach&apos;s plan,
              develop marathon-specific
              endurance and arrive in Málaga
              ready to run under three hours.
            </p>
          </div>

          <div className="countdown-card">
            <p>Race countdown</p>

            <div className="countdown-value">
              <strong>
                {daysToRace === null
                  ? "—"
                  : Math.max(
                      0,
                      daysToRace
                    )}
              </strong>

              <span>days</span>
            </div>

            <small>
              {formatDisplayDate(
                MALAGA_RACE_DATE
              )}
            </small>
          </div>
        </div>

        <div className="hero-footer">
          <div className="hero-status">
            <span
              className={`status-badge ${getConfidenceBadgeClass(
                sub3Confidence.score
              )}`}
            >
              {getConfidenceStatusLabel(
                sub3Confidence.score
              )}
            </span>

            <p>
              {sub3Confidence.summary}
            </p>
          </div>

          <div className="target-summary">
            <div>
              <span>Target</span>

              <strong>
                {TARGET_TIME}
              </strong>
            </div>

            <div>
              <span>
                Required pace
              </span>

              <strong>
                {targetPace}
              </strong>
            </div>

            <div>
              <span>
                Training block
              </span>

              <strong>
                {trainingWeekNumber > 0
                  ? `Week ${trainingWeekNumber} of 16`
                  : "Starts Monday"}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="headline-grid">
        <div className="surface-card today-card">
          <div className="section-header">
            <div>
              <p className="section-label">
                Coach plan
              </p>

              <h2>
                Today&apos;s session
              </h2>
            </div>

            {todaySession && (
              <span
                className={`status-badge ${
                  todaySession.isRestDay
                    ? "status-badge-neutral"
                    : todaySession.isKeySession
                    ? "status-badge-warning"
                    : "status-badge-primary"
                }`}
              >
                {getSessionTypeLabel(
                  todaySession.sessionType
                )}
              </span>
            )}
          </div>

          {todaySession ? (
            <div className="today-session">
              <h3>
                {todaySession.title}
              </h3>

              {todaySession.distance
                .display && (
                <p className="session-distance">
                  {
                    todaySession.distance
                      .display
                  }
                </p>
              )}

              <div className="coach-instructions">
                {todaySession.rawText
                  .split("\n")
                  .filter(Boolean)
                  .map(
                    (
                      line,
                      index
                    ) => (
                      <p
                        key={`${line}-${index}`}
                      >
                        {line}
                      </p>
                    )
                  )}
              </div>

              {todaySession.targetPaceText && (
                <div className="session-target">
                  <span>
                    Target guidance
                  </span>

                  <strong>
                    {
                      todaySession.targetPaceText
                    }
                  </strong>
                </div>
              )}

              {todayMatch && (
                <div className="execution-panel">
                  <div className="execution-panel-heading">
                    <div>
                      <span>
                        Plan versus Strava
                      </span>

                      <strong>
                        {
                          todayMatch.statusLabel
                        }
                      </strong>
                    </div>

                    <div className="execution-score">
  {todayMatch.statusLabel}
</div>

                  <p className="execution-verdict">
                    {todayMatch.verdict}
                  </p>

                  <p className="execution-detail">
                    {todayMatch.detail}
                  </p>

                  {todayMatch.components
                    .filter(
                      (component) =>
                        component.available
                    )
                    .map(
                      (component) => (
                        <div
                          key={
                            component.key
                          }
                          className="execution-component"
                        >
                          <div>
                            <span>
                              {
                                component.label
                              }
                            </span>

                            <strong>
                              {
                                component.explanation
                              }
                            </strong>
                          </div>

                          <b>
                            {Math.round(
                              component.score
                            )}
                          </b>
                        </div>
                      )
                    )}
                </div>
              )}
            </div>
          ) : currentTrainingWeek ? (
            <div className="empty-session">
              <h3>
                Awaiting coach plan
              </h3>

              <p>
                The current week exists in
                Google Sheets, but
                today&apos;s session has not
                yet been populated.
              </p>
            </div>
          ) : (
            <div className="empty-session">
              <h3>
                No current week found
              </h3>

              <p>
                No coach-plan week currently
                covers today&apos;s date.
              </p>
            </div>
          )}
        </div>

        <div className="surface-card score-card">
          <div className="section-header">
            <div>
              <p className="section-label">
                Headline metric
              </p>

              <h2>
                Sub-3 Confidence
              </h2>
            </div>

            <span
              className={`status-badge ${getConfidenceBadgeClass(
                sub3Confidence.score
              )}`}
            >
              {sub3Confidence.label}
            </span>
          </div>

          <div
            className="score-ring"
            style={{
              background: `conic-gradient(
                #2563eb 0deg,
                #2563eb ${
                  sub3Confidence.score *
                  3.6
                }deg,
                #e2e8f0 ${
                  sub3Confidence.score *
                  3.6
                }deg,
                #e2e8f0 360deg
              )`,
            }}
          >
            <div>
              <strong>
                {sub3Confidence.score}
              </strong>

              <span>/100</span>
            </div>
          </div>

          <p className="score-summary">
            {sub3Confidence.summary}
          </p>

          <div className="confidence-highlights">
            <div>
              <span>
                Biggest strength
              </span>

              <strong>
                {
                  sub3Confidence.biggestStrength
                }
              </strong>
            </div>

            <div>
              <span>
                Biggest risk
              </span>

              <strong>
                {
                  sub3Confidence.biggestRisk
                }
              </strong>
            </div>

            <div>
              <span>
                Next milestone
              </span>

              <strong>
                {
                  sub3Confidence.nextMilestone
                }
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card evidence-card">
        <div className="section-header">
          <div>
            <p className="section-label">
              Transparent scoring
            </p>

            <h2>
              Evidence behind the confidence
            </h2>
          </div>

          <strong className="evidence-total">
            {sub3Confidence.score}/100
          </strong>
        </div>

        <div className="confidence-pillars">
          {sub3Confidence.pillars.map(
            (pillar) => (
              <article
                key={pillar.key}
                className={`confidence-pillar ${getPillarToneClass(
                  pillar
                )}`}
              >
                <div className="confidence-pillar-heading">
                  <div>
                    <span>
                      {pillar.label}
                    </span>

                    <strong>
                      {pillar.score}
                    </strong>
                  </div>

                  <small>
                    {Math.round(
                      pillar.weight * 100
                    )}
                    % weight
                  </small>
                </div>

                <div className="confidence-progress">
                  <i
                    style={{
                      width: `${pillar.score}%`,
                    }}
                  />
                </div>

                <h3>
                  {pillar.headline}
                </h3>

                <p>
                  {pillar.detail}
                </p>
              </article>
            )
          )}
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard
          label="Weekly mileage"
          value={`${weeklyMileage.toFixed(
            1
          )} km`}
          context="Average over the last 28 days"
        />

        <MetricCard
          label="Longest recent run"
          value={`${longestRecentRun.toFixed(
            1
          )} km`}
          context="Longest run in the last 6 weeks"
        />

        <MetricCard
          label="Weekly execution"
          value={
            weekExecution.averageExecutionScore ===
            null
              ? "N/A"
              : `${weekExecution.averageExecutionScore}%`
          }
          context={`${weekExecution.completedCount} completed, ${weekExecution.partialCount} partial, ${weekExecution.missedCount} missed`}
        />

        <MetricCard
          label="Plan completion"
          value={`${weekExecution.completionPercentage}%`}
          context={`${weekExecution.completedCount} of ${weekExecution.dueCount} due sessions completed`}
        />
      </section>

      <section className="surface-card week-card">
        <div className="section-header">
          <div>
            <p className="section-label">
              Coach plan versus Strava
            </p>

            <h2>This week</h2>
          </div>

          <div className="week-header-summary">
            <span className="status-badge status-badge-neutral">
              {trainingPhase}
            </span>

            {weekExecution.averageExecutionScore !==
              null && (
              <span
                className={`week-score ${getScoreToneClass(
                  weekExecution.averageExecutionScore
                )}`}
              >
                {
                  weekExecution.averageExecutionScore
                }
                % execution
              </span>
            )}
          </div>
        </div>

        <div className="week-grid">
          {currentWeekDates.map(
            (date) => {
              const key = dateKey(date);

              const plannedSession =
                sessionsByDate.get(key) ||
                null;

              const dayRuns =
                runsByDate.get(key) ||
                [];

              const matchResult =
                matchesByDate.get(key) ||
                null;

              const isToday =
                key === todayKey;

              return (
                <article
                  key={key}
                  className={`week-day ${
                    isToday
                      ? "week-day-today"
                      : ""
                  }`}
                >
                  <div className="week-day-heading">
                    <span>
                      {date.toLocaleDateString(
                        "en-GB",
                        {
                          weekday:
                            "short",
                        }
                      )}
                    </span>

                    <strong>
                      {date.getDate()}
                    </strong>
                  </div>

                  <div
                    className={`day-status ${getMatchStatusClass(
                      matchResult
                    )}`}
                  >
                    <i />

                    {matchResult
                      ? matchResult.statusLabel
                      : plannedSession
                      ? "Awaiting assessment"
                      : "Awaiting plan"}
                  </div>

                  <p className="planned-title">
                    {plannedSession
                      ? plannedSession.title
                      : "Awaiting plan"}
                  </p>

                  {plannedSession
                    ?.distance.display && (
                    <small>
                      {
                        plannedSession
                          .distance.display
                      }
                    </small>
                  )}

                  {matchResult?.score !==
                    null &&
                    matchResult?.score !==
                      undefined && (
                      <div className="day-execution-score">
                        <span>
                          Execution
                        </span>

                        <strong>
                          {
                            matchResult.score
                          }
                          %
                        </strong>
                      </div>
                    )}

                  {dayRuns.length > 0 && (
                    <div className="completed-run">
                      <span>
                        Strava
                      </span>

                      <strong>
                        {dayRuns
                          .reduce(
                            (
                              sum,
                              run
                            ) =>
                              sum +
                              getRunDistanceKm(
                                run
                              ),
                            0
                          )
                          .toFixed(1)}{" "}
                        km
                      </strong>
                    </div>
                  )}
                </article>
              );
            }
          )}
        </div>
      </section>

      <WeeklyTrainingVerdict
        assessment={weeklyAssessment}
        weekLabel={formatWeekLabel(
          currentTrainingWeek
        )}
        phaseLabel={trainingPhase}
      />

      <section className="surface-card latest-card">
        <div className="section-header">
          <div>
            <p className="section-label">
              Most recent activity
            </p>

            <h2>
              Latest Strava run
            </h2>
          </div>

          <Link
            href="/runs"
            className="ghost-button"
          >
            Open training log
          </Link>
        </div>

        {latestRun ? (
          <div className="latest-layout">
            <div className="latest-heading">
              <span className="status-badge status-badge-primary">
                {latestRun.runType ||
                  "Run"}
              </span>

              <h3>
                {latestRun.name ||
                  "Completed run"}
              </h3>

              <p>
                {formatDisplayDate(
                  latestRun.date
                )}
              </p>
            </div>

            <div className="latest-stats">
              <div>
                <span>Distance</span>

                <strong>
                  {getRunDistanceKm(
                    latestRun
                  ).toFixed(2)}{" "}
                  km
                </strong>
              </div>

              <div>
                <span>Time</span>

                <strong>
                  {secondsToTime(
                    getRunTimeSeconds(
                      latestRun
                    )
                  )}
                </strong>
              </div>

              <div>
                <span>Pace</span>

                <strong>
                  {formatPace(
                    getRunPaceSeconds(
                      latestRun
                    )
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Average HR
                </span>

                <strong>
                  {latestRun.averageHeartrate ||
                    latestRun.avgHr ||
                    "N/A"}
                </strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-session">
            <p>
              No Strava run data is
              currently available.
            </p>
          </div>
        )}
      </section>

      <style jsx>{`
        .project-dashboard {
          gap: 20px;
        }

        .loading-state {
          min-height: 65vh;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 14px;
          color: var(
            --colour-slate-500
          );
        }

        .loading-state p {
          margin: 0;
        }

        .loading-spinner {
          width: 34px;
          height: 34px;
          border: 3px solid
            var(--colour-slate-200);
          border-top-color:
            var(--colour-blue-600);
          border-radius: 999px;
          animation: spin 800ms
            linear infinite;
        }

        .error-card {
          min-height: 320px;
          padding: 36px;
          display: grid;
          align-content: center;
        }

        .error-card h1 {
          margin: 8px 0 12px;
          font-size: 40px;
        }

        .error-card p:last-child {
          max-width: 700px;
          margin: 0;
          color: var(
            --colour-slate-300
          );
        }

        .plan-warning {
          padding: 13px 15px;
          color: #92400e;
          border: 1px solid
            #fde68a;
          border-radius: 11px;
          background: #fffbeb;
          font-size: 12px;
        }

        .hero-card {
          padding: clamp(
            24px,
            3vw,
            36px
          );
        }

        .hero-main {
          display: grid;
          grid-template-columns:
            minmax(0, 1fr) auto;
          gap: 32px;
        }

        .hero-kicker {
          margin: 0;
          color: var(
            --colour-blue-400
          );
          font-size: 11px;
          font-weight: 780;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }

        .hero-kicker span {
          margin: 0 7px;
          color: var(
            --colour-slate-500
          );
        }

        .hero-card h1 {
          margin: 15px 0 0;
          color: #ffffff;
          font-size: clamp(
            38px,
            6vw,
            66px
          );
          font-weight: 790;
          letter-spacing: -0.06em;
          line-height: 0.98;
        }

        .hero-description {
          max-width: 700px;
          margin: 17px 0 0;
          color: var(
            --colour-slate-300
          );
          line-height: 1.7;
        }

        .countdown-card {
          min-width: 190px;
          padding: 19px;
          border: 1px solid
            rgba(
              96,
              165,
              250,
              0.24
            );
          border-radius: 15px;
          background: rgba(
            255,
            255,
            255,
            0.045
          );
        }

        .countdown-card > p {
          margin: 0;
          color: var(
            --colour-slate-400
          );
          font-size: 10px;
          font-weight: 760;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .countdown-value {
          margin-top: 9px;
          display: flex;
          align-items: flex-end;
          gap: 8px;
        }

        .countdown-value strong {
          color: #ffffff;
          font-size: 52px;
          letter-spacing: -0.065em;
          line-height: 0.95;
        }

        .countdown-value span {
          padding-bottom: 6px;
          color: var(
            --colour-blue-400
          );
          font-size: 11px;
          font-weight: 750;
          text-transform: uppercase;
        }

        .countdown-card small {
          margin-top: 12px;
          display: block;
          color: var(
            --colour-slate-400
          );
        }

        .hero-footer {
          margin-top: 28px;
          padding-top: 22px;
          display: flex;
          align-items: flex-end;
          justify-content:
            space-between;
          gap: 24px;
          border-top: 1px solid
            rgba(
              148,
              163,
              184,
              0.14
            );
        }

        .hero-status {
          max-width: 650px;
        }

        .hero-status p {
          margin: 11px 0 0;
          color: var(
            --colour-slate-300
          );
          line-height: 1.6;
        }

        .target-summary {
          display: flex;
          gap: 30px;
          text-align: right;
        }

        .target-summary span {
          display: block;
          color: var(
            --colour-slate-400
          );
          font-size: 9px;
          font-weight: 740;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .target-summary strong {
          margin-top: 5px;
          display: block;
          color: #ffffff;
          font-size: 16px;
        }

        .headline-grid {
          display: grid;
          grid-template-columns:
            minmax(0, 1.2fr)
            minmax(340px, 0.8fr);
          gap: 20px;
        }

        .today-card,
        .score-card,
        .evidence-card,
        .week-card,
        .latest-card {
          padding: 22px;
        }

        .section-header {
          display: flex;
          align-items: flex-start;
          justify-content:
            space-between;
          gap: 16px;
        }

        .section-header h2 {
          margin: 5px 0 0;
          color: var(
            --colour-slate-950
          );
          font-size: 20px;
          font-weight: 730;
          letter-spacing: -0.025em;
        }

        .today-session,
        .empty-session {
          margin-top: 24px;
        }

        .today-session h3,
        .empty-session h3 {
          margin: 0;
          color: var(
            --colour-slate-950
          );
          font-size: clamp(
            25px,
            4vw,
            37px
          );
          font-weight: 760;
          letter-spacing: -0.045em;
        }

        .session-distance {
          margin: 8px 0 0;
          color: var(
            --colour-blue-600
          );
          font-size: 18px;
          font-weight: 730;
        }

        .coach-instructions {
          margin-top: 20px;
          padding: 17px;
          border-radius: 13px;
          background: var(
            --colour-slate-50
          );
        }

        .coach-instructions p {
          margin: 0 0 6px;
          color: var(
            --colour-slate-700
          );
        }

        .coach-instructions p:last-child {
          margin-bottom: 0;
        }

        .session-target {
          margin-top: 14px;
          display: flex;
          align-items: center;
          justify-content:
            space-between;
          gap: 14px;
        }

        .session-target span {
          color: var(
            --colour-slate-500
          );
          font-size: 10px;
          font-weight: 730;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .session-target strong {
          color: var(
            --colour-slate-950
          );
        }

        .execution-panel {
          margin-top: 20px;
          padding: 17px;
          border: 1px solid
            var(--colour-border);
          border-radius: 14px;
          background: #ffffff;
        }

        .execution-panel-heading {
          display: flex;
          align-items: center;
          justify-content:
            space-between;
          gap: 16px;
        }

        .execution-panel-heading span {
          display: block;
          color: var(
            --colour-slate-500
          );
          font-size: 9px;
          font-weight: 750;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .execution-panel-heading strong {
          margin-top: 5px;
          display: block;
          color: var(
            --colour-slate-950
          );
          font-size: 17px;
        }

        .execution-score {
          min-width: 62px;
          height: 62px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          font-size: 21px;
          font-weight: 800;
        }

        .execution-score small {
          margin-left: -8px;
          font-size: 10px;
        }

        .execution-score-success {
          color: #166534;
          background: #dcfce7;
        }

        .execution-score-primary {
          color: #1d4ed8;
          background: #dbeafe;
        }

        .execution-score-warning {
          color: #92400e;
          background: #fef3c7;
        }

        .execution-score-neutral {
          color: #475569;
          background: #f1f5f9;
        }

        .execution-verdict {
          margin: 16px 0 0;
          color: var(
            --colour-slate-950
          );
          font-weight: 720;
        }

        .execution-detail {
          margin: 7px 0 0;
          color: var(
            --colour-slate-600
          );
          line-height: 1.6;
        }

        .execution-component {
          margin-top: 13px;
          padding-top: 13px;
          display: flex;
          align-items: flex-start;
          justify-content:
            space-between;
          gap: 14px;
          border-top: 1px solid
            var(--colour-border);
        }

        .execution-component span {
          display: block;
          color: var(
            --colour-slate-500
          );
          font-size: 9px;
          font-weight: 750;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .execution-component strong {
          margin-top: 4px;
          display: block;
          color: var(
            --colour-slate-700
          );
          font-size: 11px;
          font-weight: 550;
          line-height: 1.5;
        }

        .execution-component b {
          color: var(
            --colour-slate-950
          );
          font-size: 14px;
        }

        .empty-session p {
          max-width: 650px;
          margin: 11px 0 0;
          color: var(
            --colour-slate-600
          );
          line-height: 1.65;
        }

        .score-card {
          display: grid;
          align-content: start;
          justify-items: center;
        }

        .score-card .section-header {
          width: 100%;
        }

        .score-ring {
          width: 168px;
          height: 168px;
          margin-top: 25px;
          padding: 12px;
          display: grid;
          place-items: center;
          border-radius: 999px;
        }

        .score-ring > div {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          align-content: center;
          border-radius: 999px;
          background: #ffffff;
        }

        .score-ring strong {
          color: var(
            --colour-slate-950
          );
          font-size: 52px;
          letter-spacing: -0.065em;
          line-height: 0.9;
        }

        .score-ring span {
          margin-top: 8px;
          color: var(
            --colour-slate-500
          );
          font-size: 11px;
          font-weight: 680;
        }

        .score-summary {
          max-width: 330px;
          margin: 20px 0 0;
          color: var(
            --colour-slate-600
          );
          text-align: center;
          line-height: 1.6;
        }

        .confidence-highlights {
          width: 100%;
          margin-top: 22px;
          display: grid;
          gap: 9px;
        }

        .confidence-highlights > div {
          padding: 12px 13px;
          border-radius: 11px;
          background: var(
            --colour-slate-50
          );
        }

        .confidence-highlights span {
          display: block;
          color: var(
            --colour-slate-500
          );
          font-size: 8px;
          font-weight: 750;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .confidence-highlights strong {
          margin-top: 5px;
          display: block;
          color: var(
            --colour-slate-950
          );
          font-size: 11px;
          line-height: 1.45;
        }

        .evidence-total {
          color: var(
            --colour-blue-600
          );
          font-size: 25px;
          letter-spacing: -0.04em;
        }

        .confidence-pillars {
          margin-top: 20px;
          display: grid;
          grid-template-columns:
            repeat(
              3,
              minmax(0, 1fr)
            );
          gap: 12px;
        }

        .confidence-pillar {
          padding: 16px;
          border: 1px solid
            var(--colour-border);
          border-radius: 13px;
          background: var(
            --colour-slate-50
          );
        }

        .confidence-pillar-heading {
          display: flex;
          align-items: flex-start;
          justify-content:
            space-between;
          gap: 12px;
        }

        .confidence-pillar-heading span {
          display: block;
          color: var(
            --colour-slate-600
          );
          font-size: 10px;
          font-weight: 720;
        }

        .confidence-pillar-heading strong {
          margin-top: 4px;
          display: block;
          color: var(
            --colour-slate-950
          );
          font-size: 26px;
          letter-spacing: -0.04em;
        }

        .confidence-pillar-heading small {
          color: var(
            --colour-slate-500
          );
          font-size: 8px;
          font-weight: 680;
          text-transform: uppercase;
        }

        .confidence-progress {
          height: 6px;
          margin-top: 13px;
          overflow: hidden;
          border-radius: 999px;
          background: var(
            --colour-slate-200
          );
        }

        .confidence-progress i {
          height: 100%;
          display: block;
          border-radius: inherit;
          background: var(
            --colour-blue-600
          );
        }

        .confidence-pillar-strong
          .confidence-progress
          i {
          background: #16a34a;
        }

        .confidence-pillar-positive
          .confidence-progress
          i {
          background: #2563eb;
        }

        .confidence-pillar-developing
          .confidence-progress
          i {
          background: #f59e0b;
        }

        .confidence-pillar-risk
          .confidence-progress
          i {
          background: #dc2626;
        }

        .confidence-pillar h3 {
          margin: 15px 0 0;
          color: var(
            --colour-slate-950
          );
          font-size: 12px;
          line-height: 1.4;
        }

        .confidence-pillar p {
          margin: 7px 0 0;
          color: var(
            --colour-slate-600
          );
          font-size: 10px;
          line-height: 1.55;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns:
            repeat(
              4,
              minmax(0, 1fr)
            );
          gap: 16px;
        }

        .metric-card {
          min-height: 142px;
          padding: 20px;
        }

        .metric-card
          .metric-value {
          margin: 17px 0 8px;
        }

        .week-header-summary {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .week-score {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 740;
        }

        .week-grid {
          margin-top: 21px;
          display: grid;
          grid-template-columns:
            repeat(
              7,
              minmax(0, 1fr)
            );
          gap: 9px;
        }

        .week-day {
          min-height: 210px;
          padding: 13px;
          border: 1px solid
            var(--colour-border);
          border-radius: 13px;
          background: var(
            --colour-slate-50
          );
        }

        .week-day-today {
          border-color: rgba(
            37,
            99,
            235,
            0.48
          );
          background: var(
            --colour-blue-50
          );
        }

        .week-day-heading {
          display: flex;
          align-items: baseline;
          justify-content:
            space-between;
        }

        .week-day-heading span {
          color: var(
            --colour-slate-500
          );
          font-size: 10px;
          font-weight: 760;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .week-day-heading strong {
          color: var(
            --colour-slate-950
          );
          font-size: 22px;
        }

        .day-status {
          margin-top: 15px;
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(
            --colour-slate-500
          );
          font-size: 9px;
          font-weight: 690;
          text-transform: uppercase;
        }

        .day-status i {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: var(
            --colour-slate-300
          );
        }

        .day-status-completed i {
          background: var(
            --colour-success-500
          );
        }

        .day-status-today i {
          background: var(
            --colour-blue-600
          );
        }

        .day-status-partial i {
          background: #f59e0b;
        }

        .day-status-missed i {
          background: #dc2626;
        }

        .planned-title {
          margin: 13px 0 0;
          color: var(
            --colour-slate-950
          );
          font-size: 11px;
          font-weight: 680;
          line-height: 1.4;
        }

        .week-day small {
          margin-top: 5px;
          display: block;
          color: var(
            --colour-slate-500
          );
        }

        .day-execution-score {
          margin-top: 14px;
          display: flex;
          align-items: baseline;
          justify-content:
            space-between;
          gap: 10px;
        }

        .day-execution-score span {
          color: var(
            --colour-slate-500
          );
          font-size: 8px;
          font-weight: 730;
          text-transform: uppercase;
        }

        .day-execution-score strong {
          color: var(
            --colour-slate-950
          );
          font-size: 13px;
        }

        .completed-run {
          margin-top: 12px;
          padding-top: 11px;
          border-top: 1px solid
            var(--colour-border);
        }

        .completed-run span {
          display: block;
          color: var(
            --colour-success-600
          );
          font-size: 9px;
          font-weight: 730;
          text-transform: uppercase;
        }

        .completed-run strong {
          margin-top: 4px;
          display: block;
          color: var(
            --colour-slate-950
          );
          font-size: 12px;
        }

        .latest-layout {
          margin-top: 21px;
          display: grid;
          grid-template-columns:
            minmax(220px, 1fr)
            minmax(0, 2fr);
          gap: 25px;
          align-items: end;
        }

        .latest-heading h3 {
          margin: 13px 0 0;
          color: var(
            --colour-slate-950
          );
          font-size: 24px;
          letter-spacing: -0.035em;
        }

        .latest-heading p {
          margin: 5px 0 0;
          color: var(
            --colour-slate-500
          );
        }

        .latest-stats {
          display: grid;
          grid-template-columns:
            repeat(
              4,
              minmax(0, 1fr)
            );
          gap: 10px;
        }

        .latest-stats div {
          padding: 14px;
          border-radius: 11px;
          background: var(
            --colour-slate-50
          );
        }

        .latest-stats span {
          display: block;
          color: var(
            --colour-slate-500
          );
          font-size: 9px;
          font-weight: 730;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .latest-stats strong {
          margin-top: 6px;
          display: block;
          color: var(
            --colour-slate-950
          );
          font-size: 14px;
        }

        @keyframes spin {
          to {
            transform: rotate(
              360deg
            );
          }
        }

        @media (
          max-width: 1180px
        ) {
          .metrics-grid {
            grid-template-columns:
              repeat(
                2,
                minmax(0, 1fr)
              );
          }

          .confidence-pillars {
            grid-template-columns:
              repeat(
                2,
                minmax(0, 1fr)
              );
          }

          .week-grid {
            grid-template-columns:
              repeat(
                4,
                minmax(0, 1fr)
              );
          }
        }

        @media (
          max-width: 900px
        ) {
          .headline-grid {
            grid-template-columns: 1fr;
          }

          .hero-main {
            grid-template-columns: 1fr;
          }

          .countdown-card {
            max-width: 240px;
          }

          .hero-footer {
            align-items: flex-start;
            flex-direction: column;
          }

          .target-summary {
            width: 100%;
            justify-content:
              space-between;
            text-align: left;
          }
        }

        @media (
          max-width: 680px
        ) {
          .confidence-pillars {
            grid-template-columns: 1fr;
          }

          .week-grid {
            grid-template-columns:
              repeat(
                2,
                minmax(0, 1fr)
              );
          }

          .latest-layout {
            grid-template-columns: 1fr;
          }

          .latest-stats {
            grid-template-columns:
              repeat(
                2,
                minmax(0, 1fr)
              );
          }

          .target-summary {
            flex-direction: column;
            gap: 15px;
          }

          .week-header-summary {
            align-items: flex-end;
            flex-direction: column;
          }
        }

        @media (
          max-width: 460px
        ) {
          .metrics-grid,
          .latest-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
