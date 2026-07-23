"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

import { db } from "../../lib/firebase";
import {
  matchTrainingWeek,
  type ManualSessionStatus,
  type MatchablePlannedSession,
  type MatchableRun,
  type SessionMatchResult,
} from "../../lib/session-matching";

type TrainingWeek = {
  id: string;
  weekEndingDate: string;
  weekStartingDate: string;
  totalVolumeText: string;
  phase: string | null;
  sessions: MatchablePlannedSession[];
};

type TrainingPlanResponse = {
  success: boolean;
  weeks?: TrainingWeek[];
  error?: string;
};

type ReviewMap = Record<string, ManualSessionStatus>;

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
}

function getRunDistanceKm(run: MatchableRun) {
  if (typeof run.distanceMeters === "number" && run.distanceMeters > 0) {
    return run.distanceMeters / 1000;
  }

  return Number.parseFloat(run.distance || "0") || 0;
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return "â";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.round(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function statusLabel(status: ManualSessionStatus) {
  if (status === "completed") return "Completed";
  if (status === "partial") return "Partially completed";
  if (status === "missed") return "Missed";
  return "Awaiting review";
}

function applyReview(
  result: SessionMatchResult,
  reviews: ReviewMap
): SessionMatchResult {
  const manualStatus = reviews[result.sessionId] ?? null;

  if (!manualStatus) return result;

  return {
    ...result,
    manualStatus,
    status: manualStatus,
    statusLabel: statusLabel(manualStatus),
  };
}

export default function RunsPage() {
  const [runs, setRuns] = useState<MatchableRun[]>([]);
  const [weeks, setWeeks] = useState<TrainingWeek[]>([]);
  const [reviews, setReviews] = useState<ReviewMap>({});
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingSessionId, setSavingSessionId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadData(preserveSelection = true) {
    setError("");

    const [runsSnapshot, reviewsSnapshot, planResponse] = await Promise.all([
      getDocs(query(collection(db, "runs"), orderBy("date", "desc"))),
      getDocs(collection(db, "trainingSessionReviews")),
      fetch("/api/training-plan", { cache: "no-store" }).then(async (response) => {
        const result = (await response.json()) as TrainingPlanResponse;
        if (!response.ok || !result.success) {
          throw new Error(result.error || "The training plan could not be loaded.");
        }
        return result;
      }),
    ]);

    const loadedRuns: MatchableRun[] = runsSnapshot.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        date: data.date || "",
        distance: String(data.distance || ""),
        time: String(data.time || ""),
        runType: data.runType || "",
        avgHr: String(data.avgHr || ""),
        elevation: String(data.elevation || ""),
        name: data.name || "",
        notes: data.notes || "",
        source: data.source || "",
        distanceMeters:
          typeof data.distanceMeters === "number" ? data.distanceMeters : undefined,
        movingTimeSeconds:
          typeof data.movingTimeSeconds === "number"
            ? data.movingTimeSeconds
            : undefined,
        paceSecondsPerKm:
          typeof data.paceSecondsPerKm === "number"
            ? data.paceSecondsPerKm
            : null,
        averageHeartrate:
          typeof data.averageHeartrate === "number"
            ? data.averageHeartrate
            : null,
        workoutType:
          typeof data.workoutType === "number" ? data.workoutType : null,
        laps: Array.isArray(data.laps) ? data.laps : undefined,
      };
    });

    const loadedReviews: ReviewMap = {};
    reviewsSnapshot.docs.forEach((document) => {
      const status = document.data().manualStatus;
      if (status === "completed" || status === "partial" || status === "missed") {
        loadedReviews[document.id] = status;
      }
    });

    const loadedWeeks = planResponse.weeks || [];
    setRuns(loadedRuns);
    setReviews(loadedReviews);
    setWeeks(loadedWeeks);

    if (!preserveSelection || !selectedWeekId) {
      const today = new Date().toISOString().slice(0, 10);
      const current =
        loadedWeeks.find(
          (week) => today >= week.weekStartingDate && today <= week.weekEndingDate
        ) || [...loadedWeeks].reverse().find((week) => week.weekStartingDate <= today);
      setSelectedWeekId(current?.id || loadedWeeks.at(-1)?.id || "");
    }
  }

  useEffect(() => {
    loadData(false)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Training could not be loaded.")
      )
      .finally(() => setLoading(false));
    // The initial load deliberately runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedWeek =
    weeks.find((week) => week.id === selectedWeekId) || null;

  const matches = useMemo(
    () =>
      selectedWeek
        ? matchTrainingWeek(selectedWeek.sessions, runs).map((result) =>
            applyReview(result, reviews)
          )
        : [],
    [selectedWeek, runs, reviews]
  );

  async function saveStatus(
    sessionId: string,
    manualStatus: Exclude<ManualSessionStatus, null>
  ) {
    setSavingSessionId(sessionId);
    setError("");
    setMessage("");

    try {
      await setDoc(
        doc(db, "trainingSessionReviews", sessionId),
        {
          sessionId,
          manualStatus,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setReviews((current) => ({ ...current, [sessionId]: manualStatus }));
      setMessage("Training review saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not be saved.");
    } finally {
      setSavingSessionId("");
    }
  }

  function connectStrava() {
    setConnecting(true);
    window.location.href = `${window.location.origin}/api/strava/connect`;
  }

  async function syncStrava() {
    setSyncing(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/strava/sync", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Strava sync failed.");
      await loadData();
      setMessage(`Strava sync complete. ${result.syncedCount || 0} runs updated.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Strava sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="training-review-page">
      <section className="training-review-hero">
        <div>
          <p className="section-label">Coach plan versus Strava</p>
          <h1>Training review</h1>
          <p>
            Review each planned session after it is due. Your judgement is what
            drives the dashboard and weekly training verdict.
          </p>
        </div>

        <div className="training-sync-actions">
          <button type="button" onClick={connectStrava} disabled={connecting}>
            {connecting ? "Connectingâ¦" : "Connect Strava"}
          </button>
          <button type="button" onClick={syncStrava} disabled={syncing}>
            {syncing ? "Syncingâ¦" : "Sync Strava"}
          </button>
        </div>
      </section>

      {error && <p className="review-message review-message-error">{error}</p>}
      {message && <p className="review-message review-message-success">{message}</p>}

      <section className="surface-card training-week-toolbar">
        <div>
          <p className="section-label">Training week</p>
          <h2>{selectedWeek ? `${formatDate(selectedWeek.weekStartingDate)} â ${formatDate(selectedWeek.weekEndingDate)}` : "Select a week"}</h2>
        </div>

        <select
          aria-label="Training week"
          value={selectedWeekId}
          onChange={(event) => setSelectedWeekId(event.target.value)}
        >
          {weeks.map((week) => (
            <option key={week.id} value={week.id}>
              Week ending {formatDate(week.weekEndingDate)}
              {week.phase ? ` Â· ${week.phase}` : ""}
            </option>
          ))}
        </select>
      </section>

      {loading ? (
        <section className="surface-card review-empty">Loading training planâ¦</section>
      ) : matches.length === 0 ? (
        <section className="surface-card review-empty">
          No planned sessions were found for this week.
        </section>
      ) : (
        <section className="training-session-list">
          {matches.map((match) => {
            const session = match.plannedSession;
            const reviewedStatus = match.manualStatus;
            const canReview = !session.isRestDay && match.status !== "upcoming";

            return (
              <article className="surface-card training-session-card" key={session.id}>
                <div className="training-session-heading">
                  <div>
                    <p className="section-label">{formatDate(session.plannedDate)}</p>
                    <h2>{session.title}</h2>
                    <p className="training-session-plan">{session.rawText}</p>
                  </div>
                  <span className={`review-status review-status-${reviewedStatus || match.status}`}>
                    {session.isRestDay
                      ? "Rest day"
                      : reviewedStatus
                      ? statusLabel(reviewedStatus)
                      : match.status === "upcoming"
                      ? "Upcoming"
                      : "Awaiting review"}
                  </span>
                </div>

                <div className="training-session-comparison">
                  <div>
                    <span>Planned</span>
                    <strong>{session.distance.display || session.title}</strong>
                    <small>{session.targetPaceText || "No target pace specified"}</small>
                  </div>
                  <div>
                    <span>Matched Strava activity</span>
                    {match.matchedRuns.length > 0 ? (
                      match.matchedRuns.map((run) => (
                        <p key={run.id}>
                          <strong>{run.name || "Run"}</strong>
                          <small>
                            {getRunDistanceKm(run).toFixed(1)} km Â·{" "}
                            {formatDuration(run.movingTimeSeconds)}
                          </small>
                        </p>
                      ))
                    ) : (
                      <strong>No activity matched</strong>
                    )}
                  </div>
                </div>

                {canReview && (
                  <div className="manual-review">
                    <span>How was this session completed?</span>
                    <div className="manual-review-buttons">
                      {(["completed", "partial", "missed"] as const).map((status) => (
                        <button
                          type="button"
                          key={status}
                          className={reviewedStatus === status ? "is-selected" : ""}
                          data-status={status}
                          disabled={savingSessionId === session.id}
                          onClick={() => saveStatus(session.id, status)}
                        >
                          {statusLabel(status)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
