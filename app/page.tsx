"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../lib/firebase";

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

type WeeklyLoadBucket = {
  key: string;
  label: string;
  totalDistance: number;
  totalLoad: number;
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

function secondsToTime(totalSeconds: number) {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${minutes < 10 ? `0${minutes}` : minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
  }

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
}

function predictTime(baseDistance: number, baseTime: number, targetDistance: number) {
  return baseTime * Math.pow(targetDistance / baseDistance, 1.06);
}

function getRunDistanceKm(run: Run) {
  return parseFloat(run.distance || "0");
}

function getRunTimeSeconds(run: Run) {
  return timeToSeconds(run.time || "") || 0;
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

function getRunLoad(run: Run) {
  const durationSeconds = getRunTimeSeconds(run);
  const durationMinutes = durationSeconds / 60;
  const avgHr = parseFloat(run.avgHr || "0");
  const distanceKm = getRunDistanceKm(run);

  if (!durationMinutes || !distanceKm) {
    return 0;
  }

  let intensityFactor = 1;

  if (run.runType === "recovery") intensityFactor = 0.75;
  if (run.runType === "easy") intensityFactor = 1.0;
  if (run.runType === "long") intensityFactor = 1.15;
  if (run.runType === "tempo") intensityFactor = 1.35;
  if (run.runType === "interval") intensityFactor = 1.45;
  if (run.runType === "race") intensityFactor = 1.6;

  if (avgHr >= 150) intensityFactor += 0.1;
  if (avgHr >= 160) intensityFactor += 0.1;
  if (avgHr >= 170) intensityFactor += 0.1;

  return durationMinutes * intensityFactor;
}

function buildWeeklyLoadBuckets(runs: Run[]) {
  const map = new Map<string, WeeklyLoadBucket>();

  for (const run of runs) {
    if (!run.date) continue;

    const runDate = new Date(run.date);
    const weekStart = getWeekStart(runDate);
    const key = weekStart.toISOString().slice(0, 10);

    if (!map.has(key)) {
      map.set(key, {
        key,
        label: formatWeekLabel(weekStart),
        totalDistance: 0,
        totalLoad: 0,
        totalRuns: 0,
      });
    }

    const bucket = map.get(key)!;
    bucket.totalDistance += getRunDistanceKm(run);
    bucket.totalLoad += getRunLoad(run);
    bucket.totalRuns += 1;
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([, value]) => value);
}

function buildFitnessTrend(runs: Run[]) {
  const validRuns = runs
    .map((run) => {
      const distance = getRunDistanceKm(run);
      const time = getRunTimeSeconds(run);

      if (distance < 3 || !time) return null;

      const predicted5k = predictTime(distance, time, 5);

      return {
        date: run.date,
        seconds: predicted5k,
      };
    })
    .filter(Boolean) as { date: string; seconds: number }[];

  const sorted = validRuns.sort((a, b) => a.date.localeCompare(b.date));

  return sorted.slice(-10);
}

function formatDateShort(date: string) {
  const d = new Date(date);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function FitnessChart({ points }: { points: { date: string; seconds: number }[] }) {
  if (points.length < 2) {
    return <p>Not enough runs yet to calculate a trend.</p>;
  }

  const width = 600;
  const height = 220;
  const padding = 30;

  const values = points.map((p) => p.seconds);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const xStep = (width - padding * 2) / (points.length - 1);

  const yScale = (value: number) =>
    height - padding - ((value - min) / (max - min || 1)) * (height - padding * 2);

  const coords = points.map((p, i) => ({
    x: padding + i * xStep,
    y: yScale(p.seconds),
    label: secondsToTime(p.seconds),
    date: p.date,
  }));

  const path = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
    .join(" ");

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path} fill="none" stroke="#1d4ed8" strokeWidth="3" />

      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r="4" fill="#1d4ed8" />
          <text
            x={c.x}
            y={height - 8}
            fontSize="11"
            textAnchor="middle"
            fill="#444"
          >
            {formatDateShort(c.date)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function StatCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 12,
        padding: 20,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <p style={{ margin: 0, fontSize: 12, color: "#777" }}>{label}</p>
      <p style={{ margin: "6px 0 0 0", fontSize: 28, fontWeight: 700 }}>
        {value}
      </p>
      {subtext && <p style={{ margin: "8px 0 0 0", color: "#666", fontSize: 13 }}>{subtext}</p>}
    </div>
  );
}

function LoadBarChart({ buckets }: { buckets: WeeklyLoadBucket[] }) {
  if (buckets.length === 0) {
    return <p>No weekly load data yet.</p>;
  }

  const maxLoad = Math.max(...buckets.map((b) => b.totalLoad), 1);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {buckets.map((bucket) => {
        const width = `${(bucket.totalLoad / maxLoad) * 100}%`;

        return (
          <div key={bucket.key}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 6,
                fontSize: 14,
              }}
            >
              <span>{bucket.label}</span>
              <span>
                {bucket.totalLoad.toFixed(0)} load · {bucket.totalDistance.toFixed(1)} km
              </span>
            </div>

            <div
              style={{
                height: 12,
                borderRadius: 999,
                background: "#dbeafe",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width,
                  height: "100%",
                  background: "linear-gradient(90deg, #1d4ed8, #2563eb)",
                  borderRadius: 999,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function HomePage() {
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

  const totalDistance = runs.reduce((sum, r) => sum + getRunDistanceKm(r), 0);
  const totalRuns = runs.length;

  const fitnessTrend = useMemo(() => buildFitnessTrend(runs), [runs]);
  const weeklyLoadBuckets = useMemo(() => buildWeeklyLoadBuckets(runs), [runs]);

  const latestEstimated5k =
    fitnessTrend.length > 0
      ? secondsToTime(fitnessTrend[fitnessTrend.length - 1].seconds)
      : "N/A";

  const latestWeekLoad =
    weeklyLoadBuckets.length > 0
      ? `${weeklyLoadBuckets[weeklyLoadBuckets.length - 1].totalLoad.toFixed(0)}`
      : "0";

  if (loading) {
    return (
      <main>
        <h1>Dashboard</h1>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ display: "grid", gap: 24 }}>
      <h1>Dashboard</h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 16,
        }}
      >
        <StatCard label="Total Runs" value={String(totalRuns)} />
        <StatCard label="Total Distance" value={`${totalDistance.toFixed(1)} km`} />
        <StatCard label="Latest Estimated 5K" value={latestEstimated5k} />
        <StatCard
          label="Latest Weekly Load"
          value={latestWeekLoad}
          subtext="Based on run duration, type, and heart rate"
        />
      </div>

      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Fitness Trend (Estimated 5K)</h2>
        <FitnessChart points={fitnessTrend} />

        {fitnessTrend.length > 0 && (
          <p style={{ marginTop: 12, color: "#555" }}>
            Latest estimated 5K fitness: <strong>{latestEstimated5k}</strong>
          </p>
        )}
      </div>

      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Weekly Training Load</h2>
        <p style={{ marginTop: 0, color: "#555" }}>
          A simple load model based on run duration, run type, and heart rate.
        </p>

        <LoadBarChart buckets={weeklyLoadBuckets} />
      </div>
    </main>
  );
}
