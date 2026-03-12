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
  key: string;
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

  return formatPaceFromSeconds(paceSeconds);
}

function formatPaceFromSeconds(paceSeconds: number | null) {
  if (!paceSeconds) {
    return "N/A";
  }

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
    .slice(0, 8);
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
        key,
        label: formatWeekLabel(weekStart),
        totalDistance: 0,
        totalRuns: 0,
      });
    }

    const bucket = map.get(key)!;
    bucket.totalDistance += distance;
    bucket.totalRuns += 1;
  }

  return Array.from(map.values()).slice(-6);
}

function getAveragePaceSeconds(runs: Run[]) {
  const paces = runs
    .map((run) => calculatePaceSeconds(run.time, run.distance))
    .filter((pace): pace is number => pace !== null);

  if (paces.length === 0) {
    return null;
  }

  return paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
}

function getThisWeekDistance(runs: Run[]) {
  const startOfWeek = getWeekStart(new Date());

  return runs.reduce((sum, run) => {
    const runDate = new Date(run.date);
    const distance = parseFloat(run.distance || "0");

    if (runDate >= startOfWeek) {
      return sum + distance;
    }

    return sum;
  }, 0);
}

function getLastWeekDistance(runs: Run[]) {
  const thisWeekStart = getWeekStart(new Date());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  return runs.reduce((sum, run) => {
    const runDate = new Date(run.date);
    const distance = parseFloat(run.distance || "0");

    if (runDate >= lastWeekStart && runDate < thisWeekStart) {
      return sum + distance;
    }

    return sum;
  }, 0);
}

function getTrendLabel(current: number, previous: number, unit: string) {
  if (previous === 0 && current > 0) {
    return `Up from 0 ${unit}`;
  }

  if (current > previous * 1.05) {
    return "Trending up";
  }

  if (current < previous * 0.95) {
    return "Trending down";
  }

  return "Stable";
}

function getDashboardSummary(runs: Run[]) {
  if (runs.length === 0) {
    return "Start by logging a few runs or syncing Strava. Once there is more data, the dashboard will show clearer trends in volume, pace, and race readiness.";
  }

  const totalDistance = runs.reduce((sum, run) => sum + parseFloat(run.distance || "0"), 0);
  const averageDistance = totalDistance / runs.length;
  const longestRun = Math.max(...runs.map((run) => parseFloat(run.distance || "0")), 0);
  const averagePace = formatPaceFromSeconds(getAveragePaceSeconds(runs));
  const thisWeek = getThisWeekDistance(runs);
  const lastWeek = getLastWeekDistance(runs);

  let message = `You have logged ${runs.length} runs covering ${totalDistance.toFixed(
    1
  )} km. Average run distance is ${averageDistance.toFixed(
    1
  )} km and average pace is ${averagePace}.`;

  if (thisWeek > lastWeek * 1.1 && lastWeek > 0) {
    message += " Weekly volume is building compared with last week.";
  } else if (thisWeek < lastWeek * 0.9 && lastWeek > 0) {
    message += " Weekly volume is lighter than last week.";
  } else {
    message += " Weekly volume is fairly steady.";
  }

  if (longestRun >= 16) {
    message += " You also have meaningful longer-run evidence in the dataset.";
  } else {
    message += " Longer-run evidence is still limited, so long-distance predictions should be treated cautiously.";
  }

  return message;
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
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
      }}
    >
      <p style={{ margin: 0, fontSize: 13, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </p>
      <p style={{ margin: "10px 0 6px 0", fontSize: 30, fontWeight: 700, color: "#111827" }}>
        {value}
      </p>
      {subtext && <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{subtext}</p>}
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
        borderRadius: 18,
        padding: 18,
        boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
      }}
    >
      <p style={{ margin: 0, fontSize: 13, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </p>
      <p style={{ margin: "10px 0 4px 0", fontSize: 28, fontWeight: 700, color: "#111827" }}>
        {time}
      </p>
      <p style={{ margin: 0, fontSize: 14, color: "#4b5563" }}>{pace}</p>
    </div>
  );
}

function MileageBar({
  label,
  value,
  maxValue,
  runs,
}: {
  label: string;
  value: number;
  maxValue: number;
  runs: number;
}) {
  const width = maxValue > 0 ? `${(value / maxValue) * 100}%` : "0%";

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: "#374151" }}>{label}</span>
        <span style={{ color: "#374151" }}>
          {value.toFixed(1)} km · {runs} run{runs === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ background: "#e5e7eb", borderRadius: 999, height: 12 }}>
        <div
          style={{
            width,
            background: "linear-gradient(90deg, #111827, #374151)",
            borderRadius: 999,
            height: 12,
          }}
        />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  children,
  rightText,
}: {
  title: string;
  children: React.ReactNode;
  rightText?: string;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 22, color: "#111827" }}>{title}</h2>
        {rightText && <span style={{ fontSize: 13, color: "#6b7280" }}>{rightText}</span>}
      </div>
      {children}
    </div>
  );
}

export default function HomePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadRuns() {
    const q = query(collection(db, "runs"), orderBy("date", "desc"));
    const snapshot = await getDocs(q);

    const data: Run[] = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      date: docSnap.data().date || "",
      distance: String(docSnap.data().distance || ""),
      time: String(docSnap.data().time || ""),
      notes: docSnap.data().notes || "",
      runType: docSnap.data().runType || "",
      avgHr: String(docSnap.data().avgHr || ""),
      elevation: String(docSnap.data().elevation || ""),
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
  const lastWeekDistance = getLastWeekDistance(runs);
  const averagePaceSeconds = getAveragePaceSeconds(runs);
  const averagePace = formatPaceFromSeconds(averagePaceSeconds);
  const latestRun = runs[0] || null;

  const prediction5k = getPredictedSecondsForDistance(runs, 5);
  const prediction10k = getPredictedSecondsForDistance(runs, 10);
  const predictionHalf = getPredictedSecondsForDistance(runs, 21.1);
  const predictionMarathon = getPredictedSecondsForDistance(runs, 42.2);

  const supportingRuns = getBestSupportingRuns(runs);
  const summary = getDashboardSummary(runs);

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 1100,
        margin: "0 auto",
        fontFamily: "Arial, sans-serif",
        background: "#f8fafc",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          marginBottom: 24,
          padding: 24,
          borderRadius: 22,
          background: "linear-gradient(135deg, #111827, #1f2937)",
          color: "white",
        }}
      >
        <p style={{ margin: 0, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", opacity: 0.75 }}>
          Running Dashboard
        </p>
        <h1 style={{ margin: "10px 0 10px 0", fontSize: 38, lineHeight: 1.1 }}>
          Fitness, trends, and race predictions in one place
        </h1>
        <p style={{ margin: 0, maxWidth: 700, color: "rgba(255,255,255,0.82)", lineHeight: 1.6 }}>
          {summary}
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
            <StatCard label="Total Runs" value={String(totalRuns)} subtext="All logged activities" />
            <StatCard label="Total Distance" value={`${totalDistance.toFixed(1)} km`} subtext="Cumulative training volume" />
            <StatCard
              label="This Week"
              value={`${thisWeekDistance.toFixed(1)} km`}
              subtext={getTrendLabel(thisWeekDistance, lastWeekDistance, "km")}
            />
            <StatCard
              label="Average Pace"
              value={averagePace}
              subtext={averagePaceSeconds ? "Across all saved runs" : "Add more runs to calculate"}
            />
          </div>

          <SectionCard
            title="Predicted Race Fitness"
            rightText={supportingRuns.length > 0 ? `Based on ${supportingRuns.length} strong recent run${supportingRuns.length === 1 ? "" : "s"}` : ""}
          >
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
                <p>No weekly training data yet.</p>
              ) : (
                weeklyBuckets.map((week) => (
                  <MileageBar
                    key={week.key}
                    label={week.label}
                    value={week.totalDistance}
                    maxValue={maxWeeklyDistance}
                    runs={week.totalRuns}
                  />
                ))
              )}
            </SectionCard>

            <SectionCard title="Latest Run">
              {latestRun ? (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Date</p>
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{latestRun.date}</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Type</p>
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{latestRun.runType || "N/A"}</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Distance</p>
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{latestRun.distance} km</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Pace</p>
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{formatPace(latestRun.time, latestRun.distance)}</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Time</p>
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{latestRun.time}</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Avg HR</p>
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{latestRun.avgHr || "N/A"}</p>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      background: "#f8fafc",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Notes</p>
                    <p style={{ margin: "6px 0 0 0", color: "#111827" }}>
                      {latestRun.notes || "No notes added for this run."}
                    </p>
                  </div>
                </>
              ) : (
                <p>No runs saved yet.</p>
              )}
            </SectionCard>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
              marginTop: 24,
            }}
          >
            <SectionCard title="Prediction Evidence">
              {supportingRuns.length === 0 ? (
                <p>Add a few runs of at least 3 km to power the prediction engine.</p>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {supportingRuns.map((item) => (
                    <div
                      key={item.run.id}
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        border: "1px solid #e5e7eb",
                        background: "#f8fafc",
                      }}
                    >
                      <p style={{ margin: 0, fontWeight: 700 }}>
                        {item.run.date} · {item.run.distance} km in {item.run.time}
                      </p>
                      <p style={{ margin: "6px 0 0 0", color: "#4b5563" }}>
                        {item.run.runType || "unknown"} · {formatPace(item.run.time, item.run.distance)} · HR {item.run.avgHr || "N/A"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Quick Links">
              <div style={{ display: "grid", gap: 12 }}>
                <a href="/runs">Open Runs</a>
                <a href="/predictions">Open Predictions</a>
                <a href="/analysis">Open Training Analysis</a>
                <a href="/races">Open Race Planner</a>
              </div>
            </SectionCard>
          </div>
        </>
      )}
    </main>
  );
}
