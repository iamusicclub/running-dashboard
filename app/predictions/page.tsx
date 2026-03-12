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

function formatPace(totalSeconds: number, distanceKm: number) {
  const paceSeconds = totalSeconds / distanceKm;
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
    if (candidate.run.runType === "race" || candidate.run.runType === "tempo" || candidate.run.runType === "interval") {
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

  let weightedSum = weightedPredictions.reduce((sum, item) => sum + item.predictedSeconds * item.weight, 0);
  let totalWeight = weightedPredictions.reduce((sum, item) => sum + item.weight, 0);

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
      reason = "Supported by recent harder efforts that are strongly relevant to shorter-distance fitness.";
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
      reason = "Half-marathon prediction is still being projected from shorter or less endurance-specific data.";
    }
  }

  if (distanceKm === 42.2) {
    if (weeklyMileage >= 40 && longestRun >= 24) {
      confidence = "Moderate";
      reason = "There is meaningful endurance evidence, but marathon prediction remains harder than shorter-distance forecasting.";
    } else {
      confidence = "Low";
      reason = "Marathon prediction is speculative because the recent data does not yet show enough marathon-specific volume or long-run depth.";
    }
  }

  return {
    race,
    distanceKm,
    predictedSeconds,
    predictedTime: secondsToTime(predictedSeconds),
    targetPace: formatPace(predictedSeconds, distanceKm),
    confidence,
    reason,
  };
}

function SummaryCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
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
      <p style={{ margin: "10px 0 6px 0", fontSize: 30, fontWeight: 700, color: "#111827" }}>
        {value}
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{helper}</p>
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

function CandidateCard({ candidate }: { candidate: CandidateRun }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 16,
        background: "#f8fafc",
        border: "1px solid #e5e7eb",
      }}
    >
      <p style={{ margin: 0, fontWeight: 700, color: "#111827" }}>
        {candidate.run.date} · {candidate.distanceKm.toFixed(2)} km in {secondsToTime(candidate.timeSeconds)}
      </p>
      <p style={{ margin: "6px 0 8px 0", color: "#4b5563" }}>
        {candidate.run.runType || "unknown"} · {formatPace(candidate.timeSeconds, candidate.distanceKm)} · HR{" "}
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
        <h2 style={{ margin: 0, color: "#111827" }}>{title}</h2>
        {rightText && <span style={{ fontSize: 13, color: "#6b7280" }}>{rightText}</span>}
      </div>
      {children}
    </div>
  );
}

export default function PredictionsPage() {
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

  const candidates = useMemo(() => getPredictionCandidates(runs), [runs]);
  const weeklyMileage = useMemo(() => getWeeklyMileage(runs), [runs]);
  const longestRecentRun = useMemo(() => getLongestRecentRun(runs), [runs]);

  const predictions = useMemo(() => {
    const built = [
      buildPrediction(runs, "5K", 5),
      buildPrediction(runs, "10K", 10),
      buildPrediction(runs, "Half Marathon", 21.1),
      buildPrediction(runs, "Marathon", 42.2),
    ].filter((item): item is RacePrediction => item !== null);

    return built;
  }, [runs]);

  if (loading) {
    return (
      <main style={{ padding: 40 }}>
        <h1>Predictions</h1>
        <p>Loading runs...</p>
      </main>
    );
  }

  if (predictions.length === 0) {
    return (
      <main style={{ padding: 40 }}>
        <h1>Predictions</h1>
        <p>Add more runs of at least 3 km or sync more Strava data to generate predictions.</p>
      </main>
    );
  }

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
          Predictions
        </p>
        <h1 style={{ margin: "10px 0 10px 0", fontSize: 38, lineHeight: 1.1 }}>
          Smarter race forecasts from richer run data
        </h1>
        <p style={{ margin: 0, maxWidth: 760, color: "rgba(255,255,255,0.82)", lineHeight: 1.6 }}>
          These predictions now use moving time, run type, heart-rate-supported effort clues, recency,
          and distance-specific weighting. That makes them more robust than a simple best-run extrapolation.
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
        <SummaryCard
          label="Prediction Candidates"
          value={String(candidates.length)}
          helper="Recent runs judged useful for forecasting"
        />
        <SummaryCard
          label="Weekly Mileage"
          value={`${weeklyMileage.toFixed(1)} km`}
          helper="Average over the last 28 days"
        />
        <SummaryCard
          label="Longest Recent Run"
          value={`${longestRecentRun.toFixed(1)} km`}
          helper="Best long-run evidence from the last 6 weeks"
        />
        <SummaryCard
          label="Data Quality"
          value={candidates.length >= 5 ? "Strong" : candidates.length >= 3 ? "Fair" : "Thin"}
          helper="More varied quality efforts improve forecasts"
        />
      </div>

      <SectionCard title="Predicted Race Fitness" rightText="Distance-specific weighted model">
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
      </SectionCard>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          marginTop: 24,
        }}
      >
        <SectionCard title="Evidence Used" rightText={`${candidates.length} strongest run${candidates.length === 1 ? "" : "s"}`}>
          {candidates.length === 0 ? (
            <p>No strong prediction candidates yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {candidates.map((candidate) => (
                <CandidateCard key={candidate.run.id} candidate={candidate} />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="How To Improve Accuracy">
          <div style={{ display: "grid", gap: 12, color: "#374151", lineHeight: 1.5 }}>
            <p style={{ margin: 0 }}>
              Predictions get better when your data includes a wider spread of useful evidence.
            </p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>Sync more recent Strava activities.</li>
              <li>Include actual races, tempo runs, and long runs.</li>
              <li>Log heart rate where possible.</li>
              <li>Keep long runs and weekly mileage visible if you care about half or marathon accuracy.</li>
              <li>Use the manual form to correct run type if Strava imports something too generically.</li>
            </ul>
          </div>
        </SectionCard>
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionCard title="Quick Links">
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <a href="/">Dashboard</a>
            <a href="/runs">Runs</a>
            <a href="/analysis">Training Analysis</a>
            <a href="/races">Race Planner</a>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
