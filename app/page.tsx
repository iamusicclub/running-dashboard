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

type WeeklyBucket = {
  label: string;
  totalDistance: number;
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

function formatPace(time: string, distance: string) {
  const paceSeconds = calculatePaceSeconds(time, distance);

  if (!paceSeconds) {
    return "N/A";
  }

  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
}

function formatPaceFromSeconds(paceSeconds: number) {
  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
}

function predictTime(baseDistance: number, baseTime: number, targetDistance: number) {
  return baseTime * Math.pow(targetDistance / baseDistance, 1.06);
}

function getRunQualityScore(run: Run) {
  const distance = parseFloat(run.distance || "0");
  const seconds = timeToSeconds(run.time);
  const avgHr = parseFloat(run.avgHr || "0");

  if (!distance || !seconds) return 0;
  if (distance < 3) return 0;

  let score = 0;

  if (run.runType === "race") score += 5;
  if (run.runType === "tempo") score += 4;
  if (run.runType === "interval") score += 3;
  if (run.runType === "long") score += 2;
  if (run.runType === "easy") score += 1;
  if (run.runType === "recovery") score += 0.5;

  if (distance >= 5) score += 1;
  if (distance >= 10) score += 1;
  if (distance >= 16) score += 1;

  if (avgHr >= 150) score += 1;

  return score;
}

function getRecentRuns(runs: Run[]) {
  return [...runs]
    .filter((run) => {
      const distance = parseFloat(run.distance || "0");
      const seconds = timeToSeconds(run.time);
      return distance >= 3 && !!seconds;
    })
    .slice(0, 8);
}

function getBestSupportingRuns(runs: Run[]) {
  return getRecentRuns(runs)
    .map((run) => {
      const distance = parseFloat(run.distance || "0");
      const seconds = timeToSeconds(run.time)!;
      const pace = seconds / distance;
      const score = getRunQualityScore(run);

      return {
        run,
        distance,
        seconds,
        pace,
        score,
      };
    })
    .sort((a, b) => {
      const aValue = a.pace / (1 + a.score * 0.05);
      const bValue = b.pace / (1 + b.score * 0.05);
      return aValue - bValue;
    })
    .slice(0, 3);
}

function getPredictedSecondsForDistance(runs: Run[], targetDistance: number) {
  const supportingRuns = getBestSupportingRuns(runs);

  if (supportingRuns.length === 0) {
    return null;
  }

  const weightedPredictions = supportingRuns.map((item) => {
    const predicted = predictTime(item.distance, item.seconds, targetDistance);
    const weight = item.score + 1;
    return { predicted, weight };
  });

  const weightedSum = weightedPredictions.reduce(
    (sum, item) => sum + item.predicted * item.weight,
    0
  );
  const totalWeight = weightedPredictions.reduce(
    (sum, item) => sum + item.weight,
    0
  );

  return weightedSum / totalWeight;
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
      });
    }

    const bucket = map.get(key)!;
    bucket.totalDistance += distance;
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map((entry) => entry[1]);
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

function getThisWeekDistance(runs: Run[]) {
  const now = new Date();
  const startOfWeek = getWeekStart(now);

  return runs.reduce((sum, run) => {
    const runDate = new Date(run.date);
    const distance = parseFloat(run.distance || "0");

    if (runDate >= startOfWeek) {
      return sum + distance;
    }

    return sum;
  }, 0);
}

function getTrainingSummary(runs: Run[]) {
  if (runs.length === 0) {
    return "Start by logging a few runs. Once there is more training history, the dashboard will begin to identify patterns and make stronger predictions.";
  }

  const totalDistance = runs.reduce((sum, run) => sum + parseFloat(run.distance || "0"), 0);
  const averageDistance = totalDistance / runs.length;
  const easyRuns = runs.filter((run) => run.runType === "easy").length;
  const qualityRuns = runs.filter(
    (run) => run.runType === "tempo" || run.runType === "interval" || run.runType === "race"
  ).length;
  const longRuns = runs.filter((run) => run.runType === "long").length;

  let opening = `You have logged ${runs.length} runs covering ${totalDistance.toFixed(
    1
  )} km, with an average run distance of ${averageDistance.toFixed(1)} km.`;

  let distribution = "";
  if (qualityRuns > easyRuns) {
    distribution =
      " Your training currently leans quite heavily toward harder efforts, so make sure easy mileage is still carrying enough of the load.";
  } else if (easyRuns > 0 && qualityRuns > 0) {
    distribution =
      " Your training mix already includes both easier running and quality work, which is a good foundation for progression.";
  } else {
    distribution =
      " The training mix is still early, so the dashboard will become much more useful as more session types are added.";
  }

  let endurance = "";
  if (longRuns >= 2) {
    endurance =
      " You also have some meaningful endurance work logged, which helps support longer-distance predictions.";
  } else {
    endurance =
      " There is not much long-run evidence yet, so half marathon and marathon predictions should still be treated cautiously.";
  }

  return opening + distribution + endurance;
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
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>{label}</p>
      <p style={{ margin: "8px 0 0 0", fontSize: 30, fontWeight: 700 }}>{value}</p>
      {subtext && <p style={{ margin: "8px 0 0 0", fontSize: 13, color: "#6b7280" }}>{subtext}</p>}
    </div>
  );
}

function BarRow({
  label,
  value,
  maxValue,
}: {
  label: string;
  value: number;
  maxValue: number;
}) {
  const width = maxValue > 0 ? `${(value / maxValue) * 100}%` : "0%";

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span>{label}</span>
        <span>{value.toFixed(1)} km</span>
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

function PredictionCard({
  label,
  time,
  pace,
}: {
  label: string;
  time: string;
  pace: string;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>{label}</p>
      <p style={{ margin: "8px 0 0 0", fontSize: 28, fontWeight: 700 }}>{time}</p>
      <p style={{ margin: "8px 0 0 0", fontSize: 14, color: "#374151" }}>{pace}</p>
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

  const weeklyBuckets = useMemo(() => buildWeeklyBuckets(runs), [runs]);
  const maxWeeklyDistance = Math.max(...weeklyBuckets.map((w) => w.totalDistance), 0);

  const totalRuns = runs.length;
  const totalDistance = runs.reduce((sum, run) => sum + parseFloat(run.distance || "0"), 0);
  const thisWeekDistance = getThisWeekDistance(runs);
  const averagePace = getAveragePace(runs);
  const latestRun = runs[0] || null;
  const summary = getTrainingSummary(runs);

  const prediction5k = getPredictedSecondsForDistance(runs, 5);
  const prediction10k = getPredictedSecondsForDistance(runs, 10);
  const predictionHalf = getPredictedSecondsForDistance(runs, 21.1);
  const predictionMarathon = getPredictedSecondsForDistance(runs, 42.2);

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
        <h1 style={{ marginBottom: 8, fontSize: 36 }}>Running Dashboard</h1>
        <p style={{ margin: 0, color: "#4b5563", fontSize: 16 }}>
          A clearer view of your training, fitness trend, and race readiness.
        </p>
      </div>

      {loading ? (
        <p>Loading dashboard...</p>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <StatCard label="Total Runs" value={String(totalRuns)} />
            <StatCard label="Total Distance" value={`${totalDistance.toFixed(1)} km`} />
            <StatCard label="This Week" value={`${thisWeekDistance.toFixed(1)} km`} />
            <StatCard label="Average Pace" value={averagePace} />
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              padding: 20,
              marginBottom: 24,
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Training Summary</h2>
            <p style={{ marginBottom: 0, lineHeight: 1.6 }}>{summary}</p>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h2 style={{ marginBottom: 16 }}>Predicted Race Fitness</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 16,
              }}
            >
              <PredictionCard
                label="5K"
                time={prediction5k ? secondsToTime(prediction5k) : "N/A"}
                pace={prediction5k ? formatPaceFromSeconds(prediction5k / 5) : "Add more runs"}
              />
              <PredictionCard
                label="10K"
                time={prediction10k ? secondsToTime(prediction10k) : "N/A"}
                pace={prediction10k ? formatPaceFromSeconds(prediction10k / 10) : "Add more runs"}
              />
              <PredictionCard
                label="Half Marathon"
                time={predictionHalf ? secondsToTime(predictionHalf) : "N/A"}
                pace={predictionHalf ? formatPaceFromSeconds(predictionHalf / 21.1) : "Add more runs"}
              />
              <PredictionCard
                label="Marathon"
                time={predictionMarathon ? secondsToTime(predictionMarathon) : "N/A"}
                pace={predictionMarathon ? formatPaceFromSeconds(predictionMarathon / 42.2) : "Add more runs"}
              />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Weekly Mileage</h2>
              {weeklyBuckets.length === 0 ? (
                <p>No weekly training data yet.</p>
              ) : (
                weeklyBuckets.map((week) => (
                  <BarRow
                    key={week.label}
                    label={week.label}
                    value={week.totalDistance}
                    maxValue={maxWeeklyDistance}
                  />
                ))
              )}
            </div>

            <div
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Latest Run</h2>

              {latestRun ? (
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
              ) : (
                <p>No runs saved yet.</p>
              )}
            </div>
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Quick Links</h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <a href="/runs">Runs</a>
              <a href="/predictions">Predictions</a>
              <a href="/analysis">Training Analysis</a>
              <a href="/races">Race Planner</a>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
