"use client";

import { useEffect, useState } from "react";
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

function calculatePaceSeconds(time: string, distance: string) {
  const distanceNum = parseFloat(distance);

  if (!time || !distanceNum || distanceNum <= 0) {
    return null;
  }

  const parts = time.split(":").map(Number);

  let totalSeconds = 0;

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    totalSeconds = minutes * 60 + seconds;
  } else if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    totalSeconds = hours * 3600 + minutes * 60 + seconds;
  } else {
    return null;
  }

  return totalSeconds / distanceNum;
}

function formatPace(time: string, distance: string) {
  const paceSeconds = calculatePaceSeconds(time, distance);

  if (!paceSeconds) {
    return "N/A";
  }

  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
}

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

function predictTime(baseDistanceKm: number, baseTimeSeconds: number, targetDistanceKm: number) {
  return baseTimeSeconds * Math.pow(targetDistanceKm / baseDistanceKm, 1.06);
}

function getBestPredictionRun(runs: Run[]) {
  let bestRun: Run | null = null;
  let bestPace: number | null = null;

  for (const run of runs) {
    const distance = parseFloat(run.distance || "0");
    const pace = calculatePaceSeconds(run.time, run.distance);

    if (!distance || !pace) continue;
    if (distance < 3) continue;

    if (bestPace === null || pace < bestPace) {
      bestPace = pace;
      bestRun = run;
    }
  }

  return bestRun;
}

function getWeekDistance(runs: Run[]) {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - diffToMonday);
  startOfWeek.setHours(0, 0, 0, 0);

  return runs.reduce((sum, run) => {
    const runDate = new Date(run.date);
    const distance = parseFloat(run.distance || "0");

    if (runDate >= startOfWeek) {
      return sum + distance;
    }

    return sum;
  }, 0);
}

function getAveragePace(runs: Run[]) {
  const validRuns = runs.filter((run) => calculatePaceSeconds(run.time, run.distance) !== null);

  if (validRuns.length === 0) {
    return "N/A";
  }

  const avgPaceSeconds =
    validRuns.reduce((sum, run) => sum + (calculatePaceSeconds(run.time, run.distance) || 0), 0) /
    validRuns.length;

  const minutes = Math.floor(avgPaceSeconds / 60);
  const seconds = Math.round(avgPaceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
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

  const totalRuns = runs.length;
  const totalDistance = runs.reduce((sum, run) => sum + parseFloat(run.distance || "0"), 0);
  const weekDistance = getWeekDistance(runs);
  const averagePace = getAveragePace(runs);
  const latestRun = runs[0] || null;

  const bestPredictionRun = getBestPredictionRun(runs);
  const bestDistance = bestPredictionRun ? parseFloat(bestPredictionRun.distance) : 0;
  const bestTimeSeconds = bestPredictionRun ? timeToSeconds(bestPredictionRun.time) : null;

  const predictions =
    bestPredictionRun && bestTimeSeconds
      ? {
          "5K": secondsToTime(predictTime(bestDistance, bestTimeSeconds, 5)),
          "10K": secondsToTime(predictTime(bestDistance, bestTimeSeconds, 10)),
          "Half Marathon": secondsToTime(predictTime(bestDistance, bestTimeSeconds, 21.1)),
          Marathon: secondsToTime(predictTime(bestDistance, bestTimeSeconds, 42.2)),
        }
      : null;

  return (
    <main style={{ padding: 40, maxWidth: 1000, margin: "0 auto", fontFamily: "Arial" }}>
      <h1>Running Dashboard</h1>
      <p>Training overview and race predictions based on your saved runs.</p>

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
          <p><strong>Total Runs</strong></p>
          <p style={{ fontSize: 28, margin: 0 }}>{totalRuns}</p>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <p><strong>Total Distance</strong></p>
          <p style={{ fontSize: 28, margin: 0 }}>{totalDistance.toFixed(1)} km</p>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <p><strong>This Week</strong></p>
          <p style={{ fontSize: 28, margin: 0 }}>{weekDistance.toFixed(1)} km</p>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <p><strong>Average Pace</strong></p>
          <p style={{ fontSize: 28, margin: 0 }}>{averagePace}</p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Latest Run</h2>

          {loading && <p>Loading...</p>}

          {!loading && latestRun && (
            <>
              <p><strong>Date:</strong> {latestRun.date}</p>
              <p><strong>Distance:</strong> {latestRun.distance} km</p>
              <p><strong>Time:</strong> {latestRun.time}</p>
              <p><strong>Pace:</strong> {formatPace(latestRun.time, latestRun.distance)}</p>
              <p><strong>Type:</strong> {latestRun.runType}</p>
              <p><strong>Average HR:</strong> {latestRun.avgHr}</p>
              <p><strong>Elevation:</strong> {latestRun.elevation} m</p>
              <p><strong>Notes:</strong> {latestRun.notes}</p>
            </>
          )}

          {!loading && !latestRun && <p>No runs saved yet.</p>}
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Predicted Race Times</h2>

          {predictions ? (
            <>
              <p><strong>Based on best recent run:</strong> {bestPredictionRun?.distance} km in {bestPredictionRun?.time}</p>
              <p><strong>5K:</strong> {predictions["5K"]}</p>
              <p><strong>10K:</strong> {predictions["10K"]}</p>
              <p><strong>Half Marathon:</strong> {predictions["Half Marathon"]}</p>
              <p><strong>Marathon:</strong> {predictions["Marathon"]}</p>
            </>
          ) : (
            <p>Add a few runs of at least 3 km to generate predictions.</p>
          )}
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <h2>Quick Links</h2>
        <ul>
          <li><a href="/runs">Runs</a></li>
          <li><a href="/predictions">Predictions</a></li>
          <li><a href="/analysis">Training Analysis</a></li>
          <li><a href="/races">Race Planner</a></li>
        </ul>
      </div>
    </main>
  );
}
