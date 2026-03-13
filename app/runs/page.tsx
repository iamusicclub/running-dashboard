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
  workoutType?: number | null;
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

function normaliseText(value: string) {
  return value.toLowerCase().trim();
}

function getTargetPaceSeconds(race: RaceGoal) {
  const distanceKm = parseFloat(race.distanceKm || "0");
  const targetSeconds = timeToSeconds(race.targetTime || "");

  if (!distanceKm || !targetSeconds) {
    return null;
  }

  return targetSeconds / distanceKm;
}

function getBestRacePaceSeconds(races: RaceGoal[]) {
  const paces = races
    .map((race) => getTargetPaceSeconds(race))
    .filter((pace): pace is number => pace !== null);

  if (paces.length === 0) return null;

  return Math.min(...paces);
}

function inferDisplayRunType(run: Run, races: RaceGoal[]) {
  const storedType = normaliseText(run.runType || "");
  const runName = normaliseText(run.name || "");
  const notes = normaliseText(run.notes || "");
  const text = `${runName} ${notes}`;

  const distanceKm = getRunDistanceKm(run);
  const timeSeconds = getRunTimeSeconds(run);
  const paceSeconds = calculatePaceSeconds(run);
  const avgHr =
    run.averageHeartrate && run.averageHeartrate > 0
      ? run.averageHeartrate
      : parseFloat(run.avgHr || "0");

  const bestRacePace = getBestRacePaceSeconds(races);

  // 1) Strong keyword rules first
  if (
    text.includes("race") ||
    text.includes("parkrun") ||
    text.includes("time trial")
  ) {
    return "race";
  }

  if (
    text.includes("interval") ||
    text.includes("reps") ||
    text.includes("repeat") ||
    text.includes("fartlek") ||
    text.includes("track") ||
    text.includes("session") ||
    text.includes("3x") ||
    text.includes("4x") ||
    text.includes("5x") ||
    text.includes("6x") ||
    text.includes("2 x") ||
    text.includes("3 x") ||
    text.includes("4 x")
  ) {
    return "interval";
  }

  if (
    text.includes("tempo") ||
    text.includes("threshold") ||
    text.includes("steady hard") ||
    text.includes("progression")
  ) {
    return "tempo";
  }

  if (text.includes("long run") || text.includes("long")) {
    return "long";
  }

  if (
    text.includes("recovery") ||
    text.includes("rec ") ||
    text.includes("shakeout") ||
    text.includes("shake out")
  ) {
    return "recovery";
  }

  if (text.includes("easy")) {
    return "easy";
  }

  if (text.includes("steady")) {
    return "steady";
  }

  // 2) Use Strava workoutType if present
  // Common practical mapping:
  // 1 = race, 2 = long run, 3 = workout
  if (run.workoutType === 1) {
    return "race";
  }

  if (run.workoutType === 2) {
    return "long";
  }

  if (run.workoutType === 3) {
    return "interval";
  }

  // 3) Keep manual non-Strava labels if user explicitly entered them
  if (run.source !== "strava" && storedType) {
    return storedType;
  }

  // 4) If we have target-race pace context, use it
  if (bestRacePace && paceSeconds) {
    const delta = paceSeconds - bestRacePace;

    // Close to race pace with enough effort: likely tempo / threshold
    if (distanceKm >= 6 && distanceKm <= 18 && delta <= 20 && avgHr >= 150) {
      return "tempo";
    }

    // Much faster / sharper than target race pace
    if (distanceKm <= 10 && delta <= 10 && avgHr >= 158) {
      return "interval";
    }

    // Long and fairly controlled
    if (distanceKm >= 16 && delta >= 20) {
      return "long";
    }
  }

  // 5) General metric heuristics
  if (distanceKm >= 18 || timeSeconds >= 5400) {
    return "long";
  }

  if (avgHr > 0) {
    if (avgHr <= 142) {
      return "recovery";
    }

    if (avgHr <= 148) {
      return "easy";
    }

    if (avgHr >= 160 && distanceKm >= 5 && distanceKm <= 16) {
      return "tempo";
    }

    if (avgHr >= 155 && paceSeconds && distanceKm >= 6 && distanceKm <= 16) {
      return "steady";
    }
  }

  if (paceSeconds) {
    if (distanceKm >= 8 && distanceKm <= 16 && paceSeconds <= 270) {
      return "steady";
    }
  }

  // 6) If Strava imported it as easy, but nothing supports that, downgrade to steady
  if (storedType === "easy" && run.source === "strava") {
    return "steady";
  }

  // 7) Final fallback
  if (storedType) {
    return storedType;
  }

  return "steady";
}

function analyseRun(run: Run, displayType: string) {
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

  if (displayType === "recovery") {
    return {
      label: "Recovery session",
      comment: "Low-stress running intended to support recovery and keep training moving.",
    };
  }

  if (displayType === "easy") {
    return {
      label: "Aerobic support run",
      comment: "Useful low-to-moderate aerobic mileage that supports consistency and durability.",
    };
  }

  if (displayType === "steady") {
    return {
      label: "Steady aerobic session",
      comment: "A stronger-than-easy aerobic run that adds useful conditioning without being a full quality session.",
    };
  }

  if (displayType === "tempo") {
    return {
      label: "Threshold-style work",
      comment: "This looks much more like sustained quality work than an easy run and should support race-specific fitness well.",
    };
  }

  if (displayType === "interval") {
    return {
      label: "Structured quality session",
      comment: "This run likely contains harder repetitions or race-pace blocks, so it should be treated as a workout rather than easy mileage.",
    };
  }

  if (displayType === "long") {
    if (distance >= 16) {
      return {
        label: "Endurance-building run",
        comment: "Strong long-run stimulus that supports endurance and durability for longer races.",
      };
    }

    return {
      label: "Moderate endurance session",
      comment: "Useful endurance work, even if not yet a major long-run signal.",
    };
  }

  if (displayType === "race") {
    return {
      label: "Race-quality evidence",
      comment: "This run provides strong evidence for current fitness and race-readiness.",
    };
  }

  if (avgHr > 0 && avgHr >= 160) {
    return {
      label: "Hard effort",
      comment: "The intensity looks too high to treat this as an easy run.",
    };
  }

  return {
    label: "General training run",
    comment: "A useful session, though its exact role is still somewhat ambiguous from summary-level data alone.",
  };
}

function getRunTypeColor(type: string) {
  switch (type) {
    case "recovery":
      return "#6b7280";
    case "easy":
      return "#2563eb";
    case "steady":
      return "#0f766e";
    case "tempo":
      return "#d97706";
    case "interval":
      return "#dc2626";
    case "long":
      return "#4f46e5";
    case "race":
      return "#059669";
    default:
      return "#475569";
  }
}

function getPriorityColor(priority: string) {
  if (priority === "A") return "#1d4ed8";
  if (priority === "B") return "#7c3aed";
  return "#6b7280";
}

function getRaceMatch(run: Run, races: RaceGoal[], displayType: string): RaceMatch | null {
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

    if (displayType === "long") {
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

    if (displayType === "tempo" || displayType === "steady") {
      if (raceDistance >= 10 && raceDistance <= 21.1) {
        score += 5;
        reason = "This looks like sustained quality work and should support 10K to half-marathon targets well.";
        impact = "High";
      } else if (raceDistance < 10) {
        score += 3;
        reason = "Supports sustained speed for shorter race performance.";
        impact = "Medium";
      } else {
        score += 3;
        reason = "Useful marathon support through stronger aerobic or threshold work.";
        impact = "Medium";
      }
    }

    if (displayType === "interval") {
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

    if (displayType === "race") {
      score += 5;
      reason = "Race-effort evidence is especially valuable for target assessment.";
      impact = "High";
    }

    if (displayType === "easy" || displayType === "recovery") {
      if (raceDistance >= 10) {
        score += 2;
        reason = "Supports consistency and the broader training block.";
        impact = "Medium";
      } else {
        score += 1;
        reason = "Useful low-stress support, though not highly race-specific.";
        impact = "Low";
      }
    }

    if (distance >= raceDistance * 0.7) {
      score += 2;
    }

    if (avgHr >= 155 && (displayType === "tempo" || displayType === "race" || displayType === "interval")) {
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
      workoutType: doc.data().workoutType ?? null,
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
          Imported Strava runs are now classified using smarter rules instead of defaulting too easily to “easy”.
          This uses title keywords, workout type, pace, HR, distance, and your target race paces.
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
            <option value="recovery">Recovery</option>
            <option value="easy">Easy</option>
            <option value="steady">Steady</option>
            <option value="tempo">Tempo / Threshold</option>
            <option value="interval">Interval / Session</option>
            <option value="long">Long</option>
            <option value="race">Race</option>
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
            const displayType = inferDisplayRunType(run, races);
            const pace = formatPaceFromSeconds(calculatePaceSeconds(run));
            const analysis = analyseRun(run, displayType);
            const typeColor = getRunTypeColor(displayType);
            const raceMatch = getRaceMatch(run, races, displayType);
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
                      {displayType}
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
                    <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>
                      {run.time || (getRunTimeSeconds(run) ? secondsToTime(getRunTimeSeconds(run)) : "N/A")}
                    </p>
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
