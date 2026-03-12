"use client";

import { useEffect, useState } from "react";
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
};

function calculatePace(time: string, distance: string) {
  const distanceNum = parseFloat(distance);

  if (!time || !distanceNum || distanceNum <= 0) {
    return "N/A";
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
    return "N/A";
  }

  const paceSeconds = totalSeconds / distanceNum;
  const paceMinutesPart = Math.floor(paceSeconds / 60);
  const paceSecondsPart = Math.round(paceSeconds % 60);

  const formattedSeconds =
    paceSecondsPart < 10 ? `0${paceSecondsPart}` : `${paceSecondsPart}`;

  return `${paceMinutesPart}:${formattedSeconds} /km`;
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
  }

  useEffect(() => {
    loadRuns();
  }, []);

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
        createdAt: new Date().toISOString(),
      });

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

  return (
    <main style={{ padding: 40, maxWidth: 800, margin: "0 auto" }}>
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
          {saving ? "Saving..." : "Save Run"}
        </button>
      </form>

      {error && (
        <p style={{ color: "red", marginBottom: 16 }}>
          {error}
        </p>
      )}

      <h2>Saved Runs</h2>

      <div style={{ display: "grid", gap: 16 }}>
        {runs.map((run) => (
          <div
            key={run.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <p><strong>Date:</strong> {run.date}</p>
            <p><strong>Distance:</strong> {run.distance} km</p>
            <p><strong>Time:</strong> {run.time}</p>
            <p><strong>Pace:</strong> {calculatePace(run.time, run.distance)}</p>
            <p><strong>Type:</strong> {run.runType}</p>
            <p><strong>Average HR:</strong> {run.avgHr}</p>
            <p><strong>Elevation:</strong> {run.elevation} m</p>
            <p><strong>Notes:</strong> {run.notes}</p>
          </div>
        ))}

        {runs.length === 0 && <p>No runs saved yet.</p>}
      </div>
    </main>
  );
}
