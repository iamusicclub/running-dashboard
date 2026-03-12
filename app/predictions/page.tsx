"use client";

import { useEffect, useState } from "react";
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

function formatPace(totalSeconds: number, distanceKm: number) {
  const paceSeconds = totalSeconds / distanceKm;

  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
}

function predictTime(baseDistance: number, baseTime: number, targetDistance: number) {
  return baseTime * Math.pow(targetDistance / baseDistance, 1.06);
}

function getBestPredictionRun(runs: Run[]) {
  let bestRun: Run | null = null;
  let bestPace: number | null = null;

  for (const run of runs) {
    const distance = parseFloat(run.distance || "0");
    const seconds = timeToSeconds(run.time);

    if (!distance || !seconds) continue;
    if (distance < 3) continue;

    const pace = seconds / distance;

    if (bestPace === null || pace < bestPace) {
      bestPace = pace;
      bestRun = run;
    }
  }

  return bestRun;
}

export default function PredictionsPage() {
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

  const bestRun = getBestPredictionRun(runs);

  if (loading) {
    return (
      <main style={{ padding: 40 }}>
        <h1>Predictions</h1>
        <p>Loading runs...</p>
      </main>
    );
  }

  if (!bestRun) {
    return (
      <main style={{ padding: 40 }}>
        <h1>Predictions</h1>
        <p>Add some runs of at least 3 km to generate predictions.</p>
      </main>
    );
  }

  const baseDistance = parseFloat(bestRun.distance);
  const baseTime = timeToSeconds(bestRun.time)!;

  const predictions = [
    { name: "5K", distance: 5 },
    { name: "10K", distance: 10 },
    { name: "Half Marathon", distance: 21.1 },
    { name: "Marathon", distance: 42.2 },
  ].map((race) => {
    const predictedSeconds = predictTime(baseDistance, baseTime, race.distance);

    return {
      race: race.name,
      time: secondsToTime(predictedSeconds),
      pace: formatPace(predictedSeconds, race.distance),
    };
  });

  return (
    <main style={{ padding: 40, maxWidth: 900, margin: "0 auto", fontFamily: "Arial" }}>
      <h1>Race Predictions</h1>

      <p>
        Predictions are based on your strongest recent run:
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 30 }}>
        <p><strong>Date:</strong> {bestRun.date}</p>
        <p><strong>Distance:</strong> {bestRun.distance} km</p>
        <p><strong>Time:</strong> {bestRun.time}</p>
        <p><strong>Run Type:</strong> {bestRun.runType}</p>
      </div>

      <h2>Predicted Race Fitness</h2>

      <div style={{ display: "grid", gap: 16 }}>
        {predictions.map((p) => (
          <div
            key={p.race}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <h3 style={{ marginTop: 0 }}>{p.race}</h3>
            <p><strong>Predicted Time:</strong> {p.time}</p>
            <p><strong>Target Pace:</strong> {p.pace}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 40 }}>
        <a href="/" style={{ marginRight: 20 }}>Dashboard</a>
        <a href="/runs">Runs</a>
      </div>
    </main>
  );
}
