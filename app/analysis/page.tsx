"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../lib/firebase";

type Run = {
  id: string;
  date: string;
  distance: string;
  time: string;
  notes: string;
  runType: string;
  avgHr: string;
  elevation: string;
};

type WeeklyBucket = {
  key: string;
  label: string;
  totalDistance: number;
};

type CoachingSummary = {
  headline: string;
  summary: string;
  positives: string[];
  watchouts: string[];
  next_step: string;
};

function timeToSeconds(time: string) {
  const parts = time.split(":").map(Number);

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
}

function calculatePaceSeconds(time: string, distance: string) {
  const distanceNum = parseFloat(distance);

  if (!time || !distanceNum || distanceNum <= 0) {
    return null;
  }

  const totalSeconds = timeToSeconds(time);

  if (!totalSeconds) {
    return null;
  }

  return totalSeconds / distanceNum;
}

function formatPaceFromSeconds(paceSeconds: number | null) {
  if (!paceSeconds) return "N/A";

  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
}

function getWeekStart(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;

  copy.setDate(copy.getDate() - diffToMonday);
  copy.setHours(0, 0, 0, 0);

  return copy;
}

function formatWeekLabel(date: Date) {
  const day = date.getDate();
  const month = date.toLocaleString("en-GB", { month: "short" });
  return `${day} ${month}`;
}

function buildWeeklyBuckets(runs: Run[]) {
  const map = new Map<string, WeeklyBucket>();

  for (const run of runs) {
    if (!run.date) continue;

    const runDate = new Date(run.date);
    const weekStart = getWeekStart(runDate);
    const key = weekStart.toISOString().slice(0, 10);
    const distance = parseFloat(run.distance || "0");

    if (!map.has(key)) {
      map.set(key, {
        key,
        label: formatWeekLabel(weekStart),
        totalDistance: 0,
      });
    }

    const bucket = map.get(key)!;
    bucket.totalDistance += distance;
  }

  return Array.from(map.values()).slice(-8);
}

function buildRunTypeMix(runs: Run[]) {
  const counts: Record<string, number> = {
    easy: 0,
    long: 0,
    tempo: 0,
    interval: 0,
    race: 0,
    recovery: 0,
    other: 0,
  };

  for (const run of runs) {
    const key = (run.runType || "other").toLowerCase();
    if (counts[key] !== undefined) {
      counts[key] += 1;
    } else {
      counts.other += 1;
    }
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({ type, count }));
}

function getAverageHr(runs: Run[]) {
  const hrs = runs
    .map((run) => parseFloat(run.avgHr || "0"))
    .filter((n) => n > 0);

  if (hrs.length === 0) return null;

  return hrs.reduce((sum, n) => sum + n, 0) / hrs.length;
}

function getAveragePaceSeconds(runs: Run[]) {
  const paces = runs
    .map((run) => calculatePaceSeconds(run.time, run.distance))
    .filter((n): n is number => n !== null);

  if (paces.length === 0) return null;

  return paces.reduce((sum, n) => sum + n, 0) / paces.length;
}

function BarRow({
  label,
  value,
  maxValue,
  suffix = "",
}: {
  label: string;
  value: number;
  maxValue: number;
  suffix?: string;
}) {
  const width = maxValue > 0 ? `${(value / maxValue) * 100}%` : "0%";

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span>{label}</span>
        <span>
          {value}
          {suffix}
        </span>
      </div>
      <div style={{ background: "#eef2f7", borderRadius: 999, height: 10 }}>
        <div
          style={{
            width,
            background: "#111827",
            borderRadius: 999,
            height: 10,
          }}
        />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </div>
  );
}

export default function AnalysisPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState("");
  const [coachSummary, setCoachSummary] = useState<CoachingSummary | null>(null);

  async function loadRuns() {
    const q = query(collection(db, "runs"), orderBy("date", "desc"));
    const snapshot = await getDocs(q);

    const data: Run[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      date: doc.data().date || "",
      distance: String(doc.data().distance || ""),
      time: String(doc.data().time || ""),
      notes: doc.data().notes || "",
      runType: doc.data().runType || "",
      avgHr: String(doc.data().avgHr || ""),
      elevation: String(doc.data().elevation || ""),
    }));

    setRuns(data);
    setLoading(false);
  }

  async function generateCoachingSummary(currentRuns: Run[]) {
    if (currentRuns.length === 0) return;

    setCoachLoading(true);
    setCoachError("");

    try {
      const response = await fetch("/api/coaching-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runs: currentRuns.slice(0, 12),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to generate coaching summary.");
      }

      setCoachSummary(data);
    } catch (error: any) {
      setCoachError(error.message || "Failed to generate coaching summary.");
    } finally {
      setCoachLoading(false);
    }
  }

  useEffect(() => {
    loadRuns();
  }, []);

  useEffect(() => {
    if (!loading && runs.length > 0 && !coachSummary && !coachLoading) {
      generateCoachingSummary(runs);
    }
  }, [loading, runs]);

  const weeklyBuckets = useMemo(() => buildWeeklyBuckets(runs), [runs]);
  const runTypeMix = useMemo(() => buildRunTypeMix(runs), [runs]);

  const totalDistance = runs.reduce(
    (sum, run) => sum + parseFloat(run.distance || "0"),
    0
  );
  const totalElevation = runs.reduce(
    (sum, run) => sum + parseFloat(run.elevation || "0"),
    0
  );
  const averageHr = getAverageHr(runs);
  const averagePaceSeconds = getAveragePaceSeconds(runs);

  const maxWeeklyDistance = Math.max(...weeklyBuckets.map((w) => w.totalDistance), 0);
  const maxRunTypeCount = Math.max(...runTypeMix.map((r) => r.count), 0);

  if (loading) {
    return (
      <main style={{ padding: 40 }}>
        <h1>Training Analysis</h1>
        <p>Loading analysis...</p>
      </main>
    );
  }

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 1100,
        margin: "0 auto",
        fontFamily: "Arial",
        background: "#f8fafc",
        minHeight: "100vh",
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 8, fontSize: 36 }}>Training Analysis</h1>
        <p style={{ margin: 0, color: "#4b5563" }}>
          A deeper view of your training load, structure, and coaching summary.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <SectionCard title="Total Distance">
          <p style={{ fontSize: 30, fontWeight: 700, margin: 0 }}>
            {totalDistance.toFixed(1)} km
          </p>
        </SectionCard>

        <SectionCard title="Total Elevation">
          <p style={{ fontSize: 30, fontWeight: 700, margin: 0 }}>
            {totalElevation.toFixed(0)} m
          </p>
        </SectionCard>

        <SectionCard title="Average HR">
          <p style={{ fontSize: 30, fontWeight: 700, margin: 0 }}>
            {averageHr ? Math.round(averageHr) : "N/A"}
          </p>
        </SectionCard>

        <SectionCard title="Average Pace">
          <p style={{ fontSize: 30, fontWeight: 700, margin: 0 }}>
            {formatPaceFromSeconds(averagePaceSeconds)}
          </p>
        </SectionCard>
      </div>

      <SectionCard title="AI Coaching Summary">
        {coachLoading && <p>Generating coaching summary...</p>}

        {coachError && (
          <div>
            <p style={{ color: "red" }}>{coachError}</p>
            <button
              onClick={() => generateCoachingSummary(runs)}
              style={{ padding: 12, borderRadius: 8, border: "1px solid #ddd" }}
            >
              Try Again
            </button>
          </div>
        )}

        {!coachLoading && !coachError && coachSummary && (
          <>
            <h3>{coachSummary.headline}</h3>
            <p style={{ lineHeight: 1.6 }}>{coachSummary.summary}</p>

            {coachSummary.positives.length > 0 && (
              <>
                <h4>What looks good</h4>
                <ul>
                  {coachSummary.positives.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            )}

            {coachSummary.watchouts.length > 0 && (
              <>
                <h4>What to watch</h4>
                <ul>
                  {coachSummary.watchouts.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            )}

            <h4>Next step</h4>
            <p style={{ marginBottom: 0 }}>{coachSummary.next_step}</p>
          </>
        )}

        {!coachLoading && !coachError && !coachSummary && (
          <button
            onClick={() => generateCoachingSummary(runs)}
            style={{ padding: 12, borderRadius: 8, border: "1px solid #ddd" }}
          >
            Generate Coaching Summary
          </button>
        )}
      </SectionCard>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          marginTop: 24,
        }}
      >
        <SectionCard title="Weekly Mileage">
          {weeklyBuckets.length === 0 ? (
            <p>No weekly data yet.</p>
          ) : (
            weeklyBuckets.map((week) => (
              <BarRow
                key={week.key}
                label={week.label}
                value={Number(week.totalDistance.toFixed(1))}
                maxValue={maxWeeklyDistance}
                suffix=" km"
              />
            ))
          )}
        </SectionCard>

        <SectionCard title="Run Type Mix">
          {runTypeMix.length === 0 ? (
            <p>No run type data yet.</p>
          ) : (
            runTypeMix.map((item) => (
              <BarRow
                key={item.type}
                label={item.type}
                value={item.count}
                maxValue={maxRunTypeCount}
              />
            ))
          )}
        </SectionCard>
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionCard title="Quick Links">
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <a href="/">Dashboard</a>
            <a href="/runs">Runs</a>
            <a href="/predictions">Predictions</a>
            <a href="/races">Race Planner</a>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
