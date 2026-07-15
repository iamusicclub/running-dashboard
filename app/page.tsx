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

type Run = {
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
};

type RaceGoal = {
  id: string;
  name: string;
  date: string;
  distanceKm: string;
  targetTime: string;
  priority: string;
  notes?: string;
};

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

const MARATHON_DISTANCE_KM = 42.195;
const DEFAULT_TARGET_TIME = "2:59:59";
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
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function secondsToTime(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "N/A";
  }

  const rounded = Math.round(value);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPace(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "N/A";
  }

  const rounded = Math.round(value);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")} /km`;
}

function parseDate(value: string) {
  if (!value) return null;

  const cleanValue = value.slice(0, 10);
  const date = new Date(`${cleanValue}T12:00:00`);

  return Number.isNaN(date.getTime()) ? null : date;
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

function getDaysBetween(later: Date, earlier: Date) {
  const laterCopy = new Date(later);
  const earlierCopy = new Date(earlier);

  laterCopy.setHours(0, 0, 0, 0);
  earlierCopy.setHours(0, 0, 0, 0);

  return Math.round(
    (laterCopy.getTime() - earlierCopy.getTime()) / 86400000
  );
}

function getDaysAgo(value: string) {
  const date = parseDate(value);

  if (!date) return 9999;

  return getDaysBetween(startOfToday(), date);
}

function getDaysToRace(value: string) {
  const date = parseDate(value);

  if (!date) return null;

  return getDaysBetween(date, startOfToday());
}

function getTrainingWeekNumber() {
  const blockStart = parseDate(BLOCK_START_DATE);

  if (!blockStart) return 0;

  const today = startOfToday();

  if (today < blockStart) return 0;

  return Math.min(
    16,
    Math.max(1, Math.floor(getDaysBetween(today, blockStart) / 7) + 1)
  );
}

function getRunDistanceKm(run: Run) {
  if (
    typeof run.distanceMeters === "number" &&
    run.distanceMeters > 0
  ) {
    return run.distanceMeters / 1000;
  }

  const parsed = Number.parseFloat(run.distance || "0");

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

  const distanceKm = getRunDistanceKm(run);
  const timeSeconds = getRunTimeSeconds(run);

  if (!distanceKm || !timeSeconds) return null;

  return timeSeconds / distanceKm;
}

function formatDisplayDate(value: string) {
  const date = parseDate(value);

  if (!date) return "Date not set";

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function findMalagaRace(races: RaceGoal[]) {
  return (
    races.find((race) =>
      race.name.toLowerCase().includes("malaga")
    ) ||
    races.find(
      (race) =>
        race.priority === "A" &&
        Number.parseFloat(race.distanceKm || "0") >= 40
    ) ||
    races.find(
      (race) => Number.parseFloat(race.distanceKm || "0") >= 40
    ) ||
    races[0] ||
    null
  );
}

function calculateEvidenceScore(runs: Run[]) {
  const recent28 = runs.filter((run) => {
    const daysAgo = getDaysAgo(run.date);
    return daysAgo >= 0 && daysAgo <= 28;
  });

  const recent42 = runs.filter((run) => {
    const daysAgo = getDaysAgo(run.date);
    return daysAgo >= 0 && daysAgo <= 42;
  });

  const averageWeeklyMileage =
    recent28.reduce(
      (sum, run) => sum + getRunDistanceKm(run),
      0
    ) / 4;

  const longestRun = recent42.reduce(
    (maximum, run) => Math.max(maximum, getRunDistanceKm(run)),
    0
  );

  const qualityRunCount = recent42.filter((run) =>
    [
      "tempo",
      "threshold",
      "interval",
      "steady",
      "race",
      "long",
      "marathon pace",
      "marathon-pace",
    ].includes((run.runType || "").toLowerCase())
  ).length;

  const consistencyScore = Math.min(
    100,
    (recent28.length / 16) * 100
  );

  const mileageScore = Math.min(
    100,
    (averageWeeklyMileage / 65) * 100
  );

  const enduranceScore = Math.min(
    100,
    (longestRun / 32) * 100
  );

  const qualityScore = Math.min(
    100,
    (qualityRunCount / 6) * 100
  );

  return Math.round(
    consistencyScore * 0.25 +
      mileageScore * 0.3 +
      enduranceScore * 0.3 +
      qualityScore * 0.15
  );
}

function getMonday(date: Date) {
  const result = new Date(date);
  const currentDay = result.getDay();
  const offset = currentDay === 0 ? -6 : 1 - currentDay;

  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + offset);

  return result;
}

function getCurrentWeekDates() {
  const monday = getMonday(new Date());

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

function findCurrentTrainingWeek(weeks: TrainingWeek[]) {
  const todayKey = dateKey(new Date());

  return (
    weeks.find(
      (week) =>
        todayKey >= week.weekStartingDate &&
        todayKey <= week.weekEndingDate
    ) || null
  );
}

function getSessionTypeLabel(sessionType: string) {
  const labels: Record<string, string> = {
    recovery: "Recovery",
    easy: "Easy",
    steady: "Steady",
    tempo: "Tempo",
    threshold: "Threshold",
    interval: "Intervals",
    "marathon-pace": "Marathon pace",
    "long-run": "Long run",
    race: "Race",
    rest: "Rest",
    "cross-training": "Cross training",
    other: "Session",
  };

  return labels[sessionType] || "Session";
}

function getSessionStatus(
  session: PlannedSession | null,
  matchedRuns: Run[],
  isToday: boolean,
  isFuture: boolean
) {
  if (matchedRuns.length > 0) return "Completed";
  if (session?.isRestDay) return "Rest";
  if (isToday) return "Today";
  if (isFuture) return "Upcoming";
  if (session) return "Not matched";
  return "No plan";
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
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-context">{context}</p>
    </article>
  );
}

export default function HomePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [races, setRaces] = useState<RaceGoal[]>([]);
  const [trainingWeeks, setTrainingWeeks] = useState<TrainingWeek[]>(
    []
  );

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [planWarning, setPlanWarning] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        setLoadError("");
        setPlanWarning("");

        const runsRequest = getDocs(
          query(collection(db, "runs"), orderBy("date", "desc"))
        );

        const racesRequest = getDocs(
          query(collection(db, "raceGoals"), orderBy("date", "asc"))
        );

        const planRequest = fetch("/api/training-plan", {
          cache: "no-store",
        }).then(async (response) => {
          const result = (await response.json()) as TrainingPlanResponse;

          if (!response.ok || !result.success) {
            throw new Error(
              result.error || "The coach training plan could not be loaded."
            );
          }

          return result;
        });

        const [runsSnapshot, racesSnapshot, planResponse] =
          await Promise.all([runsRequest, racesRequest, planRequest]);

        const loadedRuns: Run[] = runsSnapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            date: data.date || "",
            distance: String(data.distance || ""),
            time: String(data.time || ""),
            runType: data.runType || "",
            avgHr: String(data.avgHr || ""),
            elevation: String(data.elevation || ""),
            name: data.name || "",
            notes: data.notes || "",
            source: data.source || "",
            distanceMeters:
              typeof data.distanceMeters === "number"
                ? data.distanceMeters
                : undefined,
            movingTimeSeconds:
              typeof data.movingTimeSeconds === "number"
                ? data.movingTimeSeconds
                : undefined,
            paceSecondsPerKm:
              typeof data.paceSecondsPerKm === "number"
                ? data.paceSecondsPerKm
                : null,
            averageHeartrate:
              typeof data.averageHeartrate === "number"
                ? data.averageHeartrate
                : null,
          };
        });

        const loadedRaces: RaceGoal[] = racesSnapshot.docs.map(
          (document) => {
            const data = document.data();

            return {
              id: document.id,
              name: data.name || "",
              date: data.date || "",
              distanceKm: String(data.distanceKm || ""),
              targetTime: data.targetTime || "",
              priority: data.priority || "A",
              notes: data.notes || "",
            };
          }
        );

        setRuns(loadedRuns);
        setRaces(loadedRaces);
        setTrainingWeeks(planResponse.weeks || []);

        if (planResponse.warning) {
          setPlanWarning(planResponse.warning);
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

  const race = useMemo(() => findMalagaRace(races), [races]);

  const currentTrainingWeek = useMemo(
    () => findCurrentTrainingWeek(trainingWeeks),
    [trainingWeeks]
  );

  const todayKey = dateKey(new Date());

  const todaySession =
    currentTrainingWeek?.sessions.find(
      (session) => session.plannedDate === todayKey
    ) || null;

  const currentWeekDates = useMemo(() => getCurrentWeekDates(), []);

  const runsByDate = useMemo(() => {
    const map = new Map<string, Run[]>();

    runs.forEach((run) => {
      const key = run.date.slice(0, 10);

      if (!key) return;

      const existingRuns = map.get(key) || [];
      existingRuns.push(run);
      map.set(key, existingRuns);
    });

    return map;
  }, [runs]);

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, PlannedSession>();

    currentTrainingWeek?.sessions.forEach((session) => {
      map.set(session.plannedDate, session);
    });

    return map;
  }, [currentTrainingWeek]);

  const latestRun = runs[0] || null;

  const recent28DayRuns = runs.filter((run) => {
    const daysAgo = getDaysAgo(run.date);
    return daysAgo >= 0 && daysAgo <= 28;
  });

  const weeklyMileage =
    recent28DayRuns.reduce(
      (sum, run) => sum + getRunDistanceKm(run),
      0
    ) / 4;

  const longestRecentRun = runs
    .filter((run) => {
      const daysAgo = getDaysAgo(run.date);
      return daysAgo >= 0 && daysAgo <= 42;
    })
    .reduce(
      (maximum, run) => Math.max(maximum, getRunDistanceKm(run)),
      0
    );

  const evidenceScore = calculateEvidenceScore(runs);

  const targetTime = race?.targetTime || DEFAULT_TARGET_TIME;
  const targetSeconds =
    timeToSeconds(targetTime) ||
    timeToSeconds(DEFAULT_TARGET_TIME) ||
    10799;

  const raceDistance =
    Number.parseFloat(race?.distanceKm || "") ||
    MARATHON_DISTANCE_KM;

  const targetPace = formatPace(targetSeconds / raceDistance);

  const trainingWeekNumber = getTrainingWeekNumber();

  const completedPlannedSessions =
    currentTrainingWeek?.sessions.filter((session) => {
      if (session.isRestDay) return true;

      return (runsByDate.get(session.plannedDate) || []).length > 0;
    }).length || 0;

  const plannedSessionCount =
    currentTrainingWeek?.sessions.length || 0;

  const completionPercentage =
    plannedSessionCount > 0
      ? Math.round(
          (completedPlannedSessions / plannedSessionCount) * 100
        )
      : 0;

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
        <p>Loading Project Sub-3...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <section className="dark-card error-card">
        <p className="page-eyebrow">Project Sub-3</p>
        <h1>Mission Control could not load</h1>
        <p>{loadError}</p>
      </section>
    );
  }

  return (
    <div className="page-stack project-dashboard">
      {planWarning && (
        <div className="plan-warning">
          <strong>Training-plan note:</strong> {planWarning}
        </div>
      )}

      <section className="dark-card hero-card">
        <div className="hero-main">
          <div>
            <p className="hero-kicker">
              Project Sub-3 <span>/</span> Malaga 2026
            </p>

            <h1>{race?.name || "Malaga Marathon"}</h1>

            <p className="hero-description">
              Sixteen weeks to execute the coach&apos;s plan, build
              marathon-specific evidence and arrive ready to break three
              hours.
            </p>
          </div>

          <div className="countdown-card">
            <p>Race countdown</p>

            <div className="countdown-value">
              <strong>
                {race ? Math.max(0, getDaysToRace(race.date) || 0) : "—"}
              </strong>
              <span>days</span>
            </div>

            <small>
              {race ? formatDisplayDate(race.date) : "Race date not set"}
            </small>
          </div>
        </div>

        <div className="hero-footer">
          <div className="hero-status">
            <span
              className={`status-badge ${
                evidenceScore >= 70
                  ? "status-badge-success"
                  : evidenceScore >= 50
                  ? "status-badge-primary"
                  : "status-badge-warning"
              }`}
            >
              {evidenceScore >= 70
                ? "On track"
                : evidenceScore >= 50
                ? "Building"
                : "Evidence developing"}
            </span>

            <p>
              Evidence score currently reflects consistency, mileage,
              quality-session volume and recent long-run progression.
            </p>
          </div>

          <div className="target-summary">
            <div>
              <span>Target</span>
              <strong>{targetTime}</strong>
            </div>

            <div>
              <span>Required pace</span>
              <strong>{targetPace}</strong>
            </div>

            <div>
              <span>Training block</span>
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
              <p className="section-label">Coach plan</p>
              <h2>Today&apos;s session</h2>
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
                {getSessionTypeLabel(todaySession.sessionType)}
              </span>
            )}
          </div>

          {todaySession ? (
            <div className="today-session">
              <h3>{todaySession.title}</h3>

              {todaySession.distance.display && (
                <p className="session-distance">
                  {todaySession.distance.display}
                </p>
              )}

              <div className="coach-instructions">
                {todaySession.rawText
                  .split("\n")
                  .filter(Boolean)
                  .map((line, index) => (
                    <p key={`${line}-${index}`}>{line}</p>
                  ))}
              </div>

              {todaySession.targetPaceText && (
                <div className="session-target">
                  <span>Target guidance</span>
                  <strong>{todaySession.targetPaceText}</strong>
                </div>
              )}
            </div>
          ) : currentTrainingWeek ? (
            <div className="empty-session">
              <h3>Awaiting coach plan</h3>
              <p>
                The current training week exists in the Google Sheet, but
                today&apos;s session has not yet been populated.
              </p>
            </div>
          ) : (
            <div className="empty-session">
              <h3>No current week found</h3>
              <p>
                The training-plan API is connected, but no week currently
                covers today&apos;s date.
              </p>
            </div>
          )}
        </div>

        <div className="surface-card score-card">
          <div className="section-header">
            <div>
              <p className="section-label">Headline metric</p>
              <h2>Evidence for Sub-3</h2>
            </div>
          </div>

          <div
            className="score-ring"
            style={{
              background: `conic-gradient(
                #2563eb 0deg,
                #2563eb ${evidenceScore * 3.6}deg,
                #e2e8f0 ${evidenceScore * 3.6}deg,
                #e2e8f0 360deg
              )`,
            }}
          >
            <div>
              <strong>{evidenceScore}</strong>
              <span>/100</span>
            </div>
          </div>

          <p className="score-summary">
            {evidenceScore >= 75
              ? "Strong foundations are in place."
              : evidenceScore >= 55
              ? "The evidence base is moving in the right direction."
              : "The formal marathon block should strengthen this score."}
          </p>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard
          label="Weekly mileage"
          value={`${weeklyMileage.toFixed(1)} km`}
          context="Average over the last 28 days"
        />

        <MetricCard
          label="Longest recent run"
          value={`${longestRecentRun.toFixed(1)} km`}
          context="Longest run in the last 6 weeks"
        />

        <MetricCard
          label="Plan completion"
          value={`${completionPercentage}%`}
          context={
            plannedSessionCount > 0
              ? `${completedPlannedSessions} of ${plannedSessionCount} sessions or rest days`
              : "Current week awaiting sessions"
          }
        />

        <MetricCard
          label="Recent runs"
          value={String(recent28DayRuns.length)}
          context="Activities completed in the last 28 days"
        />
      </section>

      <section className="surface-card week-card">
        <div className="section-header">
          <div>
            <p className="section-label">Coach plan versus Strava</p>
            <h2>This week</h2>
          </div>

          <span className="status-badge status-badge-neutral">
            {currentTrainingWeek?.phase ||
              (trainingWeekNumber > 0
                ? `Week ${trainingWeekNumber}`
                : "Pre-block")}
          </span>
        </div>

        <div className="week-grid">
          {currentWeekDates.map((date) => {
            const key = dateKey(date);
            const plannedSession = sessionsByDate.get(key) || null;
            const dayRuns = runsByDate.get(key) || [];

            const isToday = key === todayKey;
            const isFuture = date > startOfToday();

            const status = getSessionStatus(
              plannedSession,
              dayRuns,
              isToday,
              isFuture
            );

            return (
              <article
                key={key}
                className={`week-day ${isToday ? "week-day-today" : ""}`}
              >
                <div className="week-day-heading">
                  <span>
                    {date.toLocaleDateString("en-GB", {
                      weekday: "short",
                    })}
                  </span>

                  <strong>{date.getDate()}</strong>
                </div>

                <div
                  className={`day-status ${
                    status === "Completed"
                      ? "day-status-completed"
                      : status === "Today"
                      ? "day-status-today"
                      : status === "Rest"
                      ? "day-status-rest"
                      : ""
                  }`}
                >
                  <i />
                  {status}
                </div>

                <p className="planned-title">
                  {plannedSession
                    ? plannedSession.title
                    : "Awaiting plan"}
                </p>

                {plannedSession?.distance.display && (
                  <small>{plannedSession.distance.display}</small>
                )}

                {dayRuns.length > 0 && (
                  <div className="completed-run">
                    <span>Strava</span>
                    <strong>
                      {dayRuns
                        .reduce(
                          (sum, run) => sum + getRunDistanceKm(run),
                          0
                        )
                        .toFixed(1)}{" "}
                      km
                    </strong>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="surface-card latest-card">
        <div className="section-header">
          <div>
            <p className="section-label">Most recent activity</p>
            <h2>Latest Strava run</h2>
          </div>

          <Link href="/runs" className="ghost-button">
            Open training log
          </Link>
        </div>

        {latestRun ? (
          <div className="latest-layout">
            <div className="latest-heading">
              <span className="status-badge status-badge-primary">
                {latestRun.runType || "Run"}
              </span>

              <h3>{latestRun.name || "Completed run"}</h3>
              <p>{formatDisplayDate(latestRun.date)}</p>
            </div>

            <div className="latest-stats">
              <div>
                <span>Distance</span>
                <strong>{getRunDistanceKm(latestRun).toFixed(2)} km</strong>
              </div>

              <div>
                <span>Time</span>
                <strong>
                  {secondsToTime(getRunTimeSeconds(latestRun))}
                </strong>
              </div>

              <div>
                <span>Pace</span>
                <strong>
                  {formatPace(getRunPaceSeconds(latestRun))}
                </strong>
              </div>

              <div>
                <span>Average HR</span>
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
            <p>No Strava run data is currently available.</p>
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
          color: var(--colour-slate-500);
        }

        .loading-state p {
          margin: 0;
        }

        .loading-spinner {
          width: 34px;
          height: 34px;
          border: 3px solid var(--colour-slate-200);
          border-top-color: var(--colour-blue-600);
          border-radius: 999px;
          animation: spin 800ms linear infinite;
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
          color: var(--colour-slate-300);
        }

        .plan-warning {
          padding: 13px 15px;
          color: #92400e;
          border: 1px solid #fde68a;
          border-radius: 11px;
          background: #fffbeb;
          font-size: 12px;
        }

        .hero-card {
          padding: clamp(24px, 3vw, 36px);
        }

        .hero-main {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 32px;
        }

        .hero-kicker {
          margin: 0;
          color: var(--colour-blue-400);
          font-size: 11px;
          font-weight: 780;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }

        .hero-kicker span {
          margin: 0 7px;
          color: var(--colour-slate-500);
        }

        .hero-card h1 {
          margin: 15px 0 0;
          color: #ffffff;
          font-size: clamp(38px, 6vw, 66px);
          font-weight: 790;
          letter-spacing: -0.06em;
          line-height: 0.98;
        }

        .hero-description {
          max-width: 700px;
          margin: 17px 0 0;
          color: var(--colour-slate-300);
          line-height: 1.7;
        }

        .countdown-card {
          min-width: 190px;
          padding: 19px;
          border: 1px solid rgba(96, 165, 250, 0.24);
          border-radius: 15px;
          background: rgba(255, 255, 255, 0.045);
        }

        .countdown-card > p {
          margin: 0;
          color: var(--colour-slate-400);
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
          color: var(--colour-blue-400);
          font-size: 11px;
          font-weight: 750;
          text-transform: uppercase;
        }

        .countdown-card small {
          margin-top: 12px;
          display: block;
          color: var(--colour-slate-400);
        }

        .hero-footer {
          margin-top: 28px;
          padding-top: 22px;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          border-top: 1px solid rgba(148, 163, 184, 0.14);
        }

        .hero-status {
          max-width: 650px;
        }

        .hero-status p {
          margin: 11px 0 0;
          color: var(--colour-slate-300);
          line-height: 1.6;
        }

        .target-summary {
          display: flex;
          gap: 30px;
          text-align: right;
        }

        .target-summary span {
          display: block;
          color: var(--colour-slate-400);
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
          grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
          gap: 20px;
        }

        .today-card,
        .score-card,
        .week-card,
        .latest-card {
          padding: 22px;
        }

        .section-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .section-header h2 {
          margin: 5px 0 0;
          color: var(--colour-slate-950);
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
          color: var(--colour-slate-950);
          font-size: clamp(25px, 4vw, 37px);
          font-weight: 760;
          letter-spacing: -0.045em;
        }

        .session-distance {
          margin: 8px 0 0;
          color: var(--colour-blue-600);
          font-size: 18px;
          font-weight: 730;
        }

        .coach-instructions {
          margin-top: 20px;
          padding: 17px;
          border-radius: 13px;
          background: var(--colour-slate-50);
        }

        .coach-instructions p {
          margin: 0 0 6px;
          color: var(--colour-slate-700);
        }

        .coach-instructions p:last-child {
          margin-bottom: 0;
        }

        .session-target {
          margin-top: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .session-target span {
          color: var(--colour-slate-500);
          font-size: 10px;
          font-weight: 730;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .session-target strong {
          color: var(--colour-slate-950);
        }

        .empty-session p {
          max-width: 650px;
          margin: 11px 0 0;
          color: var(--colour-slate-600);
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
          color: var(--colour-slate-950);
          font-size: 52px;
          letter-spacing: -0.065em;
          line-height: 0.9;
        }

        .score-ring span {
          margin-top: 8px;
          color: var(--colour-slate-500);
          font-size: 11px;
          font-weight: 680;
        }

        .score-summary {
          max-width: 270px;
          margin: 20px 0 0;
          color: var(--colour-slate-600);
          text-align: center;
          line-height: 1.6;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }

        .metric-card {
          min-height: 142px;
          padding: 20px;
        }

        .metric-card .metric-value {
          margin: 17px 0 8px;
        }

        .week-grid {
          margin-top: 21px;
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 9px;
        }

        .week-day {
          min-height: 190px;
          padding: 13px;
          border: 1px solid var(--colour-border);
          border-radius: 13px;
          background: var(--colour-slate-50);
        }

        .week-day-today {
          border-color: rgba(37, 99, 235, 0.48);
          background: var(--colour-blue-50);
        }

        .week-day-heading {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
        }

        .week-day-heading span {
          color: var(--colour-slate-500);
          font-size: 10px;
          font-weight: 760;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .week-day-heading strong {
          color: var(--colour-slate-950);
          font-size: 22px;
        }

        .day-status {
          margin-top: 15px;
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--colour-slate-500);
          font-size: 9px;
          font-weight: 690;
          text-transform: uppercase;
        }

        .day-status i {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: var(--colour-slate-300);
        }

        .day-status-completed i {
          background: var(--colour-success-500);
        }

        .day-status-today i {
          background: var(--colour-blue-600);
        }

        .day-status-rest i {
          background: var(--colour-slate-500);
        }

        .planned-title {
          margin: 13px 0 0;
          color: var(--colour-slate-950);
          font-size: 11px;
          font-weight: 680;
          line-height: 1.4;
        }

        .week-day small {
          margin-top: 5px;
          display: block;
          color: var(--colour-slate-500);
        }

        .completed-run {
          margin-top: 15px;
          padding-top: 11px;
          border-top: 1px solid var(--colour-border);
        }

        .completed-run span {
          display: block;
          color: var(--colour-success-600);
          font-size: 9px;
          font-weight: 730;
          text-transform: uppercase;
        }

        .completed-run strong {
          margin-top: 4px;
          display: block;
          color: var(--colour-slate-950);
          font-size: 12px;
        }

        .latest-layout {
          margin-top: 21px;
          display: grid;
          grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
          gap: 25px;
          align-items: end;
        }

        .latest-heading h3 {
          margin: 13px 0 0;
          color: var(--colour-slate-950);
          font-size: 24px;
          letter-spacing: -0.035em;
        }

        .latest-heading p {
          margin: 5px 0 0;
          color: var(--colour-slate-500);
        }

        .latest-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }

        .latest-stats div {
          padding: 14px;
          border-radius: 11px;
          background: var(--colour-slate-50);
        }

        .latest-stats span {
          display: block;
          color: var(--colour-slate-500);
          font-size: 9px;
          font-weight: 730;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .latest-stats strong {
          margin-top: 6px;
          display: block;
          color: var(--colour-slate-950);
          font-size: 14px;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .metrics-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .week-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        @media (max-width: 900px) {
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
            justify-content: space-between;
            text-align: left;
          }
        }

        @media (max-width: 680px) {
          .week-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .latest-layout {
            grid-template-columns: 1fr;
          }

          .latest-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .target-summary {
            flex-direction: column;
            gap: 15px;
          }
        }

        @media (max-width: 460px) {
          .metrics-grid,
          .latest-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
