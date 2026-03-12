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
};

export default function RunsPage() {
  const [date, setDate] = useState("");
  const [distance, setDistance] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [saving, setSaving] = useState(false);

  async function loadRuns() {
    const q = query(collection(db, "runs"), orderBy("date", "desc"));
    const snapshot = await getDocs(q);

    const data: Run[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      date: doc.data().date || "",
      distance: String(doc.data().distance || ""),
      time: String(doc.data().time || ""),
      notes: doc.data().notes || "",
    }));

    setRuns(data);
  }

  useEffect(() => {
    loadRuns();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    await addDoc(collection(db, "runs"), {
      date,
      distance,
      time,
      notes,
      createdAt: new Date().toISOString(),
    });

    setDate("");
    setDistance("");
    setTime("");
    setNotes("");
    await loadRuns();
    setSaving(false);
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
          placeholder="Time (for example 42:15)"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
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
            <p><strong>Notes:</strong> {run.notes}</p>
          </div>
        ))}

        {runs.length === 0 && <p>No runs saved yet.</p>}
      </div>
    </main>
  );
}
