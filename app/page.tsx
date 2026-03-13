"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../lib/firebase";

type Run = {
  id: string;
  date: string;
  distance: string;
  time: string;
  notes?: string;
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
  notes?: string;
};

type CandidateRun = {
  run: Run;
  distanceKm: number;
  timeSeconds: number;
  paceSecondsPerKm: number;
  daysAgo: number;
  qualityScore: number;
  effectiveWeight: number;
  predictedSeconds: number;
};

type TrendPoint = {
  date: string;
  predictedSeconds: number;
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
  strengths: string[];
  missing: string[];
  trend: TrendPoint[];
  supportingRuns: CandidateRun[];
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
  if (!paceSeconds) return "N/A";

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

function getRecentRunCount(runs: Run[]) {
  return runs.filter((run) => getDaysAgo(run.date) <= 42).length;
}

function buildCandidateRuns(runs: Run[], targetDistanceKm: number) {
  return runs
    .map((run) => {
      const distanceKm = getRunDistanceKm(run);
      const timeSeconds = getRunTimeSeconds(run);
      const paceSecondsPerKm = getRunPaceSeconds(run);
      const daysAgo = getDaysAgo(run.date);

      if (!distanceKm || !timeSeconds || distanceKm < 3) {
        return null;
      }

      let qualityScore = 1;

      if (run.runType === "race" || run.workoutType === 1) qualityScore += 5;
      else if (run.runType === "tempo") qualityScore += 4;
      else if (run.runType === "interval") qualityScore += 3;
      else if (run.runType === "long") qualityScore += 2;
      else if (run.runType === "easy") qualityScore += 1;
      else if (run.runType === "recovery") qualityScore += 0.25;

      if (distanceKm >= 5) qualityScore += 1;
      if (distanceKm >= 10) qualityScore += 1;
      if (distanceKm >= 16) qualityScore += 1.5;

      const avgHr =
        run.averageHeartrate && run.averageHeartrate > 0
          ? run.averageHeartrate
          : parseFloat(run.avgHr || "0");

      if (avgHr >= 150) qualityScore += 1;
      if (avgHr >= 165) qualityScore += 0.5;

      if (daysAgo <= 7) qualityScore += 2.5;
      else if (daysAgo <= 21) qualityScore += 1.5;
      else if (daysAgo <= 42) qualityScore += 0.75;
      else qualityScore -= 1;

      if (run.totalElevationGain && run.totalElevationGain > 250) {
        qualityScore -= 0.5;
      }

      if (run.trainer) {
        qualityScore -= 1;
      }

      const distanceRatio =
        Math.min(distanceKm, targetDistanceKm) / Math.max(distanceKm, targetDistanceKm);

      let specificityWeight = 0.55 + distanceRatio * 0.95;

      if (targetDistanceKm <= 8.5) {
        if (
          run.runType === "race" ||
          run.runType === "tempo" ||
          run.runType === "interval"
        ) {
          specificityWeight *= 1.18;
        }
        if (run.runType === "long") specificityWeight *= 0.9;
      } else if (targetDistanceKm <= 21.1) {
        if (run.runType === "tempo" || run.runType === "race") specificityWeight *= 1.12;
        if (distanceKm >= 10) specificityWeight *= 1.08;
      } else {
        if (run.runType === "long") specificityWeight *= 1.18;
        if (distanceKm >= 16) specificityWeight *= 1.15;
        if (distanceKm < 5) specificityWeight *= 0.82;
      }

      const freshnessWeight =
        daysAgo <= 7 ? 1.15 : daysAgo <= 21 ? 1.08 : daysAgo <= 42 ? 1.0 : 0.9;

      const predictedSeconds = predictTime(distanceKm, timeSeconds, targetDistanceKm);
      const effectiveWeight = Math.max(0.1, qualityScore) * specificityWeight * freshnessWeight;

      return {
        run,
        distanceKm,
        timeSeconds,
        paceSecondsPerKm,
        daysAgo,
        qualityScore,
        effectiveWeight,
        predictedSeconds,
      } as CandidateRun;
    })
    .filter((item): item is CandidateRun => item !== null)
    .sort((a, b) => a.predictedSeconds - b.predictedSeconds)
    .slice(0, 12);
}

function getConservativePenaltyMultiplier(
  runs: Run[],
  targetDistanceKm: number,
  confidence: string
) {
  const weeklyMileage = getWeeklyMileage(runs);
  const longestRun = getLongestRecentRun(runs);

  let multiplier = 1;

  if (targetDistanceKm >= 30) {
    if (weeklyMileage < 20) multiplier *= 1.003;
    if (longestRun < 16) multiplier *= 1.006;
    if (confidence === "Low") multiplier *= 1.005;
  } else if (targetDistanceKm >= 18) {
    if (weeklyMileage < 18) multiplier *= 1.002;
    if (longestRun < 12) multiplier *= 1.004;
    if (confidence === "Low") multiplier *= 1.003;
  }

  return multiplier;
}

function getConfidenceForDistance(runs: Run[], targetDistanceKm: number) {
  const candidates = buildCandidateRuns(runs, targetDistanceKm);
  const weeklyMileage = getWeeklyMileage(runs);
  const longestRun = getLongestRecentRun(runs);

  const raceLike = candidates.filter(
    (c) =>
      c.run.runType === "race" ||
      c.run.runType === "tempo" ||
      c.run.runType === "interval"
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
  const confidence = getConfidenceForDistance(runs, targetDistanceKm);
  const candidates = buildCandidateRuns(runs, targetDistanceKm);

  if (candidates.length === 0) {
    return {
      estimateSeconds: null as number | null,
      supportingRuns: [] as CandidateRun[],
      confidence,
    };
  }

  const weightedSum = candidates.reduce(
    (sum, item) => sum + item.predictedSeconds * item.effectiveWeight,
    0
  );
  const totalWeight = candidates.reduce((sum, item) => sum + item.effectiveWeight, 0);

  let estimateSeconds = weightedSum / totalWeight;

  const topThree = [...candidates]
    .sort((a, b) => a.predictedSeconds - b.predictedSeconds)
    .slice(0, 3);

  const optimisticBlend =
    topThree.reduce((sum, item) => sum + item.predictedSeconds, 0) / topThree.length;

  estimateSeconds = estimateSeconds * 0.72 + optimisticBlend * 0.28;

  const penaltyMultiplier = getConservativePenaltyMultiplier(runs, targetDistanceKm, confidence);
  estimateSeconds *= penaltyMultiplier;

  return {
    estimateSeconds,
    supportingRuns: candidates
      .sort((a, b) => b.effectiveWeight - a.effectiveWeight)
      .slice(0, 4),
    confidence,
  };
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

function buildRaceNeeds(runs: Run[], targetDistanceKm: number) {
  const candidates = buildCandidateRuns(runs, targetDistanceKm);
  const weeklyMileage = getWeeklyMileage(runs);
  const longestRun = getLongestRecentRun(runs);

  const tempoCount = candidates.filter((c) => c.run.runType === "tempo").length;
  const intervalCount = candidates.filter((c) => c.run.runType === "interval").length;
  const raceCount = candidates.filter((c) => c.run.runType === "race").length;
  const longCount = candidates.filter((c) => c.run.runType === "long").length;
  const recentCandidates = candidates.filter((c) => getDaysAgo(c.run.date) <= 21).length;

  const strengths: string[] = [];
  const missing: string[] = [];

  if (recentCandidates >= 3) {
    strengths.push("Recent quality evidence is present.");
  } else {
    missing.push("Recent race-specific evidence is still limited.");
  }

  if (targetDistanceKm <= 10) {
    if (tempoCount + intervalCount + raceCount >= 3) {
      strengths.push("You have enough sharper work supporting shorter-distance fitness.");
    } else {
      missing.push("More tempo, interval, or race-effort work would strengthen short-race confidence.");
    }

    if (weeklyMileage >= 25) {
      strengths.push("Weekly volume is solid enough to support shorter-race performance.");
    } else {
      missing.push("A bit more consistent weekly volume would improve stability.");
    }
  } else if (targetDistanceKm <= 21.1) {
    if (tempoCount + raceCount >= 2) {
      strengths.push("Threshold-style evidence is supporting the race well.");
    } else {
      missing.push("More threshold or race-effort sessions would strengthen half-marathon readiness.");
    }

    if (longestRun >= 14) {
      strengths.push("Long-run depth is beginning to support endurance well.");
    } else {
      missing.push("A longer endurance run would improve confidence for this race.");
    }

    if (weeklyMileage >= 30) {
      strengths.push("Recent mileage supports the target reasonably well.");
    } else {
      missing.push("More weekly mileage would make this target more convincing.");
    }
  } else {
    if (longestRun >= 24) {
      strengths.push("Long-run evidence is meaningful for long-distance preparation.");
    } else {
      missing.push("Longer long runs are still missing for strong long-race confidence.");
    }

    if (longCount >= 2) {
      strengths.push("There is at least some long-run structure in the recent data.");
    } else {
      missing.push("More specific long-run work would help this target.");
    }

    if (weeklyMileage >= 45) {
      strengths.push("Mileage is starting to look marathon-supportive.");
    } else {
      missing.push("Higher consistent mileage would materially improve longer-race readiness.");
    }

    if (tempoCount + raceCount >= 1) {
      strengths.push("There is at least some quality support alongside endurance work.");
    } else {
      missing.push("A little more threshold-style quality would round out the build.");
    }
  }

  if (strengths.length === 0) {
    strengths.push("General training consistency is still providing some support.");
  }

  if (missing.length === 0) {
    missing.push("No obvious major gaps stand out right now.");
  }

  return { strengths, missing };
}

function buildTrendForDistance(runs: Run[], targetDistanceKm: number) {
  const ordered = [...runs].sort((a, b) => a.date.localeCompare(b.date));
  const trend: TrendPoint[] = [];

  for (let i = 4; i < ordered.length; i++) {
    const subset = ordered.slice(0, i + 1);
    const estimate = buildEstimateForDistance(subset, targetDistanceKm).estimateSeconds;

    if (estimate) {
      trend.push({
        date: ordered[i].date,
        predictedSeconds: estimate,
      });
    }
  }

  return trend.slice(-10);
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
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "#6b7280",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 14,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 22, color: "#111827" }}>{title}</h2>
        {rightText && <span style={{ fontSize: 13, color: "#6b7280" }}>{rightText}</span>}
      </div>
      {children}
    </div>
  );
}

function TrendChart({
  trend,
  targetSeconds,
}: {
  trend: TrendPoint[];
  targetSeconds: number | null;
}) {
  if (trend.length < 2 || !targetSeconds) {
    return <p style={{ margin: 0, color: "#6b7280" }}>Not enough history for a trend yet.</p>;
  }

  const width = 340;
  const height = 140;
  const padding = 16;

  const values = trend.map((point) => point.predictedSeconds).concat(targetSeconds);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const x = (index: number) =>
    padding + (index / Math.max(1, trend.length - 1)) * (width - padding * 2);

  const y = (value: number) =>
    height - padding - ((value - min) / Math.max(1, max - min)) * (height - padding * 2);

  const path = trend
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.predictedSeconds)}`)
    .join(" ");

  const targetY = y(targetSeconds);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 150 }}>
      <line
        x1={padding}
        x2={width - padding}
        y1={targetY}
        y2={targetY}
        stroke="#dc2626"
        strokeDasharray="5 5"
        strokeWidth="2"
      />
      <path d={path} fill="none" stroke="#2563eb" strokeWidth="3" />
      {trend.map((point, index) => (
        <circle
          key={`${point.date}-${index}`}
          cx={x(index)}
          cy={y(point.predictedSeconds)}
          r="3.5"
          fill="#2563eb"
        />
      ))}
    </svg>
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
  const recentRunCount = getRecentRunCount(runs);

  const raceAssessments = useMemo(() => {
    return races.map((race) => {
      const distanceKm = parseFloat(race.distanceKm || "0");
      const targetSeconds = timeToSeconds(race.targetTime || "");
      const estimateResult =
        distanceKm > 0
          ? buildEstimateForDistance(runs, distanceKm)
          : { estimateSeconds: null, supportingRuns: [], confidence: "Low" };
      const estimateSeconds = estimateResult.estimateSeconds;
      const confidence = estimateResult.confidence;
      const gapSeconds =
        targetSeconds !== null && estimateSeconds !== null
          ? estimateSeconds - targetSeconds
          : null;
      const daysToRace = getDaysToRace(race.date);
      const status = getStatus(gapSeconds, targetSeconds, daysToRace, confidence);
      const needs = buildRaceNeeds(runs, distanceKm);
      const trend = buildTrendForDistance(runs, distanceKm);

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
        strengths: needs.strengths,
        missing: needs.missing,
        trend,
        supportingRuns: estimateResult.supportingRuns,
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
        <p
          style={{
            margin: 0,
            fontSize: 13,
            letterSpacing: 1,
            textTransform: "uppercase",
            opacity: 0.75,
          }}
        >
          Race Command Centre
        </p>
        <h1 style={{ margin: "10px 0 10px 0", fontSize: 38, lineHeight: 1.1 }}>
          Accuracy-first race targeting
        </h1>
        <p style={{ margin: 0, maxWidth: 820, color: "rgba(255,255,255,0.82)", lineHeight: 1.6 }}>
          The model is now less punitive and more evidence-driven. Estimates lean on your best relevant
          recent sessions, while long-distance penalties are kept deliberately modest.
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
              label="Recent Run Count"
              value={String(recentRunCount)}
              subtext="Runs in the last 6 weeks"
            />
            <StatCard
              label="Next Race"
              value={nextRace ? nextRace.name : "None"}
              subtext={nextRace && nextRace.daysToRace !== null ? `${nextRace.daysToRace} days to go` : "Add a race target"}
            />
          </div>

          <SectionCard title="Target Race Cards" rightText="Trend + strengths + gaps">
            {raceAssessments.length === 0 ? (
              <p>
                No target races saved yet. Go to <a href="/races">Races</a> and add your key events first.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
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
                        marginBottom: 12,
                      }}
                    >
                      <p style={{ margin: 0, color: "#374151" }}>{race.summary}</p>
                    </div>

                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 12,
                        marginBottom: 12,
                      }}
                    >
                      <p style={{ margin: "0 0 8px 0", fontWeight: 700 }}>Goal-gap trend</p>
                      <TrendChart trend={race.trend} targetSeconds={race.targetSeconds} />
                    </div>

                    <div
                      style={{
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 12,
                        padding: 12,
                        marginBottom: 12,
                      }}
                    >
                      <p style={{ margin: 0, fontWeight: 700, color: "#1d4ed8" }}>Best supporting runs</p>
                      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                        {race.supportingRuns.length === 0 ? (
                          <p style={{ margin: 0, color: "#1e3a8a" }}>No supporting runs yet.</p>
                        ) : (
                          race.supportingRuns.map((item) => (
                            <div key={`${race.id}-${item.run.id}`} style={{ color: "#1e3a8a", fontSize: 14 }}>
                              <strong>{item.run.date}</strong> · {item.distanceKm.toFixed(2)} km in{" "}
                              {secondsToTime(item.timeSeconds)} · {formatPaceFromSeconds(item.paceSecondsPerKm)}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          borderRadius: 12,
                          padding: 12,
                        }}
                      >
                        <p style={{ margin: 0, fontWeight: 700, color: "#166534" }}>What is helping</p>
                        <ul style={{ margin: "8px 0 0 18px", color: "#166534" }}>
                          {race.strengths.map((item) => (
                            <li key={item} style={{ marginBottom: 6 }}>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div
                        style={{
                          background: "#fff7ed",
                          border: "1px solid #fed7aa",
                          borderRadius: 12,
                          padding: 12,
                        }}
                      >
                        <p style={{ margin: 0, fontWeight: 700, color: "#9a3412" }}>What is missing</p>
                        <ul style={{ margin: "8px 0 0 18px", color: "#9a3412" }}>
                          {race.missing.map((item) => (
                            <li key={item} style={{ marginBottom: 6 }}>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
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
            <SectionCard title="Accuracy notes">
              <div style={{ display: "grid", gap: 10, color: "#374151" }}>
                <p style={{ margin: 0 }}>
                  The model now leans more on your strongest relevant sessions instead of heavily penalising
                  missing long-run or mileage evidence.
                </p>
                <p style={{ margin: 0 }}>
                  From here, the next work should focus on accuracy calibration rather than adding more widgets.
                </p>
              </div>
            </SectionCard>

            <SectionCard title="Latest Run">
              {latestRun ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <p style={{ margin: 0 }}>
                    <strong>Date:</strong> {latestRun.date}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Distance:</strong> {getRunDistanceKm(latestRun).toFixed(2)} km
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Time:</strong> {latestRun.time}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Pace:</strong>{" "}
                    {latestRun.movingTimeSeconds
                      ? formatPaceFromSeconds(getRunPaceSeconds(latestRun))
                      : formatPace(latestRun.time, latestRun.distance)}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Type:</strong> {latestRun.runType || "N/A"}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Avg HR:</strong> {latestRun.averageHeartrate || latestRun.avgHr || "N/A"}
                  </p>
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
