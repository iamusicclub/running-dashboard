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

const MALAGA_DISTANCE_KM = 42.195;
const DEFAULT_TARGET_TIME = "2:59:59";

function timeToSeconds(value: string) {
  if (!value) return null;

  const parts = value.split(":").map(Number);

  if (parts.some(Number.isNaN)) {
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
  if (!value || value <= 0) return "N/A";

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
  if (!value || value <= 0) return "N/A";

  const rounded = Math.round(value);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")} /km`;
}

function parseDate(value: string) {
  if (!value) return null;

  const date = new Date(`${value.slice(0, 10)}T12:00:00`);

  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getDaysAgo(value: string) {
  const runDate = parseDate(value);

  if (!runDate) return 9999;

  const today = new Date();

  today.setHours(0, 0, 0, 0);
  runDate.setHours(0, 0, 0, 0);

  return Math.floor(
    (today.getTime() - runDate.getTime()) / 86400000
  );
}

function getDaysToRace(value: string) {
  const raceDate = parseDate(value);

  if (!raceDate) return null;

  const today = new Date();

  today.setHours(0, 0, 0, 0);
  raceDate.setHours(0, 0, 0, 0);

  return Math.ceil(
    (raceDate.getTime() - today.getTime()) / 86400000
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

  return Number.isFinite(parsed) ? parsed : 0;
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

  const distance = getRunDistanceKm(run);
  const seconds = getRunTimeSeconds(run);

  return distance > 0 && seconds > 0 ? seconds / distance : null;
}

function getMonday(date: Date) {
  const result = new Date(date);
  const day = result.getDay();
  const difference = day === 0 ? -6 : 1 - day;

  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + difference);

  return result;
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
        Number.parseFloat(race.distanceKm) >= 40
    ) ||
    races.find(
      (race) => Number.parseFloat(race.distanceKm) >= 40
    ) ||
    races[0] ||
    null
  );
}

function calculateEvidenceScore(runs: Run[]) {
  const last28Days = runs.filter((run) => {
    const daysAgo = getDaysAgo(run.date);
    return daysAgo >= 0 && daysAgo <= 28;
  });

  const last42Days = runs.filter((run) => {
    const daysAgo = getDaysAgo(run.date);
    return daysAgo >= 0 && daysAgo <= 42;
  });

  const mileage =
    last28Days.reduce(
      (total, run) => total + getRunDistanceKm(run),
      0
    ) / 4;

  const longestRun = last42Days.reduce(
    (maximum, run) =>
      Math.max(maximum, getRunDistanceKm(run)),
    0
  );

  const qualityRuns = last42Days.filter((run) =>
    [
      "tempo",
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
    (last28Days.length / 16) * 100
  );

  const mileageScore = Math.min(100, (mileage / 65) * 100);
  const enduranceScore = Math.min(
    100,
    (longestRun / 32) * 100
  );
  const qualityScore = Math.min(
    100,
    (qualityRuns / 6) * 100
  );

  return Math.round(
    consistencyScore * 0.25 +
      mileageScore * 0.3 +
      enduranceScore * 0.3 +
      qualityScore * 0.15
  );
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
    <div
      style={{
        padding: 20,
        border: "1px solid rgba(148,163,184,0.22)",
        borderRadius: 16,
        background: "#ffffff",
        boxShadow: "0 8px 24px rgba(15,23,42,0.05)",
      }}
    >
      <p
        style={{
          margin: 0,
          color: "#64748b",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </p>

      <p
        style={{
          margin: "14px 0 7px",
          color: "#0f172a",
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: "-0.04em",
        }}
      >
        {value}
      </p>

      <p
        style={{
          margin: 0,
          color: "#64748b",
          fontSize: 12,
        }}
      >
        {context}
      </p>
    </div>
  );
}

export default function HomePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [races, setRaces] = useState<RaceGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setLoadError("");

        const [runsSnapshot, racesSnapshot] = await Promise.all([
          getDocs(
            query(
              collection(db, "runs"),
              orderBy("date", "desc")
            )
          ),
          getDocs(
            query(
              collection(db, "raceGoals"),
              orderBy("date", "asc")
            )
          ),
        ]);

        const loadedRuns: Run[] = runsSnapshot.docs.map(
          (document) => {
            const data = document.data();

            return {
              id: document.id,
              date: data.date || "",
              distance: String(data.distance || ""),
              time: String(data.time || ""),
              notes: data.notes || "",
              runType: data.runType || "",
              avgHr: String(data.avgHr || ""),
              elevation: String(data.elevation || ""),
              source: data.source || "",
              name: data.name || "",
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
          }
        );

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
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load Project Sub-3."
        );
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const malagaRace = useMemo(
    () => findMalagaRace(races),
    [races]
  );

  const latestRun = runs[0] || null;

  const recentRuns = runs.filter((run) => {
    const daysAgo = getDaysAgo(run.date);
    return daysAgo >= 0 && daysAgo <= 28;
  });

  const weeklyMileage =
    recentRuns.reduce(
      (total, run) => total + getRunDistanceKm(run),
      0
    ) / 4;

  const longestRecentRun = runs
    .filter((run) => {
      const daysAgo = getDaysAgo(run.date);
      return daysAgo >= 0 && daysAgo <= 42;
    })
    .reduce(
      (maximum, run) =>
        Math.max(maximum, getRunDistanceKm(run)),
      0
    );

  const evidenceScore = calculateEvidenceScore(runs);

  const targetTime =
    malagaRace?.targetTime || DEFAULT_TARGET_TIME;

  const targetSeconds =
    timeToSeconds(targetTime) ||
    timeToSeconds(DEFAULT_TARGET_TIME)!;

  const raceDistance =
    Number.parseFloat(malagaRace?.distanceKm || "") ||
    MALAGA_DISTANCE_KM;

  const targetPace = formatPace(
    targetSeconds / raceDistance
  );

  const currentWeek = useMemo(() => {
    const monday = getMonday(new Date());

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);

      const key = dateKey(date);
      const dayRuns = runs.filter(
        (run) => run.date.slice(0, 10) === key
      );

      return {
        date,
        key,
        runs: dayRuns,
        isToday: key === dateKey(new Date()),
      };
    });
  }, [runs]);

  if (loading) {
    return (
      <main
        style={{
          minHeight: "70vh",
          display: "grid",
          placeItems: "center",
          color: "#64748b",
        }}
      >
        Loading Project Sub-3...
      </main>
    );
  }

  if (loadError) {
    return (
      <main style={{ display: "grid", gap: 20 }}>
        <section
          style={{
            padding: 28,
            borderRadius: 20,
            color: "#ffffff",
            background: "#0f172a",
          }}
        >
          <h1 style={{ marginTop: 0 }}>
            Project Sub-3 could not load
          </h1>
          <p style={{ marginBottom: 0 }}>{loadError}</p>
        </section>
      </main>
    );
  }

  return (
    <main style={{ display: "grid", gap: 22 }}>
      <section
        style={{
          padding: 30,
          border: "1px solid rgba(96,165,250,0.18)",
          borderRadius: 22,
          color: "#ffffff",
          background:
            "radial-gradient(circle at 90% 0%, rgba(37,99,235,0.34), transparent 28rem), linear-gradient(135deg, #071421, #10243a)",
          boxShadow: "0 22px 50px rgba(2,12,27,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 30,
            flexWrap: "wrap",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                color: "#60a5fa",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Project Sub-3 · Malaga 2026
            </p>

            <h1
              style={{
                margin: "14px 0 12px",
                fontSize: "clamp(38px, 6vw, 68px)",
                lineHeight: 0.95,
                letterSpacing: "-0.06em",
              }}
            >
              The road to 2:59:59
            </h1>

            <p
              style={{
                maxWidth: 700,
                margin: 0,
                color: "#cbd5e1",
                lineHeight: 1.7,
              }}
            >
              Training plan, Strava execution and marathon
              readiness brought together around one objective.
            </p>
          </div>

          <div
            style={{
              minWidth: 180,
              padding: 18,
              border: "1px solid rgba(148,163,184,0.18)",
              borderRadius: 16,
              background: "rgba(255,255,255,0.05)",
            }}
          >
            <p
              style={{
                margin: 0,
                color: "#94a3b8",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              Race countdown
            </p>

            <p
              style={{
                margin: "8px 0 4px",
                fontSize: 48,
                fontWeight: 800,
                letterSpacing: "-0.06em",
              }}
            >
              {malagaRace
                ? getDaysToRace(malagaRace.date) ?? "—"
                : "—"}
            </p>

            <p
              style={{
                margin: 0,
                color: "#60a5fa",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              days to Malaga
            </p>
          </div>
        </div>

        <div
          style={{
            marginTop: 28,
            paddingTop: 20,
            display: "flex",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
            borderTop: "1px solid rgba(148,163,184,0.14)",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                color: "#94a3b8",
                fontSize: 10,
                textTransform: "uppercase",
              }}
            >
              Race
            </p>
            <strong>{malagaRace?.name || "Malaga Marathon"}</strong>
          </div>

          <div>
            <p
              style={{
                margin: 0,
                color: "#94a3b8",
                fontSize: 10,
                textTransform: "uppercase",
              }}
            >
              Target
            </p>
            <strong>{targetTime}</strong>
          </div>

          <div>
            <p
              style={{
                margin: 0,
                color: "#94a3b8",
                fontSize: 10,
                textTransform: "uppercase",
              }}
            >
              Target pace
            </p>
            <strong>{targetPace}</strong>
          </div>

          <div>
            <p
              style={{
                margin: 0,
                color: "#94a3b8",
                fontSize: 10,
                textTransform: "uppercase",
              }}
            >
              Race date
            </p>
            <strong>
              {malagaRace
                ? formatDisplayDate(malagaRace.date)
                : "Not configured"}
            </strong>
          </div>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 16,
        }}
      >
        <MetricCard
          label="Evidence for Sub-3"
          value={`${evidenceScore}/100`}
          context={
            evidenceScore >= 70
              ? "Strong foundations"
              : "Evidence building"
          }
        />

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
          label="Recent consistency"
          value={`${recentRuns.length} runs`}
          context="Completed in the last 28 days"
        />
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 1.35fr) minmax(300px, 0.65fr)",
          gap: 18,
        }}
      >
        <div
          style={{
            padding: 22,
            border: "1px solid rgba(148,163,184,0.22)",
            borderRadius: 18,
            background: "#ffffff",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "#2563eb",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            This week
          </p>

          <h2 style={{ margin: "7px 0 18px" }}>
            Training activity
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(7, minmax(80px, 1fr))",
              gap: 8,
              overflowX: "auto",
            }}
          >
            {currentWeek.map((day) => (
              <div
                key={day.key}
                style={{
                  minWidth: 82,
                  minHeight: 130,
                  padding: 12,
                  border: day.isToday
                    ? "1px solid #2563eb"
                    : "1px solid #e2e8f0",
                  borderRadius: 12,
                  background: day.isToday
                    ? "#eff6ff"
                    : "#f8fafc",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    color: "#64748b",
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  {day.date.toLocaleDateString("en-GB", {
                    weekday: "short",
                  })}
                </p>

                <p
                  style={{
                    margin: "7px 0 12px",
                    fontSize: 23,
                    fontWeight: 800,
                  }}
                >
                  {day.date.getDate()}
                </p>

                <p
                  style={{
                    margin: 0,
                    color:
                      day.runs.length > 0 ? "#16a34a" : "#64748b",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {day.runs.length > 0
                    ? "Completed"
                    : day.isToday
                    ? "Today"
                    : "No activity"}
                </p>

                {day.runs[0] && (
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 10,
                      lineHeight: 1.4,
                    }}
                  >
                    {day.runs[0].name ||
                      day.runs[0].runType ||
                      "Run"}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: 22,
            border: "1px solid rgba(148,163,184,0.22)",
            borderRadius: 18,
            background: "#ffffff",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "#2563eb",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Today&apos;s plan
          </p>

          <h2 style={{ margin: "7px 0 14px" }}>
            Coach connection next
          </h2>

          <p
            style={{
              color: "#64748b",
              lineHeight: 1.7,
            }}
          >
            This panel will pull today&apos;s prescribed
            session, distance, pace guidance and coach notes
            directly from the Google Sheet.
          </p>

          <Link
            href="/runs"
            style={{
              marginTop: 14,
              minHeight: 42,
              padding: "0 15px",
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 10,
              color: "#ffffff",
              background: "#2563eb",
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Open training log
          </Link>
        </div>
      </section>

      <section
        style={{
          padding: 22,
          border: "1px solid rgba(148,163,184,0.22)",
          borderRadius: 18,
          background: "#ffffff",
        }}
      >
        <p
          style={{
            margin: 0,
            color: "#2563eb",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Latest Strava activity
        </p>

        <h2 style={{ margin: "7px 0 18px" }}>
          {latestRun?.name ||
            latestRun?.runType ||
            "No run available"}
        </h2>

        {latestRun ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            <MetricCard
              label="Date"
              value={formatDisplayDate(latestRun.date)}
              context={latestRun.source || "Saved activity"}
            />

            <MetricCard
              label="Distance"
              value={`${getRunDistanceKm(latestRun).toFixed(
                2
              )} km`}
              context={latestRun.runType || "Run"}
            />

            <MetricCard
              label="Time"
              value={secondsToTime(
                getRunTimeSeconds(latestRun)
              )}
              context="Moving time"
            />

            <MetricCard
              label="Average pace"
              value={formatPace(
                getRunPaceSeconds(latestRun)
              )}
              context={
                latestRun.averageHeartrate ||
                latestRun.avgHr
                  ? `Average HR ${
                      latestRun.averageHeartrate ||
                      latestRun.avgHr
                    }`
                  : "Heart rate unavailable"
              }
            />
          </div>
        ) : (
          <p style={{ color: "#64748b" }}>
            No run data is available. Open Training and sync
            Strava.
          </p>
        )}
      </section>
    </main>
  );
}
