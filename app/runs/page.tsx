"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, orderBy, query } from "firebase/firestore";
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
  name?: string;
  distanceMeters?: number;
  movingTimeSeconds?: number;
  averageHeartrate?: number | null;
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

type RaceMatch = {
  raceName: string;
  impact: string;
  impactColor: string;
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

function calculatePaceSeconds(run: Run) {
  const distanceNum = getRunDistanceKm(run);
  const totalSeconds = getRunTimeSeconds(run);

  if (!distanceNum || distanceNum <= 0 || !totalSeconds) {
    return null;
  }

  return totalSeconds / distanceNum;
}

function formatPaceFromSeconds(paceSeconds: number | null) {
  if (!paceSeconds) return "N/A";

  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
}

function analyseRun(run: Run) {
  const paceSeconds = calculatePaceSeconds(run);
  const avgHr =
    run.averageHeartrate && run.averageHeartrate > 0
      ? run.averageHeartrate
      : parseFloat(run.avgHr || "0");
  const distance = getRunDistanceKm(run);

  if (!paceSeconds) {
    return {
      label: "No analysis available",
      comment: "Time or distance format is incomplete.",
    };
  }

  if (run.runType === "easy") {
    if (avgHr > 0 && avgHr <= 150) {
      return {
        label: "Strong aerobic run",
        comment: "Controlled aerobic work that supports durability and recovery between harder sessions.",
      };
    }

    if (avgHr > 150) {
      return {
        label: "Easy run drifted a bit hard",
        comment: "Useful training, but effort may have crept above ideal easy intensity.",
      };
    }
  }

  if (run.runType === "long") {
    if (distance >= 16) {
      return {
        label: "Strong endurance stimulus",
        comment: "A meaningful long-run contribution that helps longer race preparation.",
      };
    }

    return {
      label: "Moderate endurance session",
      comment: "Solid aerobic work, though not yet a major long-run signal for the longest races.",
    };
  }

  if (run.runType === "tempo") {
    return {
      label: "Threshold development",
      comment: "This session helps sustained race pace and is especially useful for 10K to half marathon goals.",
    };
  }

  if (run.runType === "interval") {
    return {
      label: "Speed-focused session",
      comment: "A sharper workout that supports shorter-race speed and top-end economy.",
    };
  }

  if (run.runType === "race") {
    return {
      label: "Race-quality evidence",
      comment: "This run is highly valuable for estimating current race fitness.",
    };
  }

  if (run.runType === "recovery") {
    return {
      label: "Recovery session",
      comment: "Low-stress running that helps absorb harder training.",
    };
  }

  return {
    label: "General aerobic training",
    comment: "Useful consistency work that contributes to overall fitness and volume.",
  };
}

function getRunTypeColor(type: string) {
  switch (type) {
    case "easy":
      return "#2563eb";
    case "long":
      return "#4f46e5";
    case "tempo":
      return "#d97706";
    case "interval":
      return "#dc2626";
    case "race":
      return "#059669";
    case "recovery":
      return "#6b7280";
    default:
      return "#475569";
  }
}

function getPriorityColor(priority: string) {
  if (priority === "A") return "#1d4ed8";
  if (priority === "B") return "#7c3aed";
  return "#6b7280";
}

function getRaceMatch(run: Run, races: RaceGoal[]): RaceMatch | null {
  if (races.length === 0) return null;

  const distance = getRunDistanceKm(run);
  const avgHr =
    run.averageHeartrate && run.averageHeartrate > 0
      ? run.averageHeartrate
      : parseFloat(run.avgHr || "0");

  let best: {
    race: RaceGoal;
    score: number;
    impact: string;
    reason: string;
  } | null = null;

  for (const race of races) {
    const raceDistance = parseFloat(race.distanceKm || "0");
    if (!raceDistance) continue;

    let score = 0;
    let reason = "Useful general support run.";
    let impact = "Low";

    const ratio = Math.min(distance, raceDistance) / Math.max(distance || 1, raceDistance || 1);

    score += ratio * 4;

    if (race.priority === "A") score += 2;
    if (race.priority === "B") score += 1;

    if (run.runType === "long") {
      if (raceDistance >= 21.1) {
        score += 5;
        reason = "Supports endurance and durability for longer races.";
        impact = "High";
      } else if (raceDistance >= 10) {
        score += 2;
        reason = "Adds useful aerobic support for longer race preparation.";
        impact = "Medium";
      }
    }

    if (run.runType === "tempo") {
      if (raceDistance >= 10 && raceDistance <= 21.1) {
        score += 5;
        reason = "A strong threshold session for 10K to half-marathon targets.";
        impact = "High";
      } else if (raceDistance < 10) {
        score += 3;
        reason = "Supports sustained speed for shorter race performance.";
        impact = "Medium";
      } else {
        score += 3;
        reason = "Useful marathon support through threshold development.";
        impact = "Medium";
      }
    }

    if (run.runType === "interval") {
      if (raceDistance <= 10) {
        score += 5;
        reason = "A sharp session that strongly supports shorter-distance race speed.";
        impact = "High";
      } else if (raceDistance <= 21.1) {
        score += 2;
        reason = "Helpful for speed support, though less specific than threshold work.";
        impact = "Medium";
      }
    }

    if (run.runType === "race") {
      score += 5;
      reason = "Race-effort evidence is especially valuable for target assessment.";
      impact = "High";
    }

    if (run.runType === "easy") {
      if (raceDistance >= 10) {
        score += 2;
        reason = "Easy mileage helps consistency and supports the broader training block.";
        impact = "Medium";
      } else {
        score += 1;
        reason = "Useful low-stress support, though not highly race-specific.";
        impact = "Low";
      }
    }

    if (run.runType === "recovery") {
      score += 0.5;
      reason = "Mainly supports recovery rather than directly moving race fitness.";
      impact = "Low";
    }

    if (distance >= raceDistance * 0.7) {
      score += 2;
    }

    if (avgHr >= 155 && (run.runType === "tempo" || run.runType === "race" || run.runType === "interval")) {
      score += 1;
    }

    if (!best || score > best.score) {
      best = {
        race,
        score,
        impact,
        reason,
      };
    }
  }

  if (!best) return null;

  const impactColor =
    best.impact === "High"
      ? "#059669"
      : best.impact === "Medium"
      ? "#d97706"
      : "#6b7280";

  return {
    raceName: best.race.name,
    impact: best.impact,
    impactColor,
    reason: best.reason,
  };
}

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [races, setRaces] = useState<RaceGoal[]>([]);
  const [date, setDate] = useState("");
  const [distance, setDistance] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [runType, setRunType] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [elevation, setElevation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    const runsQuery = query(collection(db, "runs"), orderBy("date", "desc"));
    const racesQuery = query(collection(db, "raceGoals"), orderBy("date", "asc"));

    const [runsSnapshot, racesSnapshot] = await Promise.all([
      getDocs(runsQuery),
      getDocs(racesQuery),
    ]);

    const runData: Run[] = runsSnapshot.docs.map((doc) => ({
      id: doc.id,
      date: doc.data().date || "",
      distance: String(doc.data().distance || ""),
      time: String(doc.data().time || ""),
      notes: doc.data().notes || "",
      runType: doc.data().runType || "",
      avgHr: String(doc.data().avgHr || ""),
      elevation: String(doc.data().elevation || ""),
      source: doc.data().source || "",
      name: doc.data().name || "",
      distanceMeters: doc.data().distanceMeters || null,
      movingTimeSeconds: doc.data().movingTimeSeconds || null,
      averageHeartrate: doc.data().averageHeartrate || null,
    }));

    const raceData: RaceGoal[] = racesSnapshot.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name || "",
      date: doc.data().date || "",
      distanceKm: String(doc.data().distanceKm || ""),
      targetTime: doc.data().targetTime || "",
      priority: doc.data().priority || "A",
      notes: doc.data().notes || "",
    }));

    setRuns(runData);
    setRaces(raceData);
  }

  useEffect(() => {
    loadData();
  }, []);

  const latestRaceCount = useMemo(() => races.length, [races]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      await addDoc(collection(db, "runs"), {
        date,
        distance,
        time,
        notes,
        runType,
        avgHr,
        elevation,
        source: "manual",
        createdAt: new Date().toISOString(),
      });

      setDate("");
      setDistance("");
      setTime("");
      setNotes("");
      setRunType("");
      setAvgHr("");
      setElevation("");

      await loadData();
    } catch (err: any) {
      setError(err.message || "Something went wrong while saving the run.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 24 }}>
      <div
        style={{
          padding: 24,
          borderRadius: 20,
          background: "linear-gradient(135deg, #1d4ed8, #1e3a8a)",
          color: "white",
        }}
      >
        <p style={{ margin: 0, fontSize: 13, textTransform: "uppercase", opacity: 0.8 }}>
          Training Log
        </p>
        <h1 style={{ margin: "10px 0 10px 0", fontSize: 36 }}>Runs</h1>
        <p style={{ margin: 0, maxWidth: 760, lineHeight: 1.6, color: "rgba(255,255,255,0.88)" }}>
          Each run now tries to identify which target race it is helping most, so your log becomes race-aware rather than just a list of sessions.
        </p>
      </div>

      <div
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 20,
          boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Add run manually</h2>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
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
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ padding: 12 }}
          />

          <button type="submit" disabled={saving} style={{ padding: 12 }}>
            {saving ? "Saving..." : "Save Run"}
          </button>
        </form>

        {error && (
          <p style={{ color: "red", marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        )}
      </div>

      <div
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 20,
          boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Saved runs</h2>

        {latestRaceCount === 0 && (
          <p style={{ color: "#6b7280" }}>
            You have no saved target races yet, so race relevance is not being calculated. Add races on the Races page to unlock race-aware feedback.
          </p>
        )}

        <div style={{ display: "grid", gap: 18 }}>
          {runs.map((run) => {
            const pace = formatPaceFromSeconds(calculatePaceSeconds(run));
            const analysis = analyseRun(run);
            const typeColor = getRunTypeColor(run.runType);
            const raceMatch = getRaceMatch(run, races);
            const sourceLabel = run.source || "manual";

            return (
              <div
                key={run.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 18,
                  padding: 18,
                  background: "#f8fafc",
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
                  <div>
                    <h3 style={{ margin: 0 }}>{run.name || run.date}</h3>
                    <p style={{ margin: "4px 0 0 0", color: "#6b7280", fontSize: 14 }}>
                      {run.date}
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        background: typeColor,
                        color: "white",
                        padding: "5px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {run.runType || "run"}
                    </span>

                    <span
                      style={{
                        background: "#e5e7eb",
                        color: "#374151",
                        padding: "5px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                        textTransform: "capitalize",
                      }}
                    >
                      {sourceLabel}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Distance</p>
                    <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>
                      {getRunDistanceKm(run).toFixed(2)} km
                    </p>
                  </div>

                  <div>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Time</p>
                    <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{run.time}</p>
                  </div>

                  <div>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Pace</p>
                    <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>{pace}</p>
                  </div>

                  <div>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Avg HR</p>
                    <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>
                      {run.averageHeartrate || run.avgHr || "N/A"}
                    </p>
                  </div>

                  <div>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Elevation</p>
                    <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>
                      {run.elevation || "0"} m
                    </p>
                  </div>
                </div>

                {raceMatch && (
                  <div
                    style={{
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: 14,
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                        marginBottom: 8,
                      }}
                    >
                      <p style={{ margin: 0, fontWeight: 700 }}>
                        Most relevant target: {raceMatch.raceName}
                      </p>

                      <span
                        style={{
                          border: `1px solid ${raceMatch.impactColor}`,
                          color: raceMatch.impactColor,
                          padding: "5px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {raceMatch.impact} impact
                      </span>
                    </div>

                    <p style={{ margin: 0, color: "#374151" }}>{raceMatch.reason}</p>
                  </div>
                )}

                <div
                  style={{
                    background: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: run.notes ? 12 : 0,
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 700 }}>{analysis.label}</p>
                  <p style={{ margin: "6px 0 0 0", color: "#374151" }}>{analysis.comment}</p>
                </div>

                {run.notes && (
                  <div
                    style={{
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: 14,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Notes</p>
                    <p style={{ margin: "6px 0 0 0", color: "#111827" }}>{run.notes}</p>
                  </div>
                )}
              </div>
            );
          })}

          {runs.length === 0 && <p>No runs saved yet.</p>}
        </div>
      </div>
    </main>
  );
}
