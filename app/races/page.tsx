"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../lib/firebase";

type RaceGoal = {
  id: string;
  name: string;
  date: string;
  distanceKm: string;
  targetTime: string;
  priority: string;
  notes: string;
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

function calculateTargetPace(targetTime: string, distanceKm: string) {
  const totalSeconds = timeToSeconds(targetTime);
  const distance = parseFloat(distanceKm);

  if (!totalSeconds || !distance) {
    return "N/A";
  }

  const paceSeconds = totalSeconds / distance;
  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
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

function getPriorityColor(priority: string) {
  if (priority === "A") return "#1d4ed8";
  if (priority === "B") return "#7c3aed";
  if (priority === "C") return "#6b7280";
  return "#6b7280";
}

export default function RacesPage() {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [targetTime, setTargetTime] = useState("");
  const [priority, setPriority] = useState("A");
  const [notes, setNotes] = useState("");
  const [races, setRaces] = useState<RaceGoal[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadRaces() {
    const q = query(collection(db, "raceGoals"), orderBy("date", "asc"));
    const snapshot = await getDocs(q);

    const data: RaceGoal[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name || "",
      date: doc.data().date || "",
      distanceKm: String(doc.data().distanceKm || ""),
      targetTime: doc.data().targetTime || "",
      priority: doc.data().priority || "A",
      notes: doc.data().notes || "",
    }));

    setRaces(data);
  }

  useEffect(() => {
    loadRaces();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      await addDoc(collection(db, "raceGoals"), {
        name,
        date,
        distanceKm,
        targetTime,
        priority,
        notes,
        createdAt: new Date().toISOString(),
      });

      setName("");
      setDate("");
      setDistanceKm("");
      setTargetTime("");
      setPriority("A");
      setNotes("");

      await loadRaces();
    } catch (err: any) {
      setError(err.message || "Something went wrong while saving the race.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", display: "grid", gap: 24 }}>
      <div
        style={{
          padding: 24,
          borderRadius: 20,
          background: "linear-gradient(135deg, #1d4ed8, #1e3a8a)",
          color: "white",
        }}
      >
        <p style={{ margin: 0, fontSize: 13, textTransform: "uppercase", opacity: 0.8 }}>
          Race Planner
        </p>
        <h1 style={{ margin: "10px 0 10px 0", fontSize: 36 }}>
          Target races
        </h1>
        <p style={{ margin: 0, maxWidth: 700, lineHeight: 1.6, color: "rgba(255,255,255,0.88)" }}>
          Add the races you care about most. Use any distance in kilometres,
          including 5 mile, 10 mile, and 20 mile races.
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
        <h2 style={{ marginTop: 0 }}>Add target race</h2>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <input
            type="text"
            placeholder="Race name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ padding: 12 }}
          />

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
            placeholder="Distance in km (example: 8.05 for 5 mile, 16.09 for 10 mile)"
            value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value)}
            required
            style={{ padding: 12 }}
          />

          <input
            type="text"
            placeholder="Target time (for example 58:30 or 1:24:30 or 2:59:59)"
            value={targetTime}
            onChange={(e) => setTargetTime(e.target.value)}
            required
            style={{ padding: 12 }}
          />

          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            style={{ padding: 12 }}
          >
            <option value="A">A race (primary)</option>
            <option value="B">B race</option>
            <option value="C">C race</option>
          </select>

          <textarea
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            style={{ padding: 12 }}
          />

          <button type="submit" disabled={saving} style={{ padding: 12 }}>
            {saving ? "Saving..." : "Save Race"}
          </button>
        </form>

        {error && (
          <p style={{ color: "red", marginBottom: 0, marginTop: 12 }}>
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
        <h2 style={{ marginTop: 0 }}>Saved races</h2>

        {races.length === 0 ? (
          <p>No target races saved yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {races.map((race) => {
              const days = getDaysToRace(race.date);
              const pace = calculateTargetPace(race.targetTime, race.distanceKm);
              const priorityColor = getPriorityColor(race.priority);

              return (
                <div
                  key={race.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 16,
                    padding: 16,
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
                    <strong>{race.name}</strong>

                    <span
                      style={{
                        background: priorityColor,
                        color: "white",
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {race.priority} priority
                    </span>
                  </div>

                  <p><strong>Date:</strong> {race.date}</p>
                  <p><strong>Distance:</strong> {race.distanceKm} km</p>
                  <p><strong>Target time:</strong> {race.targetTime}</p>
                  <p><strong>Target pace:</strong> {pace}</p>
                  <p><strong>Days to race:</strong> {days}</p>

                  {race.notes && (
                    <p><strong>Notes:</strong> {race.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
