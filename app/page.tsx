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
      <path
        d={path}
        fill="none"
        stroke="#1d4ed8"
        strokeWidth="3"
      />

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
}: {
  label: string;
  value: string;
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

  const totalDistance = runs.reduce(
    (sum, r) => sum + getRunDistanceKm(r),
    0
  );

  const totalRuns = runs.length;

  const fitnessTrend = useMemo(() => buildFitnessTrend(runs), [runs]);

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
          gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: 16,
        }}
      >
        <StatCard label="Total Runs" value={String(totalRuns)} />
        <StatCard label="Total Distance" value={`${totalDistance.toFixed(1)} km`} />
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
            Latest estimated 5K fitness:{" "}
            <strong>
              {secondsToTime(fitnessTrend[fitnessTrend.length - 1].seconds)}
            </strong>
          </p>
        )}
      </div>
    </main>
  );
}
