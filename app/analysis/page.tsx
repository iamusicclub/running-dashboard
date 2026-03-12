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
  label: string;
  totalDistance: number;
  totalRuns: number;
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
  if (!paceSeconds) {
    return "N/A";
  }

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
        label: formatWeekLabel(weekStart),
        totalDistance: 0,
        totalRuns: 0,
      });
    }

    const bucket = map.get(key)!;
    bucket.totalDistance += distance;
    bucket.totalRuns += 1;
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map((entry) => entry[1]);
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
    .filter(([, value]) => value > 0)
    .map(([type, count]) => ({ type, count }));
}

function getAverageHr(runs: Run[]) {
  const valid = runs
    .map((run) => parseFloat(run.avgHr || "0"))
    .filter((hr) => hr > 0);

  if (valid.length === 0) {
    return "N/A";
  }

  const avg = valid.reduce((sum, hr) => sum + hr, 0) / valid.length;
  return Math.round(avg).toString();
}

function getAveragePace(runs: Run[]) {
  const paces = runs
    .map((run) => calculatePaceSeconds(run.time, run.distance))
    .filter((pace): pace is number => pace !== null);

  if (paces.length === 0) {
    return "N/A";
  }

  const avg = paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
  return formatPaceFromSeconds(avg);
}

function getRecentTrend(runs: Run[]) {
  const validRuns = runs.filter((run) => calculatePaceSeconds(run.time, run.distance) !== null);

  if (validRuns.length < 4) {
    return "Not enough data yet";
  }

  const recent = validRuns.slice(0, 3);
  const older = validRuns.slice(3, 6);

  if (older.length === 0) {
    return "Not enough data yet";
  }

  const recentAvg =
    recent.reduce((sum, run) => sum + (calculatePaceSeconds(run.time, run.distance) || 0), 0) /
    recent.length;

  const olderAvg =
    older.reduce((sum, run) => sum + (calculatePaceSeconds(run.time, run.distance) || 0), 0) /
    older.length;

  if (recentAvg < olderAvg * 0.98) {
    return "Pace trend improving";
  }

  if (recentAvg > olderAvg * 1.02) {
    return "Pace trend slowing slightly";
  }

  return "Pace trend stable";
}

function getTrainingSummary(runs: Run[]) {
  if (runs.length === 0) {
    return "No runs saved yet, so there is not enough training data to analyse.";
  }

  const totalDistance = runs.reduce((sum, run) => sum + parseFloat(run.distance || "0"), 0);
  const averageDistance = totalDistance / runs.length;
  const averageHr = getAverageHr(runs);
  const trend = getRecentTrend(runs);
  const typeMix = buildRunTypeMix(runs);

  const mostCommonType = typeMix.sort((a, b) => b.count - a.count)[0]?.type || "general";

  return `You have logged ${runs.length} runs covering ${totalDistance.toFixed(
    1
  )} km in total. Your average run distance is ${averageDistance.toFixed(
    1
  )} km, your average recorded heart rate is ${averageHr}, and your current pace trend is: ${trend}. Your most common session type is ${mostCommonType}, which gives a good early picture of how your training is currently distributed.`;
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
      <div style={{ background: "#eee", borderRadius: 999, height: 10 }}>
        <div
          style={{
            width,
            background: "#222",
            borderRadius: 999,
            height: 10,
          }}
        />
      </div>
    </div>
  );
}

export default function AnalysisPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    loadRuns();
  }, []);

  const weeklyBuckets = useMemo(() => buildWeeklyBuckets(runs), [runs]);
  const runTypeMix = useMemo(() => buildRunTypeMix(runs), [runs]);

  const totalDistance = runs.reduce((sum, run) => sum + parseFloat(run.distance || "0"), 0);
  const totalElevation = runs.reduce((sum, run) => sum + parseFloat(run.elevation || "0"), 0);
  const averageHr = getAverageHr(runs);
  const averagePace = getAveragePace(runs);
  const trend = getRecentTrend(runs);
  const summary = getTrainingSummary(runs);

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
    <main style={{ padding: 40, maxWidth: 1000, margin: "0 auto", fontFamily: "Arial" }}>
      <h1>Training Analysis</h1>
      <p>Overview of your training load, mix, and recent performance trend.</p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginTop: 24,
          marginBottom: 32,
        }}
      >
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <p><strong>Total Distance</strong></p>
          <p style={{ fontSize: 28, margin: 0 }}>{totalDistance.toFixed(1)} km</p>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <p><strong>Total Elevation</strong></p>
          <p style={{ fontSize: 28, margin: 0 }}>{totalElevation.toFixed(0)} m</p>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <p><strong>Average HR</strong></p>
          <p style={{ fontSize: 28, margin: 0 }}>{averageHr}</p>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <p><strong>Average Pace</strong></p>
          <p style={{ fontSize: 28, margin: 0 }}>{averagePace}</p>
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Training Summary</h2>
        <p>{summary}</p>
        <p><strong>Current Trend:</strong> {trend}</p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Weekly Mileage</h2>
          {weeklyBuckets.length === 0 ? (
            <p>No weekly data yet.</p>
          ) : (
            weeklyBuckets.map((week) => (
              <BarRow
                key={week.label}
                label={week.label}
                value={Number(week.totalDistance.toFixed(1))}
                maxValue={maxWeeklyDistance}
                suffix=" km"
              />
            ))
          )}
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Run Type Mix</h2>
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
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <h2>Quick Links</h2>
        <ul>
          <li><a href="/">Dashboard</a></li>
          <li><a href="/runs">Runs</a></li>
          <li><a href="/predictions">Predictions</a></li>
          <li><a href="/races">Race Planner</a></li>
        </ul>
      </div>
    </main>
  );
}
