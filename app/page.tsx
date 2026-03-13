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
  distanceMeters?: number;
  movingTimeSeconds?: number;
  paceSecondsPerKm?: number | null;
  workoutType?: number | null;
  averageHeartrate?: number | null;
  totalElevationGain?: number;
  trainer?: boolean;
};

type RaceGoal = {
  id: string;
  name: string;
  date: string;
  distanceKm: string;
  targetTime: string;
  priority: string;
  notes: string;
};

type CandidateRun = {
  run: Run;
  distanceKm: number;
  timeSeconds: number;
  paceSecondsPerKm: number;
  score: number;
  reasons: string[];
};

type RaceAssessment = {
  id: string;
  name: string;
  date: string;
  distanceKm: number;
  priority: string;
  targetTime: string;
  targetSeconds: number | null;
  targetPace: string;
  currentEstimate: string;
  currentEstimateSeconds: number | null;
  currentPace: string;
  gapText: string;
  gapSeconds: number | null;
  daysToRace: number | null;
  status: string;
  statusColor: string;
  summary: string;
  confidence: string;
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

function formatPaceFromSeconds(paceSeconds: number | null) {
  if (!paceSeconds) {
    return "N/A";
  }

  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
}

function formatPace(time: string, distance: string) {
  const totalSeconds = timeToSeconds(time);
  const distanceNum = parseFloat(distance);

  if (!totalSeconds || !distanceNum || distanceNum <= 0) {
    return "N/A";
  }

  return formatPaceFromSeconds(totalSeconds / distanceNum);
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

function getDaysToRace(date: string) {
  if (!date) return null;

  const today = new Date();
  const raceDate = new Date(date);

  today.setHours(0, 0, 0, 0);
  raceDate.setHours(0, 0, 0, 0);

  const diff = raceDate.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
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

  if (distanceKm >= 5) score += 2;
  if (distanceKm >= 10) score += 2;
  if (distanceKm >= 16) score += 3;

  if (avgHr >= 150) score += 2;
  if (avgHr >= 165) score += 1;

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
    reasons.push("Hilly route");
  }

  if (run.trainer) {
    score -= 2;
    reasons.push("Indoor effort");
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
    .slice(0, 10);
}

function getDistanceSpecificWeight(candidate: CandidateRun, targetDistanceKm: number) {
  const sourceDistance = candidate.distanceKm;
  const distanceRatio =
    Math.min(sourceDistance, targetDistanceKm) / Math.max(sourceDistance, targetDistanceKm);

  let weight = candidate.score + 1;
  weight *= 0.6 + distanceRatio * 0.85;

  if (targetDistanceKm <= 10) {
    if (
      candidate.run.runType === "race" ||
      candidate.run.runType === "tempo" ||
      candidate.run.runType === "interval"
    ) {
      weight *= 1.18;
    }
    if (candidate.run.runType === "long") {
      weight *= 0.92;
    }
  }

  if (targetDistanceKm > 10 && targetDistanceKm <= 21.1) {
    if (candidate.run.runType === "tempo" || candidate.run.runType === "race") {
      weight *= 1.12;
    }
    if (candidate.distanceKm >= 10) {
      weight *= 1.08;
    }
  }

  if (targetDistanceKm > 21.1) {
    if (candidate.run.runType === "long") {
      weight *= 1.12;
    }
    if (candidate.distanceKm >= 16) {
      weight *= 1.12;
    }
    if (candidate.distanceKm < 5) {
      weight *= 0.82;
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

function getConfidenceForDistance(runs: Run[], targetDistanceKm: number) {
  const candidates = getPredictionCandidates(runs);
  const weeklyMileage = getWeeklyMileage(runs);
  const longestRun = getLongestRecentRun(runs);

  const raceLike = candidates.filter(
    (c) => c.run.runType === "race" || c.run.runType === "tempo" || c.run.runType === "interval"
  ).length;

  let score = 0;

  if (candidates.length >= 6) score += 2;
  else if (candidates.length >= 3) score += 1;

  if (raceLike >= 3) score += 2;
  else if (raceLike >= 1) score += 1;

  if (targetDistanceKm <= 10) {
    if (score >= 4) return "High";
    if (score >= 2) return "Moderate";
    return "Low";
  }

  if (targetDistanceKm <= 21.1) {
    if (weeklyMileage >= 40) score += 2;
    else if (weeklyMileage >= 25) score += 1;

    if (longestRun >= 18) score += 2;
    else if (longestRun >= 14) score += 1;

    if (score >= 5) return "High";
    if (score >= 3) return "Moderate";
    return "Low";
  }

  if (weeklyMileage >= 55) score += 2;
  else if (weeklyMileage >= 35) score += 1;

  if (longestRun >= 28) score += 2;
  else if (longestRun >= 20) score += 1;

  if (score >= 6) return "High";
  if (score >= 4) return "Moderate";
  return "Low";
}

function buildEstimateForDistance(runs: Run[], targetDistanceKm: number) {
  const candidates = getPredictionCandidates(runs);

  if (candidates.length === 0) {
    return null;
  }

  const weightedPredictions = candidates.map((candidate) => {
    const predictedSeconds = predictTime(candidate.distanceKm, candidate.timeSeconds, targetDistanceKm);
    const weight = getDistanceSpecificWeight(candidate, targetDistanceKm);
    return { predictedSeconds, weight };
  });

  const weightedSum = weightedPredictions.reduce(
    (sum, item) => sum + item.predictedSeconds * item.weight,
    0
  );
  const totalWeight = weightedPredictions.reduce((sum, item) => sum + item.weight, 0);

  let predictedSeconds = weightedSum / totalWeight;

  const weeklyMileage = getWeeklyMileage(runs);
  const longestRun = getLongestRecentRun(runs);

  if (targetDistanceKm >= 30) {
    if (weeklyMileage < 20) predictedSeconds *= 1.005;
    if (longestRun < 16) predictedSeconds *= 1.01;
  } else if (targetDistanceKm >= 18) {
    if (weeklyMileage < 18) predictedSeconds *= 1.003;
    if (longestRun < 12) predictedSeconds *= 1.008;
  }

  return predictedSeconds;
}

function getGapText(gapSeconds: number | null) {
  if (gapSeconds === null) return "N/A";

  const abs = Math.abs(gapSeconds);
  const text = secondsToTime(abs);

  if (gapSeconds <= -1) return `${text} ahead`;
  if (gapSeconds >= 1) return `${text} behind`;
  return "On target";
}

function getStatus(
  gapSeconds: number | null,
  targetSeconds: number | null,
  daysToRace: number | null,
  confidence: string
) {
  if (gapSeconds === null || targetSeconds === null) {
    return {
      label: "No estimate yet",
      color: "#6b7280",
      summary: "Add more runs to generate a race estimate.",
    };
  }

  const gapPct = gapSeconds / targetSeconds;

  if (gapPct <= -0.01) {
    return {
      label: "Ahead of target",
      color: "#059669",
      summary: "Current estimate is meaningfully ahead of the target.",
    };
  }

  if (gapPct <= 0.02) {
    return {
      label: "On track",
      color: "#2563eb",
      summary: "Current estimate sits close enough to the target to be considered on track.",
    };
  }

  if (confidence === "Low") {
    return {
      label: "Needs evidence",
      color: "#7c3aed",
      summary: "The estimate is slightly behind target, but the current evidence base is still thin.",
    };
  }

  if (daysToRace !== null && daysToRace > 70) {
    return {
      label: "On track",
      color: "#2563eb",
      summary: "There is still enough time in the build to close this gap.",
    };
  }

  return {
    label: "Behind target",
    color: "#dc2626",
    summary: "Current estimate sits behind target and now needs more race-specific progress.",
  };
}

function priorityColor(priority: string) {
  if (priority === "A") return "#1d4ed8";
  if (priority === "B") return "#7c3aed";
  return "#6b7280";
}

function confidenceColor(confidence: string) {
  if (confidence === "High") return "#059669";
  if (confidence === "Moderate") return "#d97706";
  return "#7c3aed";
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
  const [races, setRaces] = useState<RaceGoal[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    const runsQuery = query(collection(db, "runs"), orderBy("date", "desc"));
    const racesQuery = query(collection(db, "raceGoals"), orderBy("date", "asc"));

    const [runsSnapshot, racesSnapshot] = await Promise.all([
      getDocs(runsQuery),
      getDocs(racesQuery),
    ]);

    const runData: Run[] = runsSnapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      date: docSnap.data().date || "",
      distance: String(docSnap.data().distance || ""),
      time: String(docSnap.data().time || ""),
      notes: docSnap.data().notes || "",
      runType: docSnap.data().runType || "",
      avgHr: String(docSnap.data().avgHr || ""),
      elevation: String(docSnap.data().elevation || ""),
      source: docSnap.data().source || "",
      distanceMeters: docSnap.data().distanceMeters || null,
      movingTimeSeconds: docSnap.data().movingTimeSeconds || null,
      paceSecondsPerKm: docSnap.data().paceSecondsPerKm || null,
      workoutType: docSnap.data().workoutType ?? null,
      averageHeartrate: docSnap.data().averageHeartrate || null,
      totalElevationGain: docSnap.data().totalElevationGain || 0,
      trainer: !!docSnap.data().trainer,
    }));

    const raceData: RaceGoal[] = racesSnapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      name: docSnap.data().name || "",
      date: docSnap.data().date || "",
      distanceKm: String(docSnap.data().distanceKm || ""),
      targetTime: docSnap.data().targetTime || "",
      priority: docSnap.data().priority || "A",
      notes: docSnap.data().notes || "",
    }));

    setRuns(runData);
    setRaces(raceData);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const totalRuns = runs.length;
  const weeklyMileage = getWeeklyMileage(runs);
  const longestRun = getLongestRecentRun(runs);
  const latestRun = runs[0] || null;

  const raceAssessments = useMemo(() => {
    return races.map((race) => {
      const distanceKm = parseFloat(race.distanceKm || "0");
      const targetSeconds = timeToSeconds(race.targetTime || "");
      const estimateSeconds =
        distanceKm > 0 ? buildEstimateForDistance(runs, distanceKm) : null;
      const gapSeconds =
        targetSeconds !== null && estimateSeconds !== null
          ? estimateSeconds - targetSeconds
          : null;
      const daysToRace = getDaysToRace(race.date);
      const confidence = getConfidenceForDistance(runs, distanceKm);
      const status = getStatus(gapSeconds, targetSeconds, daysToRace, confidence);

      return {
        id: race.id,
        name: race.name,
        date: race.date,
        distanceKm,
        priority: race.priority,
        targetTime: race.targetTime,
        targetSeconds,
        targetPace:
          targetSeconds !== null && distanceKm > 0
            ? formatPaceFromSeconds(targetSeconds / distanceKm)
            : "N/A",
        currentEstimate: estimateSeconds !== null ? secondsToTime(estimateSeconds) : "N/A",
        currentEstimateSeconds: estimateSeconds,
        currentPace:
          estimateSeconds !== null && distanceKm > 0
            ? formatPaceFromSeconds(estimateSeconds / distanceKm)
            : "N/A",
        gapText: getGapText(gapSeconds),
        gapSeconds,
        daysToRace,
        status: status.label,
        statusColor: status.color,
        summary: status.summary,
        confidence,
      } as RaceAssessment;
    });
  }, [races, runs]);

  const nextRace = raceAssessments.length > 0 ? raceAssessments[0] : null;

  return (
    <main style={{ display: "grid", gap: 24 }}>
      <div
        style={{
          padding: 24,
          borderRadius: 22,
          background: "linear-gradient(135deg, #111827, #1f2937)",
          color: "white",
        }}
      >
        <p style={{ margin: 0, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", opacity: 0.75 }}>
          Race Command Centre
        </p>
        <h1 style={{ margin: "10px 0 10px 0", fontSize: 38, lineHeight: 1.1 }}>
          Training should serve your target races
        </h1>
        <p style={{ margin: 0, maxWidth: 780, color: "rgba(255,255,255,0.82)", lineHeight: 1.6 }}>
          These race cards now use softer status logic. The site separates “behind target” from
          “needs more evidence” and gives a wider on-track band when the gap is small.
        </p>
      </div>

      {loading ? (
        <p>Loading homepage...</p>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            <StatCard label="Target Races" value={String(races.length)} subtext="Saved on the Races page" />
            <StatCard label="Weekly Mileage" value={`${weeklyMileage.toFixed(1)} km`} subtext="Average over last 28 days" />
            <StatCard label="Longest Recent Run" value={`${longestRun.toFixed(1)} km`} subtext="Best long-run evidence from last 6 weeks" />
            <StatCard
              label="Next Race"
              value={nextRace ? nextRace.name : "None"}
              subtext={nextRace && nextRace.daysToRace !== null ? `${nextRace.daysToRace} days to go` : "Add a race target"}
            />
          </div>

          <SectionCard title="Target Race Cards" rightText="Softer status logic enabled">
            {raceAssessments.length === 0 ? (
              <p>
                No target races saved yet. Go to <a href="/races">Races</a> and add your key events first.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 16,
                }}
              >
                {raceAssessments.map((race) => (
                  <div
                    key={race.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 18,
                      padding: 18,
                      background: "white",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                        marginBottom: 12,
                      }}
                    >
                      <h3 style={{ margin: 0 }}>{race.name}</h3>

                      <span
                        style={{
                          background: priorityColor(race.priority),
                          color: "white",
                          padding: "5px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {race.priority} priority
                      </span>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                        marginBottom: 14,
                      }}
                    >
                      <div>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Race date</p>
                        <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{race.date}</p>
                      </div>

                      <div>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Distance</p>
                        <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{race.distanceKm.toFixed(2)} km</p>
                      </div>

                      <div>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Target time</p>
                        <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{race.targetTime}</p>
                      </div>

                      <div>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Target pace</p>
                        <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{race.targetPace}</p>
                      </div>

                      <div>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Current estimate</p>
                        <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{race.currentEstimate}</p>
                      </div>

                      <div>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Current pace</p>
                        <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{race.currentPace}</p>
                      </div>

                      <div>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Gap to target</p>
                        <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{race.gapText}</p>
                      </div>

                      <div>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Days to race</p>
                        <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>
                          {race.daysToRace !== null ? race.daysToRace : "N/A"}
                        </p>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        marginBottom: 12,
                      }}
                    >
                      <span
                        style={{
                          border: `1px solid ${race.statusColor}`,
                          color: race.statusColor,
                          padding: "5px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {race.status}
                      </span>

                      <span
                        style={{
                          border: `1px solid ${confidenceColor(race.confidence)}`,
                          color: confidenceColor(race.confidence),
                          padding: "5px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {race.confidence} confidence
                      </span>
                    </div>

                    <div
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        background: "#f8fafc",
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      <p style={{ margin: 0, color: "#374151" }}>{race.summary}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            <SectionCard title="Interpretation notes">
              <div style={{ display: "grid", gap: 10, color: "#374151" }}>
                <p style={{ margin: 0 }}>
                  “On track” now covers small gaps rather than calling them behind too early.
                </p>
                <p style={{ margin: 0 }}>
                  “Needs evidence” is used when the current training data is too thin to justify a harsh conclusion.
                </p>
              </div>
            </SectionCard>

            <SectionCard title="Latest Run">
              {latestRun ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <p style={{ margin: 0 }}><strong>Date:</strong> {latestRun.date}</p>
                  <p style={{ margin: 0 }}><strong>Distance:</strong> {getRunDistanceKm(latestRun).toFixed(2)} km</p>
                  <p style={{ margin: 0 }}><strong>Time:</strong> {latestRun.time}</p>
                  <p style={{ margin: 0 }}>
                    <strong>Pace:</strong>{" "}
                    {latestRun.movingTimeSeconds
                      ? formatPaceFromSeconds(getRunPaceSeconds(latestRun))
                      : formatPace(latestRun.time, latestRun.distance)}
                  </p>
                  <p style={{ margin: 0 }}><strong>Type:</strong> {latestRun.runType || "N/A"}</p>
                  <p style={{ margin: 0 }}><strong>Avg HR:</strong> {latestRun.averageHeartrate || latestRun.avgHr || "N/A"}</p>
                </div>
              ) : (
                <p>No runs saved yet.</p>
              )}
            </SectionCard>
          </div>

          <SectionCard title="Quick Links">
            <div style={{ display: "grid", gap: 12 }}>
              <a href="/races">Open Races</a>
              <a href="/runs">Open Runs</a>
              <a href="/analysis">Open Analysis</a>
            </div>
          </SectionCard>
        </>
      )}
    </main>
  );
}
