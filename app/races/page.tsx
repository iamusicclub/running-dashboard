"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
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

type RaceGoal = {
  id: string;
  raceName: string;
  raceDate: string;
  raceDistance: string;
  targetTime: string;
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
    return `${hours}:${minutes < 10 ? `0${minutes}` : minutes}:${
      seconds < 10 ? `0${seconds}` : seconds
    }`;
  }

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
}

function formatPace(totalSeconds: number, distanceKm: number) {
  const paceSeconds = totalSeconds / distanceKm;
  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
}

function predictTime(
  baseDistance: number,
  baseTime: number,
  targetDistance: number
) {
  return baseTime * Math.pow(targetDistance / baseDistance, 1.06);
}

function getRaceDistanceKm(raceDistance: string) {
  const value = raceDistance.toLowerCase();

  if (value === "5k") return 5;
  if (value === "10k") return 10;
  if (value === "half marathon") return 21.1;
  if (value === "marathon") return 42.2;

  return 0;
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

function getDaysUntilRace(raceDate: string) {
  const today = new Date();
  const race = new Date(raceDate);

  today.setHours(0, 0, 0, 0);
  race.setHours(0, 0, 0, 0);

  const diffMs = race.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getGoalAssessment(predictedSeconds: number, targetSeconds: number) {
  const difference = predictedSeconds - targetSeconds;

  if (difference <= -60) {
    return {
      status: "Ahead of target",
      comment:
        "Your current predicted fitness is ahead of the goal you entered.",
    };
  }

  if (difference <= 120) {
    return {
      status: "On track",
      comment:
        "Your current predicted fitness is close to your target. Consistent training should keep this realistic.",
    };
  }

  if (difference <= 420) {
    return {
      status: "Needs improvement",
      comment:
        "You are not far away, but you likely need stronger race-specific training to close the gap.",
    };
  }

  return {
    status: "Stretch target",
    comment:
      "This target currently looks ambitious relative to your recent training data.",
    };
}

export default function RacesPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [raceGoals, setRaceGoals] = useState<RaceGoal[]>([]);
  const [raceName, setRaceName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [raceDistance, setRaceDistance] = useState("");
  const [targetTime, setTargetTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadData() {
    const runsQuery = query(collection(db, "runs"), orderBy("date", "desc"));
    const raceGoalsQuery = query(
      collection(db, "raceGoals"),
      orderBy("raceDate", "asc")
    );

    const [runsSnapshot, raceGoalsSnapshot] = await Promise.all([
      getDocs(runsQuery),
      getDocs(raceGoalsQuery),
    ]);

    const runsData: Run[] = runsSnapshot.docs.map((doc) => ({
      id: doc.id,
      date: doc.data().date || "",
      distance: String(doc.data().distance || ""),
      time: String(doc.data().time || ""),
      notes: doc.data().notes || "",
      runType: doc.data().runType || "",
      avgHr: String(doc.data().avgHr || ""),
      elevation: String(doc.data().elevation || ""),
    }));

    const goalsData: RaceGoal[] = raceGoalsSnapshot.docs.map((doc) => ({
      id: doc.id,
      raceName: doc.data().raceName || "",
      raceDate: doc.data().raceDate || "",
      raceDistance: doc.data().raceDistance || "",
      targetTime: doc.data().targetTime || "",
    }));

    setRuns(runsData);
    setRaceGoals(goalsData);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      await addDoc(collection(db, "raceGoals"), {
        raceName,
        raceDate,
        raceDistance,
        targetTime,
        createdAt: new Date().toISOString(),
      });

      setRaceName("");
      setRaceDate("");
      setRaceDistance("");
      setTargetTime("");

      await loadData();
    } catch (err: any) {
      setError(err.message || "Something went wrong while saving the race goal.");
    } finally {
      setSaving(false);
    }
  }

  const raceAssessments = useMemo(() => {
    return raceGoals.map((goal) => {
      const distanceKm = getRaceDistanceKm(goal.raceDistance);
      const predictedSeconds = getPredictedSecondsForDistance(runs, distanceKm);
      const targetSeconds = timeToSeconds(goal.targetTime);
      const daysUntil = getDaysUntilRace(goal.raceDate);

      if (!predictedSeconds || !targetSeconds || !distanceKm) {
        return {
          ...goal,
          predictedTime: "Not enough data",
          predictedPace: "N/A",
          targetPace: "N/A",
          status: "Insufficient data",
          comment: "Add more runs before this goal can be assessed.",
          daysUntil,
        };
      }

      const assessment = getGoalAssessment(predictedSeconds, targetSeconds);

      return {
        ...goal,
        predictedTime: secondsToTime(predictedSeconds),
        predictedPace: formatPace(predictedSeconds, distanceKm),
        targetPace: formatPace(targetSeconds, distanceKm),
        status: assessment.status,
        comment: assessment.comment,
        daysUntil,
      };
    });
  }, [raceGoals, runs]);

  return (
    <main
      style={{
        padding: 40,
        maxWidth: 1000,
        margin: "0 auto",
        fontFamily: "Arial",
      }}
    >
      <h1>Race Planner</h1>
      <p>
        Add upcoming races and compare your current predicted fitness against
        your goal time.
      </p>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 16,
          marginTop: 24,
          marginBottom: 32,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Add Race Goal</h2>

        <form
          onSubmit={handleSubmit}
          style={{ display: "grid", gap: 12 }}
        >
          <input
            type="text"
            placeholder="Race name"
            value={raceName}
            onChange={(e) => setRaceName(e.target.value)}
            required
            style={{ padding: 12 }}
          />

          <input
            type="date"
            value={raceDate}
            onChange={(e) => setRaceDate(e.target.value)}
            required
            style={{ padding: 12 }}
          />

          <select
            value={raceDistance}
            onChange={(e) => setRaceDistance(e.target.value)}
            required
            style={{ padding: 12 }}
          >
            <option value="">Select race distance</option>
            <option value="5K">5K</option>
            <option value="10K">10K</option>
            <option value="Half Marathon">Half Marathon</option>
            <option value="Marathon">Marathon</option>
          </select>

          <input
            type="text"
            placeholder="Target time (for example 42:00 or 3:15:00)"
            value={targetTime}
            onChange={(e) => setTargetTime(e.target.value)}
            required
            style={{ padding: 12 }}
          />

          <button type="submit" disabled={saving} style={{ padding: 12 }}>
            {saving ? "Saving..." : "Save Race Goal"}
          </button>
        </form>

        {error && (
          <p style={{ color: "red", marginTop: 12 }}>
            {error}
          </p>
        )}
      </div>

      <h2>Upcoming Race Goals</h2>

      {loading && <p>Loading race goals...</p>}

      {!loading && raceAssessments.length === 0 && (
        <p>No race goals saved yet.</p>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {raceAssessments.map((goal) => (
          <div
            key={goal.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <h3 style={{ marginTop: 0 }}>{goal.raceName}</h3>
            <p><strong>Date:</strong> {goal.raceDate}</p>
            <p><strong>Distance:</strong> {goal.raceDistance}</p>
            <p><strong>Days Until Race:</strong> {goal.daysUntil}</p>
            <p><strong>Target Time:</strong> {goal.targetTime}</p>
            <p><strong>Target Pace:</strong> {goal.targetPace}</p>
            <p><strong>Current Predicted Time:</strong> {goal.predictedTime}</p>
            <p><strong>Current Predicted Pace:</strong> {goal.predictedPace}</p>
            <p><strong>Status:</strong> {goal.status}</p>
            <p><strong>Comment:</strong> {goal.comment}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 32 }}>
        <h2>Quick Links</h2>
        <ul>
          <li><a href="/">Dashboard</a></li>
          <li><a href="/runs">Runs</a></li>
          <li><a href="/predictions">Predictions</a></li>
          <li><a href="/analysis">Training Analysis</a></li>
        </ul>
      </div>
    </main>
  );
}
