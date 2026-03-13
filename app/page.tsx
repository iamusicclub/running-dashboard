"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../lib/firebase";

type Run = {
  id: string;
  date: string;
  distance: string;
  time: string;
  runType: string;
  avgHr: string;

  distanceMeters?: number;
  movingTimeSeconds?: number;
};

type RaceGoal = {
  id: string;
  name: string;
  date: string;
  distanceKm: string;
  targetTime: string;
  priority: string;
};

function timeToSeconds(time: string) {
  const p = time.split(":").map(Number);

  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];

  return null;
}

function secondsToTime(sec: number) {
  const s = Math.round(sec);

  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;

  if (h > 0) {
    return `${h}:${m < 10 ? "0" : ""}${m}:${r < 10 ? "0" : ""}${r}`;
  }

  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

function getRunDistanceKm(run: Run) {
  if (run.distanceMeters) return run.distanceMeters / 1000;

  const d = parseFloat(run.distance || "0");

  return d;
}

function getRunSeconds(run: Run) {
  if (run.movingTimeSeconds) return run.movingTimeSeconds;

  return timeToSeconds(run.time || "") || 0;
}

function predictTime(baseDistance: number, baseTime: number, targetDistance: number) {
  return baseTime * Math.pow(targetDistance / baseDistance, 1.06);
}

function getDaysAgo(date: string) {
  const now = new Date();
  const d = new Date(date);

  const diff = now.getTime() - d.getTime();

  return diff / (1000 * 60 * 60 * 24);
}

function buildPrediction(runs: Run[], targetDistance: number) {
  const usable = runs
    .map((run) => {
      const d = getRunDistanceKm(run);
      const t = getRunSeconds(run);

      if (d < 3 || !t) return null;

      const days = getDaysAgo(run.date);

      let weight = 1;

      if (run.runType === "race") weight += 4;
      if (run.runType === "tempo") weight += 3;
      if (run.runType === "interval") weight += 2;

      if (days < 7) weight += 3;
      else if (days < 21) weight += 2;
      else if (days < 40) weight += 1;

      return {
        predicted: predictTime(d, t, targetDistance),
        weight,
        date: run.date,
      };
    })
    .filter(Boolean) as any[];

  if (!usable.length) return null;

  const total = usable.reduce((s, r) => s + r.predicted * r.weight, 0);
  const w = usable.reduce((s, r) => s + r.weight, 0);

  return total / w;
}

function buildTrend(runs: Run[], targetDistance: number) {
  const ordered = [...runs].sort((a, b) => a.date.localeCompare(b.date));

  const trend: { date: string; prediction: number }[] = [];

  for (let i = 3; i < ordered.length; i++) {
    const subset = ordered.slice(0, i + 1);

    const p = buildPrediction(subset, targetDistance);

    if (p) {
      trend.push({
        date: ordered[i].date,
        prediction: p,
      });
    }
  }

  return trend;
}

function TrendChart({
  data,
  target,
}: {
  data: { date: string; prediction: number }[];
  target: number;
}) {
  if (data.length < 2) return <p>No trend yet</p>;

  const width = 320;
  const height = 140;

  const values = data.map((d) => d.prediction).concat(target);

  const max = Math.max(...values);
  const min = Math.min(...values);

  const scaleX = (i: number) => (i / (data.length - 1)) * width;

  const scaleY = (v: number) => height - ((v - min) / (max - min)) * height;

  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${scaleX(i)} ${scaleY(d.prediction)}`)
    .join(" ");

  const targetY = scaleY(target);

  return (
    <svg width={width} height={height}>
      <line
        x1={0}
        x2={width}
        y1={targetY}
        y2={targetY}
        stroke="red"
        strokeDasharray="4"
      />

      <path d={path} stroke="royalblue" fill="none" strokeWidth={3} />
    </svg>
  );
}

export default function Page() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [races, setRaces] = useState<RaceGoal[]>([]);

  async function load() {
    const runsSnap = await getDocs(query(collection(db, "runs"), orderBy("date", "desc")));

    const raceSnap = await getDocs(query(collection(db, "raceGoals"), orderBy("date", "asc")));

    setRuns(
      runsSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Run[]
    );

    setRaces(
      raceSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as RaceGoal[]
    );
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main style={{ display: "grid", gap: 24 }}>
      <h1>Race Dashboard</h1>

      {races.map((race) => {
        const distance = parseFloat(race.distanceKm);
        const targetSeconds = timeToSeconds(race.targetTime) || 0;

        const estimate = buildPrediction(runs, distance);

        const trend = buildTrend(runs, distance);

        const gap =
          estimate && targetSeconds ? secondsToTime(Math.abs(estimate - targetSeconds)) : "N/A";

        return (
          <div
            key={race.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 20,
              display: "grid",
              gap: 12,
            }}
          >
            <h2>{race.name}</h2>

            <p>
              <strong>Target:</strong> {race.targetTime}
            </p>

            <p>
              <strong>Estimate:</strong>{" "}
              {estimate ? secondsToTime(estimate) : "Not enough data"}
            </p>

            <p>
              <strong>Gap:</strong> {gap}
            </p>

            <TrendChart data={trend} target={targetSeconds} />
          </div>
        );
      })}
    </main>
  );
}
