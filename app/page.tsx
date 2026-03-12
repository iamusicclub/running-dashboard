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

  source?: string;
  stravaActivityId?: string;
  athleteId?: string;

  startDate?: string;
  startDateLocal?: string;
  name?: string;

  distanceMeters?: number;
  movingTimeSeconds?: number;
  elapsedTimeSeconds?: number;

  pace?: string;
  paceSecondsPerKm?: number | null;

  rawSportType?: string;
  workoutType?: number | null;

  averageHeartrate?: number | null;
  maxHeartrate?: number | null;

  totalElevationGain?: number;
  averageCadence?: number | null;
  averageSpeedMps?: number | null;
  maxSpeedMps?: number | null;

  trainer?: boolean;
  commute?: boolean;
  manual?: boolean;
  private?: boolean;

  achievementCount?: number;
  kudosCount?: number;
};

type WeeklyBucket = {
  key: string;
  label: string;
  totalDistance: number;
  totalRuns: number;
};

type CandidateRun = {
  run: Run;
  distanceKm: number;
  timeSeconds: number;
  paceSecondsPerKm: number;
  score: number;
  reasons: string[];
};

type RacePrediction = {
  race: string;
  distanceKm: number;
  predictedSeconds: number;
  predictedTime: string;
  targetPace: string;
  confidence: string;
  reason: string;
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

function getRunDistanceKm(run: Run) {
  if (run.distanceMeters && run.distanceMeters > 0) {
    return run.distanceMeters / 1000;
  }

  const parsed = parseFloat(run.distance || "0");
  return parsed > 0 ? parsed : 0;
}

function getRunTimeSeconds(run: Run) {
  if (run.movingTimeSeconds && run.movingTimeSeconds > 0) {
    return run.movingTimeSeconds;
  }

  return timeToSeconds(run.time || "") || 0;
}

function getRunPaceSeconds(run: Run) {
  if (run.paceSecondsPerKm && run.paceSecondsPerKm > 0) {
    return run.paceSecondsPerKm;
  }

  const distanceKm = getRunDistanceKm(run);
  const timeSeconds = getRunTimeSeconds(run);

  if (!distanceKm || !timeSeconds) {
    return 0;
  }

  return timeSeconds / distanceKm;
}

function getDaysAgo(runDate: string) {
  if (!runDate) return 9999;

  const today = new Date();
  const date = new Date(runDate);

  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  const diff = today.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getRunQualityScore(run: Run) {
  const distanceKm = getRunDistanceKm(run);
  const timeSeconds = getRunTimeSeconds(run);
  const avgHr =
    run.averageHeartrate && run.averageHeartrate > 0
      ? run.averageHeartrate
      : parseFloat(run.avgHr || "0");
  const daysAgo = getDaysAgo(run.date);

  if (!distanceKm || !timeSeconds || distanceKm < 3) {
    return { score: 0, reasons: ["Too short to use for race prediction"] };
  }

  let score = 0;
  const reasons: string[] = [];

  if (run.runType === "race" || run.workoutType === 1) {
    score += 12;
    reasons.push("Race effort");
  } else if (run.runType === "tempo") {
    score += 9;
    reasons.push("Tempo effort");
  } else if (run.runType === "interval") {
    score += 7;
    reasons.push("Interval effort");
  } else if (run.runType === "long") {
    score += 6;
    reasons.push("Long run");
  } else if (run.runType === "easy") {
    score += 3;
    reasons.push("Easy run");
  } else if (run.runType === "recovery") {
    score += 1;
    reasons.push("Recovery run");
  } else {
    score += 2;
    reasons.push("General run");
  }

  if (distanceKm >= 5) {
    score += 2;
    reasons.push("Useful distance");
  }

  if (distanceKm >= 10) {
    score += 2;
    reasons.push("Strong endurance evidence");
  }

  if (distanceKm >= 16) {
    score += 3;
    reasons.push("Long-distance evidence");
  }

  if (avgHr >= 150) {
    score += 2;
    reasons.push("Likely harder effort");
  }

  if (avgHr >= 165) {
    score += 1;
    reasons.push("High aerobic/threshold strain");
  }

  if (daysAgo <= 7) {
    score += 4;
    reasons.push("Very recent");
  } else if (daysAgo <= 21) {
    score += 3;
    reasons.push("Recent");
  } else if (daysAgo <= 42) {
    score += 1;
    reasons.push("Still relevant");
  } else {
    score -= 2;
    reasons.push("Older evidence");
  }

  if (run.totalElevationGain && run.totalElevationGain > 200) {
    score -= 1;
    reasons.push("Hilly route may distort pace");
  }

  if (run.trainer) {
    score -= 2;
    reasons.push("Indoor/trainer effort");
  }

  return { score, reasons };
}

function getPredictionCandidates(runs: Run[]) {
  return runs
    .map((run) => {
      const distanceKm = getRunDistanceKm(run);
      const timeSeconds = getRunTimeSeconds(run);
      const paceSecondsPerKm = getRunPaceSeconds(run);
      const quality = getRunQualityScore(run);

      return {
        run,
        distanceKm,
        timeSeconds,
        paceSecondsPerKm,
        score: quality.score,
        reasons: quality.reasons,
      } as CandidateRun;
    })
    .filter((item) => item.distanceKm >= 3 && item.timeSeconds > 0 && item.score > 0)
    .sort((a, b) => {
      const aValue = a.paceSecondsPerKm / (1 + a.score * 0.035);
      const bValue = b.paceSecondsPerKm / (1 + b.score * 0.035);
      return aValue - bValue;
    })
    .slice(0, 8);
}

function getDistanceSpecificWeight(candidate: CandidateRun, targetDistanceKm: number) {
  const sourceDistance = candidate.distanceKm;
  const distanceRatio =
    Math.min(sourceDistance, targetDistanceKm) / Math.max(sourceDistance, targetDistanceKm);

  let weight = candidate.score + 1;
  weight *= 0.55 + distanceRatio * 0.9;

  if (targetDistanceKm <= 10) {
    if (
      candidate.run.runType === "race" ||
      candidate.run.runType === "tempo" ||
      candidate.run.runType === "interval"
    ) {
      weight *= 1.15;
    }
    if (candidate.run.runType === "long") {
      weight *= 0.9;
    }
  }

  if (targetDistanceKm > 10 && targetDistanceKm <= 21.1) {
    if (candidate.run.runType === "tempo" || candidate.run.runType === "race") {
      weight *= 1.1;
    }
    if (candidate.distanceKm >= 10) {
      weight *= 1.08;
    }
  }

  if (targetDistanceKm > 21.1) {
    if (candidate.run.runType === "long") {
      weight *= 1.18;
    }
    if (candidate.distanceKm >= 16) {
      weight *= 1.2;
    }
    if (candidate.distanceKm < 5) {
      weight *= 0.75;
    }
  }

  return weight;
}

function getWeeklyMileage(runs: Run[]) {
  const last28Days = runs.filter((run) => getDaysAgo(run.date) <= 28);
  const totalDistance = last28Days.reduce((sum, run) => sum + getRunDistanceKm(run), 0);
  return totalDistance / 4;
}

function getLongestRecentRun(runs: Run[]) {
  return runs
    .filter((run) => getDaysAgo(run.date) <= 42)
    .reduce((max, run) => Math.max(max, getRunDistanceKm(run)), 0);
}

function buildPrediction(runs: Run[], race: string, distanceKm: number): RacePrediction | null {
  const candidates = getPredictionCandidates(runs);

  if (candidates.length === 0) {
    return null;
  }

  const weightedPredictions = candidates.map((candidate) => {
    const predictedSeconds = predictTime(candidate.distanceKm, candidate.timeSeconds, distanceKm);
    const weight = getDistanceSpecificWeight(candidate, distanceKm);

    return {
      candidate,
      predictedSeconds,
      weight,
    };
  });

  const weightedSum = weightedPredictions.reduce(
    (sum, item) => sum + item.predictedSeconds * item.weight,
    0
  );
  const totalWeight = weightedPredictions.reduce((sum, item) => sum + item.weight, 0);

  let predictedSeconds = weightedSum / totalWeight;

  const weeklyMileage = getWeeklyMileage(runs);
  const longestRun = getLongestRecentRun(runs);

  if (distanceKm === 42.2) {
    if (weeklyMileage < 30) {
      predictedSeconds *= 1.03;
    }
    if (longestRun < 18) {
      predictedSeconds *= 1.035;
    }
  }

  if (distanceKm === 21.1) {
    if (weeklyMileage < 25) {
      predictedSeconds *= 1.015;
    }
    if (longestRun < 14) {
      predictedSeconds *= 1.02;
    }
  }

  let confidence = "Moderate";
  let reason = "Built from several recent runs with weighted relevance.";

  const raceLikeRuns = candidates.filter(
    (c) => c.run.runType === "race" || c.run.runType === "tempo"
  ).length;

  if (distanceKm <= 10) {
    if (raceLikeRuns >= 2) {
      confidence = "High";
      reason =
        "Supported by recent harder efforts that are strongly relevant to shorter-distance fitness.";
    } else if (candidates.length < 3) {
      confidence = "Low";
      reason = "There is limited recent evidence for sharper race prediction.";
    }
  }

  if (distanceKm === 21.1) {
    if (weeklyMileage >= 30 && longestRun >= 16) {
      confidence = "Moderate";
      reason = "Supported by a decent amount of endurance evidence plus faster efforts.";
    } else {
      confidence = "Low";
      reason =
        "Half-marathon prediction is still being projected from shorter or less endurance-specific data.";
    }
  }

  if (distanceKm === 42.2) {
    if (weeklyMileage >= 40 && longestRun >= 24) {
      confidence = "Moderate";
      reason =
        "There is meaningful endurance evidence, but marathon prediction remains harder than shorter-distance forecasting.";
    } else {
      confidence = "Low";
      reason =
        "Marathon prediction is speculative because the recent data does not yet show enough marathon-specific volume or long-run depth.";
    }
  }

  return {
    race,
    distanceKm,
    predictedSeconds,
    predictedTime: secondsToTime(predictedSeconds),
    targetPace: formatPaceFromSeconds(predictedSeconds / distanceKm),
    confidence,
    reason,
  };
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
    const distance = getRunDistanceKm(run);

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

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([, value]) => value);
}

function getAveragePaceSeconds(runs: Run[]) {
  const paces = runs
    .map((run) => getRunPaceSeconds(run))
    .filter((pace) => pace > 0);

  if (paces.length === 0) {
    return null;
  }

  return paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
}

function getThisWeekDistance(runs: Run[]) {
  const startOfWeek = getWeekStart(new Date());

  return runs.reduce((sum, run) => {
    const runDate = new Date(run.date);
    const distance = getRunDistanceKm(run);

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
    const distance = getRunDistanceKm(run);

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

  const totalDistance = runs.reduce((sum, run) => sum + getRunDistanceKm(run), 0);
  const averageDistance = totalDistance / runs.length;
  const longestRun = Math.max(...runs.map((run) => getRunDistanceKm(run)), 0);
  const averagePace = formatPaceFromSeconds(getAveragePaceSeconds(runs));
  const thisWeek = getThisWeekDistance(runs);
  const lastWeek = getLastWeekDistance(runs);

  let message = `You have logged ${runs.length} runs covering ${totalDistance.toFixed(
    1
  )} km. Average run distance is ${averageDistance.toFixed(1)} km and average pace is ${averagePace}.`;

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

function PredictionCard({ prediction }: { prediction: RacePrediction }) {
  const confidenceColor =
    prediction.confidence === "High"
      ? "#065f46"
      : prediction.confidence === "Moderate"
      ? "#92400e"
      : "#991b1b";

  const confidenceBg =
    prediction.confidence === "High"
      ? "#d1fae5"
      : prediction.confidence === "Moderate"
      ? "#fef3c7"
      : "#fee2e2";

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, color: "#111827" }}>{prediction.race}</h3>
        <span
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            background: confidenceBg,
            color: confidenceColor,
          }}
        >
          {prediction.confidence}
        </span>
      </div>

      <p style={{ margin: "0 0 8px 0", fontSize: 32, fontWeight: 700, color: "#111827" }}>
        {prediction.predictedTime}
      </p>
      <p style={{ margin: "0 0 14px 0", color: "#4b5563" }}>
        Target pace: {prediction.targetPace}
      </p>
      <p style={{ margin: 0, color: "#374151", lineHeight: 1.5 }}>{prediction.reason}</p>
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

function CandidateCard({ candidate }: { candidate: CandidateRun }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        border: "1px solid #e5e7eb",
        background: "#f8fafc",
      }}
    >
      <p style={{ margin: 0, fontWeight: 700 }}>
        {candidate.run.date} · {candidate.distanceKm.toFixed(2)} km in {secondsToTime(candidate.timeSeconds)}
      </p>
      <p style={{ margin: "6px 0 8px 0", color: "#4b5563" }}>
        {candidate.run.runType || "unknown"} · {formatPaceFromSeconds(candidate.paceSecondsPerKm)} · HR{" "}
        {candidate.run.averageHeartrate || candidate.run.avgHr || "N/A"}
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
        Score: {candidate.score.toFixed(1)} · {candidate.reasons.join(", ")}
      </p>
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
      source: docSnap.data().source || "",
      stravaActivityId: docSnap.data().stravaActivityId || "",
      athleteId: docSnap.data().athleteId || "",
      startDate: docSnap.data().startDate || "",
      startDateLocal: docSnap.data().startDateLocal || "",
      name: docSnap.data().name || "",
      distanceMeters: docSnap.data().distanceMeters || null,
      movingTimeSeconds: docSnap.data().movingTimeSeconds || null,
      elapsedTimeSeconds: docSnap.data().elapsedTimeSeconds || null,
      pace: docSnap.data().pace || "",
      paceSecondsPerKm: docSnap.data().paceSecondsPerKm || null,
      rawSportType: docSnap.data().rawSportType || "",
      workoutType: docSnap.data().workoutType ?? null,
      averageHeartrate: docSnap.data().averageHeartrate || null,
      maxHeartrate: docSnap.data().maxHeartrate || null,
      totalElevationGain: docSnap.data().totalElevationGain || 0,
      averageCadence: docSnap.data().averageCadence || null,
      averageSpeedMps: docSnap.data().averageSpeedMps || null,
      maxSpeedMps: docSnap.data().maxSpeedMps || null,
      trainer: !!docSnap.data().trainer,
      commute: !!docSnap.data().commute,
      manual: !!docSnap.data().manual,
      private: !!docSnap.data().private,
      achievementCount: docSnap.data().achievementCount || 0,
      kudosCount: docSnap.data().kudosCount || 0,
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
  const totalDistance = runs.reduce((sum, run) => sum + getRunDistanceKm(run), 0);
  const thisWeekDistance = getThisWeekDistance(runs);
  const lastWeekDistance = getLastWeekDistance(runs);
  const averagePaceSeconds = getAveragePaceSeconds(runs);
  const averagePace = formatPaceFromSeconds(averagePaceSeconds);
  const latestRun = runs[0] || null;
  const summary = getDashboardSummary(runs);

  const candidates = useMemo(() => getPredictionCandidates(runs), [runs]);
  const predictions = useMemo(() => {
    const built = [
      buildPrediction(runs, "5K", 5),
      buildPrediction(runs, "10K", 10),
      buildPrediction(runs, "Half Marathon", 21.1),
      buildPrediction(runs, "Marathon", 42.2),
    ].filter((item): item is RacePrediction => item !== null);

    return built;
  }, [runs]);

  const topEvidence = candidates.slice(0, 4);

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
        <p style={{ margin: 0, maxWidth: 760, color: "rgba(255,255,255,0.82)", lineHeight: 1.6 }}>
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
            rightText={candidates.length > 0 ? `Based on ${candidates.length} strongest recent run${candidates.length === 1 ? "" : "s"}` : ""}
          >
            {predictions.length === 0 ? (
              <p>Add more runs of at least 3 km to generate race predictions.</p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 16,
                }}
              >
                {predictions.map((prediction) => (
                  <PredictionCard key={prediction.race} prediction={prediction} />
                ))}
              </div>
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
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{getRunDistanceKm(latestRun).toFixed(2)} km</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Pace</p>
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>
                        {latestRun.movingTimeSeconds
                          ? formatPaceFromSeconds(getRunPaceSeconds(latestRun))
                          : formatPace(latestRun.time, latestRun.distance)}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Time</p>
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{latestRun.time}</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Avg HR</p>
                      <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>
                        {latestRun.averageHeartrate || latestRun.avgHr || "N/A"}
                      </p>
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
                      {latestRun.notes || latestRun.name || "No notes added for this run."}
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
            <SectionCard title="Prediction Evidence" rightText={`${topEvidence.length} highlighted`}>
              {topEvidence.length === 0 ? (
                <p>Add a few runs of at least 3 km to power the prediction engine.</p>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {topEvidence.map((candidate) => (
                    <CandidateCard key={candidate.run.id} candidate={candidate} />
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
