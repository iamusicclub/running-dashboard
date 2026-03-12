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
};

type RacePrediction = {
  race: string;
  distance: number;
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

function getConfidenceLabel(runCount: number, targetDistance: number, baseDistances: number[]) {
  const maxBase = Math.max(...baseDistances);

  if (runCount >= 3 && targetDistance <= 10) {
    return "High";
  }

  if (runCount >= 3 && targetDistance <= 21.1 && maxBase >= 10) {
    return "Moderate";
  }

  if (runCount >= 2 && targetDistance <= 10) {
    return "Moderate";
  }

  if (targetDistance === 42.2 && maxBase < 16) {
    return "Low";
  }

  if (targetDistance === 21.1 && maxBase < 8) {
    return "Low";
  }

  return "Low";
}

function getConfidenceReason(confidence: string, targetDistance: number, baseDistances: number[]) {
  const maxBase = Math.max(...baseDistances);

  if (confidence === "High") {
    return "Based on multiple strong recent runs close enough in intensity to support this estimate.";
  }

  if (confidence === "Moderate") {
    if (targetDistance > maxBase) {
      return "Prediction is being projected from shorter efforts, so it is useful but still somewhat speculative.";
    }

    return "Supported by a few relevant recent runs, but still sensitive to training consistency.";
  }

  if (targetDistance === 42.2) {
    return "Marathon prediction is low-confidence because your recent data does not yet include enough long endurance work.";
  }

  return "Prediction is based on limited or indirect evidence, so treat it as a rough guide.";
}

function buildPredictions(runs: Run[]): RacePrediction[] {
  const supportingRuns = getBestSupportingRuns(runs);

  if (supportingRuns.length === 0) {
    return [];
  }

  const baseDistances = supportingRuns.map((item) => item.distance);

  const races = [
    { race: "5K", distance: 5 },
    { race: "10K", distance: 10 },
    { race: "Half Marathon", distance: 21.1 },
    { race: "Marathon", distance: 42.2 },
  ];

  return races.map((race) => {
    const weightedPredictions = supportingRuns.map((item) => {
      const predicted = predictTime(item.distance, item.seconds, race.distance);
      const weight = item.score + 1;
      return { predicted, weight };
    });

    const weightedSum = weightedPredictions.reduce((sum, item) => sum + item.predicted * item.weight, 0);
    const totalWeight = weightedPredictions.reduce((sum, item) => sum + item.weight, 0);

    const predictedSeconds = weightedSum / totalWeight;
    const confidence = getConfidenceLabel(supportingRuns.length, race.distance, baseDistances);
    const reason = getConfidenceReason(confidence, race.distance, baseDistances);

    return {
      race: race.race,
      distance: race.distance,
      predictedSeconds,
      predictedTime: secondsToTime(predictedSeconds),
      targetPace: formatPace(predictedSeconds, race.distance),
      confidence,
      reason,
    };
  });
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

  const supportingRuns = useMemo(() => getBestSupportingRuns(runs), [runs]);
  const predictions = useMemo(() => buildPredictions(runs), [runs]);

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
        <p>Add a few runs of at least 3 km to generate smarter predictions.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 40, maxWidth: 950, margin: "0 auto", fontFamily: "Arial" }}>
      <h1>Race Predictions</h1>
      <p>
        These predictions use a weighted blend of your strongest recent runs rather than only one single effort.
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 30 }}>
        <h2 style={{ marginTop: 0 }}>Runs Used For Prediction</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {supportingRuns.map((item) => (
            <div key={item.run.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
              <p><strong>Date:</strong> {item.run.date}</p>
              <p><strong>Distance:</strong> {item.run.distance} km</p>
              <p><strong>Time:</strong> {item.run.time}</p>
              <p><strong>Type:</strong> {item.run.runType}</p>
              <p><strong>Average HR:</strong> {item.run.avgHr}</p>
            </div>
          ))}
        </div>
      </div>

      <h2>Predicted Race Fitness</h2>

      <div style={{ display: "grid", gap: 16 }}>
        {predictions.map((prediction) => (
          <div
            key={prediction.race}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <h3 style={{ marginTop: 0 }}>{prediction.race}</h3>
            <p><strong>Predicted Time:</strong> {prediction.predictedTime}</p>
            <p><strong>Target Pace:</strong> {prediction.targetPace}</p>
            <p><strong>Confidence:</strong> {prediction.confidence}</p>
            <p><strong>Why:</strong> {prediction.reason}</p>
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
