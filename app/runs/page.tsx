"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";

type AiRunAnalysis = {
  headline: string;
  summary: string;
  what_went_well: string[];
  watchouts: string[];
  impact_on_training: string;
  next_step: string;
};

type Run = {
  id: string;
  date: string;
  distance: string;
  time: string;
  notes: string;
  runType: string;
  avgHr: string;
  elevation: string;
  aiAnalysis?: AiRunAnalysis | null;
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

function calculatePace(time: string, distance: string) {
  const paceSeconds = calculatePaceSeconds(time, distance);

  if (!paceSeconds) {
    return "N/A";
  }

  const paceMinutesPart = Math.floor(paceSeconds / 60);
  const paceSecondsPart = Math.round(paceSeconds % 60);

  const formattedSeconds =
    paceSecondsPart < 10 ? `0${paceSecondsPart}` : `${paceSecondsPart}`;

  return `${paceMinutesPart}:${formattedSeconds} /km`;
}

function calculateTrainingSignals(run: Run, allRuns: Run[]) {
  const distance = parseFloat(run.distance || "0");
  const hr = parseFloat(run.avgHr || "0");

  const recentRuns = allRuns.slice(0, 5);

  const avgDistance =
    recentRuns.reduce((sum, r) => sum + parseFloat(r.distance || "0"), 0) /
    (recentRuns.length || 1);

  const avgHr =
    recentRuns.reduce((sum, r) => sum + parseFloat(r.avgHr || "0"), 0) /
    (recentRuns.length || 1);

  const paceSeconds = calculatePaceSeconds(run.time, run.distance);

  const avgPaceSeconds =
    recentRuns.reduce((sum, r) => {
      const p = calculatePaceSeconds(r.time, r.distance);
      return sum + (p || 0);
    }, 0) / (recentRuns.length || 1);

  return {
    longerThanAverage: distance > avgDistance * 1.2,
    fasterThanAverage: !!paceSeconds && paceSeconds < avgPaceSeconds * 0.95,
    highHeartRate: hr > avgHr * 1.05,
  };
}

function analyseRun(run: Run, allRuns: Run[]) {
  const paceSeconds = calculatePaceSeconds(run.time, run.distance);
  const avgHr = parseFloat(run.avgHr || "0");
  const distance = parseFloat(run.distance || "0");
  const signals = calculateTrainingSignals(run, allRuns);

  if (!paceSeconds) {
    return {
      label: "No analysis available",
      comment: "Time or distance format is incomplete.",
    };
  }

  if (run.runType === "easy") {
    if (signals.highHeartRate) {
      return {
        label: "Easy run drifted hard",
        comment:
          "This looks tougher than your recent average. It may have added more fatigue than intended for an easy day.",
      };
    }

    if (signals.fasterThanAverage) {
      return {
        label: "Fast aerobic day",
        comment:
          "You ran quicker than your recent average while keeping the session in an aerobic category. Good sign of improving fitness.",
      };
    }

    if (avgHr > 0 && avgHr <= 150) {
      return {
        label: "Controlled aerobic run",
        comment:
          "Effort looks sustainable and well managed. This is the kind of run that supports consistency without much recovery cost.",
      };
    }

    return {
      label: "Steady easy mileage",
      comment:
        "A useful lower-intensity session that adds volume and supports aerobic development.",
    };
  }

  if (run.runType === "long") {
    if (signals.longerThanAverage && signals.highHeartRate) {
      return {
        label: "Big endurance stimulus",
        comment:
          "This was longer than your recent norm and likely came with a higher recovery cost. Strong endurance value, but monitor fatigue.",
      };
    }

    if (distance >= 16) {
      return {
        label: "Useful long-run durability",
        comment:
          "This run supports endurance development and is especially helpful for half marathon and marathon preparation.",
      };
    }

    return {
      label: "Moderate endurance session",
      comment:
        "Useful aerobic work, though still below the level of a major long-run stimulus.",
    };
  }

  if (run.runType === "tempo") {
    if (signals.fasterThanAverage) {
      return {
        label: "Strong threshold progression",
        comment:
          "This was quicker than your recent average and looks like a positive session for 10K and half marathon fitness.",
      };
    }

    return {
      label: "Threshold development",
      comment:
        "This kind of run is useful for improving sustained speed and lactate-threshold fitness.",
    };
  }

  if (run.runType === "interval") {
    if (signals.highHeartRate) {
      return {
        label: "Hard speed session",
        comment:
          "This looks like a demanding interval effort. Good for speed development, but likely carries a meaningful recovery cost.",
      };
    }

    return {
      label: "Speed-focused session",
      comment:
        "Useful for sharpening pace, top-end running economy, and shorter-distance fitness.",
    };
  }

  if (run.runType === "race") {
    return {
      label: "Race-quality data point",
      comment:
        "This effort is especially valuable because it helps anchor future race predictions against a genuine hard effort.",
    };
  }

  if (run.runType === "recovery") {
    if (signals.highHeartRate) {
      return {
        label: "Recovery run too costly",
        comment:
          "Heart rate was higher than your recent norm, so this may not have functioned as true recovery.",
      };
    }

    return {
      label: "Low-stress recovery",
      comment:
        "A light session that should help you absorb harder training while maintaining consistency.",
    };
  }

  return {
    label: "General aerobic training",
    comment:
      "This run contributes to overall consistency and aerobic fitness, even if it is not a key workout.",
  };
}

export default function RunsPage() {
  const [date, setDate] = useState("");
  const [distance, setDistance] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [runType, setRunType] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [elevation, setElevation] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [aiError, setAiError] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState("");

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
      aiAnalysis: docSnap.data().aiAnalysis || null,
    }));

    setRuns(data);
  }

  useEffect(() => {
    loadRuns();
  }, []);

  async function generateAndStoreAiAnalysis(run: Run, allRuns: Run[]) {
    const response = await fetch("/api/run-analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        run,
        allRuns,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || "Failed to generate AI run analysis.");
    }

    await updateDoc(doc(db, "runs", run.id), {
      aiAnalysis: data,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setAiError("");
    setBackfillMessage("");

    try {
      const docRef = await addDoc(collection(db, "runs"), {
        date,
        distance,
        time,
        notes,
        runType,
        avgHr,
        elevation,
        createdAt: new Date().toISOString(),
      });

      const newRun: Run = {
        id: docRef.id,
        date,
        distance,
        time,
        notes,
        runType,
        avgHr,
        elevation,
        aiAnalysis: null,
      };

      const allRunsForAnalysis = [newRun, ...runs];

      try {
        await generateAndStoreAiAnalysis(newRun, allRunsForAnalysis);
      } catch (err: any) {
        setAiError(err.message || "Run saved, but AI analysis could not be generated.");
      }

      setDate("");
      setDistance("");
      setTime("");
      setNotes("");
      setRunType("");
      setAvgHr("");
      setElevation("");

      await loadRuns();
    } catch (err: any) {
      setError(err.message || "Something went wrong while saving.");
    } finally {
      setSaving(false);
    }
  }

  async function handleBackfillAiAnalyses() {
    setBackfilling(true);
    setAiError("");
    setBackfillMessage("");

    try {
      const missingRuns = runs.filter((run) => !run.aiAnalysis);

      if (missingRuns.length === 0) {
        setBackfillMessage("All runs already have AI analysis.");
        setBackfilling(false);
        return;
      }

      let completed = 0;

      for (const run of missingRuns) {
        await generateAndStoreAiAnalysis(run, runs);
        completed += 1;
      }

      await loadRuns();
      setBackfillMessage(`Generated AI analysis for ${completed} run${completed === 1 ? "" : "s"}.`);
    } catch (err: any) {
      setAiError(err.message || "Failed while generating missing AI analyses.");
    } finally {
      setBackfilling(false);
    }
  }

  const missingAnalysisCount = runs.filter((run) => !run.aiAnalysis).length;

  return (
    <main style={{ padding: 40, maxWidth: 900, margin: "0 auto" }}>
      <h1>Runs</h1>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, marginBottom: 32 }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          style={{ padding: 12 }}
        />

        <input
          type="number"
          step="0.01"
          placeholder="Distance in km"
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          required
          style={{ padding: 12 }}
        />

        <input
          type="text"
          placeholder="Time (for example 42:15 or 1:35:20)"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
          style={{ padding: 12 }}
        />

        <select
          value={runType}
          onChange={(e) => setRunType(e.target.value)}
          required
          style={{ padding: 12 }}
        >
          <option value="">Select run type</option>
          <option value="easy">Easy</option>
          <option value="long">Long</option>
          <option value="tempo">Tempo</option>
          <option value="interval">Interval</option>
          <option value="race">Race</option>
          <option value="recovery">Recovery</option>
        </select>

        <input
          type="number"
          placeholder="Average heart rate"
          value={avgHr}
          onChange={(e) => setAvgHr(e.target.value)}
          style={{ padding: 12 }}
        />

        <input
          type="number"
          placeholder="Elevation gain in metres"
          value={elevation}
          onChange={(e) => setElevation(e.target.value)}
          style={{ padding: 12 }}
        />

        <textarea
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          style={{ padding: 12 }}
        />

        <button type="submit" disabled={saving} style={{ padding: 12 }}>
          {saving ? "Saving run and generating AI analysis..." : "Save Run"}
        </button>
      </form>

      <div
        style={{
          marginBottom: 24,
          padding: 16,
          borderRadius: 12,
          border: "1px solid #ddd",
          background: "#f8fafc",
        }}
      >
        <p style={{ marginTop: 0 }}>
          <strong>Missing AI analyses:</strong> {missingAnalysisCount}
        </p>

        <button
          onClick={handleBackfillAiAnalyses}
          disabled={backfilling || missingAnalysisCount === 0}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
        >
          {backfilling ? "Generating missing AI analyses..." : "Generate Missing AI Analyses"}
        </button>

        {backfillMessage && (
          <p style={{ color: "green", marginBottom: 0, marginTop: 12 }}>
            {backfillMessage}
          </p>
        )}
      </div>

      {error && (
        <p style={{ color: "red", marginBottom: 16 }}>
          {error}
        </p>
      )}

      {aiError && (
        <p style={{ color: "darkorange", marginBottom: 16 }}>
          {aiError}
        </p>
      )}

      <h2>Saved Runs</h2>

      <div style={{ display: "grid", gap: 16 }}>
        {runs.map((run) => {
          const analysis = analyseRun(run, runs);
          const signals = calculateTrainingSignals(run, runs);

          return (
            <div
              key={run.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 16,
                background: "white",
              }}
            >
              <p><strong>Date:</strong> {run.date}</p>
              <p><strong>Distance:</strong> {run.distance} km</p>
              <p><strong>Time:</strong> {run.time}</p>
              <p><strong>Pace:</strong> {calculatePace(run.time, run.distance)}</p>
              <p><strong>Type:</strong> {run.runType}</p>
              <p><strong>Average HR:</strong> {run.avgHr}</p>
              <p><strong>Elevation:</strong> {run.elevation} m</p>
              <p><strong>Rule-based Analysis:</strong> {analysis.label}</p>
              <p><strong>Rule-based Comment:</strong> {analysis.comment}</p>

              <div style={{ marginTop: 12 }}>
                <p><strong>Training Signals:</strong></p>
                <ul style={{ paddingLeft: 20, marginTop: 8 }}>
                  {signals.longerThanAverage && <li>Longer than recent runs</li>}
                  {signals.fasterThanAverage && <li>Faster than recent pace</li>}
                  {signals.highHeartRate && <li>Higher heart rate than usual</li>}
                  {!signals.longerThanAverage &&
                    !signals.fasterThanAverage &&
                    !signals.highHeartRate && <li>No major deviations from recent training</li>}
                </ul>
              </div>

              <p><strong>Notes:</strong> {run.notes}</p>

              {run.aiAnalysis ? (
                <div
                  style={{
                    marginTop: 16,
                    padding: 16,
                    borderRadius: 10,
                    background: "#f8fafc",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <h3 style={{ marginTop: 0 }}>{run.aiAnalysis.headline}</h3>
                  <p>{run.aiAnalysis.summary}</p>

                  {run.aiAnalysis.what_went_well.length > 0 && (
                    <>
                      <p><strong>What went well</strong></p>
                      <ul>
                        {run.aiAnalysis.what_went_well.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  {run.aiAnalysis.watchouts.length > 0 && (
                    <>
                      <p><strong>What to watch</strong></p>
                      <ul>
                        {run.aiAnalysis.watchouts.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  <p><strong>Impact on training:</strong> {run.aiAnalysis.impact_on_training}</p>
                  <p><strong>Next step:</strong> {run.aiAnalysis.next_step}</p>
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 16,
                    padding: 16,
                    borderRadius: 10,
                    background: "#fff7ed",
                    border: "1px solid #fed7aa",
                  }}
                >
                  <p style={{ margin: 0 }}>
                    AI run analysis has not been stored for this run yet.
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {runs.length === 0 && <p>No runs saved yet.</p>}
      </div>
    </main>
  );
}
