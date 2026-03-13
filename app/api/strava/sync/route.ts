import { NextResponse } from "next/server";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../../../lib/firebase";

type StravaTokenDoc = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  athlete?: {
    id?: number;
  };
};

type StravaActivitySummary = {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  sport_type: string;
  workout_type?: number | null;
  start_date?: string;
  start_date_local?: string;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_speed?: number | null;
  max_speed?: number | null;
  average_cadence?: number | null;
  trainer?: boolean;
  commute?: boolean;
  manual?: boolean;
  private?: boolean;
  achievement_count?: number;
  kudos_count?: number;
};

type StravaActivityDetail = StravaActivitySummary & {
  description?: string | null;
};

type StravaLap = {
  id?: number;
  name?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  pace_zone?: number | null;
  lap_index?: number;
  total_elevation_gain?: number | null;
};

const TOKEN_COLLECTION = "stravaAuth";

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
  if (!paceSeconds || !Number.isFinite(paceSeconds)) {
    return "";
  }

  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.round(paceSeconds % 60);

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds} /km`;
}

function normaliseText(value: string | undefined | null) {
  return (value || "").toLowerCase().trim();
}

async function findToken(): Promise<{ ref: any; data: StravaTokenDoc } | null> {
  const primary = await getDoc(doc(db, TOKEN_COLLECTION, "primary"));
  if (primary.exists()) {
    return { ref: primary.ref, data: primary.data() as StravaTokenDoc };
  }

  const athlete = await getDoc(doc(db, TOKEN_COLLECTION, "athlete"));
  if (athlete.exists()) {
    return { ref: athlete.ref, data: athlete.data() as StravaTokenDoc };
  }

  const token = await getDoc(doc(db, TOKEN_COLLECTION, "token"));
  if (token.exists()) {
    return { ref: token.ref, data: token.data() as StravaTokenDoc };
  }

  const snapshot = await getDocs(query(collection(db, TOKEN_COLLECTION), limit(10)));
  if (!snapshot.empty) {
    const docSnap = snapshot.docs[0];
    return { ref: docSnap.ref, data: docSnap.data() as StravaTokenDoc };
  }

  return null;
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET.");
  }

  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${text}`);
  }

  return response.json();
}

async function fetchJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava request failed (${response.status}): ${text}`);
  }

  return response.json();
}

function shouldFetchLaps(activity: StravaActivityDetail) {
  const name = normaliseText(activity.name);
  const distanceKm = activity.distance / 1000;
  const avgHr = activity.average_heartrate || 0;
  const paceSeconds =
    activity.distance > 0 && activity.moving_time > 0
      ? activity.moving_time / (activity.distance / 1000)
      : null;

  if (activity.workout_type === 1 || activity.workout_type === 3) {
    return true;
  }

  if (
    name.includes("tempo") ||
    name.includes("threshold") ||
    name.includes("interval") ||
    name.includes("reps") ||
    name.includes("repeat") ||
    name.includes("track") ||
    name.includes("fartlek") ||
    name.includes("session") ||
    name.includes("3x") ||
    name.includes("4x") ||
    name.includes("5x") ||
    name.includes("6x") ||
    name.includes("2 x") ||
    name.includes("3 x") ||
    name.includes("4 x") ||
    name.includes("race") ||
    name.includes("parkrun") ||
    name.includes("time trial")
  ) {
    return true;
  }

  if (avgHr >= 158 && distanceKm >= 5 && distanceKm <= 18) {
    return true;
  }

  if (paceSeconds && paceSeconds <= 245 && distanceKm >= 5 && distanceKm <= 16) {
    return true;
  }

  return false;
}

function inferRunTypeFromDetail(
  activity: StravaActivityDetail,
  laps: StravaLap[]
): string {
  const name = normaliseText(activity.name);
  const sportType = normaliseText(activity.sport_type);
  const distanceKm = activity.distance / 1000;
  const avgHr = activity.average_heartrate || 0;
  const paceSeconds =
    activity.distance > 0 && activity.moving_time > 0
      ? activity.moving_time / (activity.distance / 1000)
      : null;

  if (sportType !== "run" && sportType !== "trailrun") {
    return "other";
  }

  if (
    name.includes("race") ||
    name.includes("parkrun") ||
    name.includes("time trial")
  ) {
    return "race";
  }

  if (
    name.includes("tempo") ||
    name.includes("threshold") ||
    name.includes("progression")
  ) {
    return "tempo";
  }

  if (
    name.includes("interval") ||
    name.includes("reps") ||
    name.includes("repeat") ||
    name.includes("fartlek") ||
    name.includes("track") ||
    name.includes("session") ||
    name.includes("3x") ||
    name.includes("4x") ||
    name.includes("5x") ||
    name.includes("6x") ||
    name.includes("2 x") ||
    name.includes("3 x") ||
    name.includes("4 x")
  ) {
    return "interval";
  }

  if (name.includes("recovery") || name.includes("shakeout") || name.includes("shake out")) {
    return "recovery";
  }

  if (name.includes("long run") || name === "long run" || name.includes("long")) {
    return "long";
  }

  if (name.includes("easy")) {
    return "easy";
  }

  if (name.includes("steady")) {
    return "steady";
  }

  if (activity.workout_type === 1) {
    return "race";
  }

  if (activity.workout_type === 2) {
    return "long";
  }

  if (activity.workout_type === 3) {
    return "interval";
  }

  const lapSummaries = laps
    .map((lap) => {
      const lapDistanceKm = (lap.distance || 0) / 1000;
      const lapMovingTime = lap.moving_time || 0;

      if (!lapDistanceKm || !lapMovingTime) return null;

      return {
        distanceKm: lapDistanceKm,
        paceSeconds: lapMovingTime / lapDistanceKm,
        hr: lap.average_heartrate || 0,
        name: normaliseText(lap.name),
      };
    })
    .filter(
      (
        value
      ): value is {
        distanceKm: number;
        paceSeconds: number;
        hr: number;
        name: string;
      } => value !== null && value.distanceKm >= 0.2
    );

  if (lapSummaries.length >= 2) {
    const hardLaps = lapSummaries.filter((lap) => {
      if (
        lap.name.includes("recovery") ||
        lap.name.includes("recover") ||
        lap.name.includes("rest")
      ) {
        return false;
      }

      return lap.hr >= 158 || lap.paceSeconds <= 245;
    });

    const recoveryLaps = lapSummaries.filter((lap) => {
      if (
        lap.name.includes("recovery") ||
        lap.name.includes("recover") ||
        lap.name.includes("rest")
      ) {
        return true;
      }

      return lap.paceSeconds >= 300;
    });

    const repeatedHardLaps = hardLaps.filter((lap) => lap.distanceKm >= 0.8).length;
    const sustainedHardDistance = hardLaps.reduce((sum, lap) => sum + lap.distanceKm, 0);

    if (repeatedHardLaps >= 2 && recoveryLaps.length >= 1) {
      return "interval";
    }

    if (sustainedHardDistance >= 5) {
      return "tempo";
    }
  }

  if (distanceKm >= 18) {
    return "long";
  }

  if (avgHr > 0) {
    if (avgHr <= 142) return "recovery";
    if (avgHr <= 148) return "easy";
    if (avgHr >= 160 && distanceKm >= 5 && distanceKm <= 16) return "tempo";
    if (avgHr >= 152 && distanceKm >= 6 && distanceKm <= 16) return "steady";
  }

  if (paceSeconds) {
    if (distanceKm >= 8 && distanceKm <= 16 && paceSeconds <= 270) {
      return "steady";
    }
  }

  return "easy";
}

export async function POST() {
  try {
    const tokenResult = await findToken();

    if (!tokenResult) {
      return NextResponse.json(
        {
          error: "No Strava token found in Firestore. Please click Connect Strava again.",
        },
        { status: 400 }
      );
    }

    const { ref, data } = tokenResult;

    if (!data.refresh_token) {
      return NextResponse.json(
        {
          error: "Strava refresh token missing. Please reconnect Strava.",
        },
        { status: 400 }
      );
    }

    const refreshed = await refreshAccessToken(data.refresh_token);

    await setDoc(
      ref,
      {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: refreshed.expires_at,
        athlete: refreshed.athlete || data.athlete || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const accessToken = refreshed.access_token as string;

    const activities = await fetchJson<StravaActivitySummary[]>(
      "https://www.strava.com/api/v3/athlete/activities?per_page=50&page=1",
      accessToken
    );

    const runActivities = activities.filter((activity) => {
      const sportType = normaliseText(activity.sport_type);
      return sportType === "run" || sportType === "trailrun";
    });

    const synced: {
      id: number;
      name: string;
      runType: string;
      laps: number;
    }[] = [];

    for (const summary of runActivities) {
      const detail = await fetchJson<StravaActivityDetail>(
        `https://www.strava.com/api/v3/activities/${summary.id}?include_all_efforts=false`,
        accessToken
      );

      let laps: StravaLap[] = [];
      if (shouldFetchLaps(detail)) {
        try {
          laps = await fetchJson<StravaLap[]>(
            `https://www.strava.com/api/v3/activities/${summary.id}/laps`,
            accessToken
          );
        } catch {
          laps = [];
        }
      }

      const distanceKm = detail.distance / 1000;
      const paceSecondsPerKm =
        detail.distance > 0 && detail.moving_time > 0
          ? detail.moving_time / distanceKm
          : null;

      const inferredRunType = inferRunTypeFromDetail(detail, laps);

      await setDoc(
        doc(db, "runs", String(detail.id)),
        {
          stravaActivityId: String(detail.id),
          athleteId: data.athlete?.id ? String(data.athlete.id) : "",
          source: "strava",

          date: detail.start_date_local
            ? detail.start_date_local.slice(0, 10)
            : detail.start_date
            ? detail.start_date.slice(0, 10)
            : "",

          startDate: detail.start_date || "",
          startDateLocal: detail.start_date_local || "",

          name: detail.name || "",
          notes: detail.description || "",

          distance: distanceKm.toFixed(2),
          distanceMeters: detail.distance || 0,

          time: secondsToTime(detail.moving_time || 0),
          movingTimeSeconds: detail.moving_time || 0,
          elapsedTimeSeconds: detail.elapsed_time || 0,

          pace: formatPaceFromSeconds(paceSecondsPerKm),
          paceSecondsPerKm: paceSecondsPerKm,

          runType: inferredRunType,
          rawSportType: detail.sport_type || "",
          workoutType:
            typeof detail.workout_type === "number" ? detail.workout_type : null,

          avgHr: detail.average_heartrate ? String(detail.average_heartrate) : "",
          averageHeartrate:
            typeof detail.average_heartrate === "number"
              ? detail.average_heartrate
              : null,
          maxHeartrate:
            typeof detail.max_heartrate === "number" ? detail.max_heartrate : null,

          elevation: String(detail.total_elevation_gain || 0),
          totalElevationGain: detail.total_elevation_gain || 0,

          averageCadence:
            typeof detail.average_cadence === "number"
              ? detail.average_cadence
              : null,
          averageSpeedMps:
            typeof detail.average_speed === "number" ? detail.average_speed : null,
          maxSpeedMps:
            typeof detail.max_speed === "number" ? detail.max_speed : null,

          trainer: !!detail.trainer,
          commute: !!detail.commute,
          manual: !!detail.manual,
          private: !!detail.private,

          achievementCount: detail.achievement_count || 0,
          kudosCount: detail.kudos_count || 0,

          laps: laps.map((lap, index) => ({
            id: lap.id || index,
            name: lap.name || "",
            distance: lap.distance || 0,
            moving_time: lap.moving_time || 0,
            elapsed_time: lap.elapsed_time || 0,
            average_heartrate:
              typeof lap.average_heartrate === "number" ? lap.average_heartrate : null,
            max_heartrate:
              typeof lap.max_heartrate === "number" ? lap.max_heartrate : null,
            pace_zone:
              typeof lap.pace_zone === "number" ? lap.pace_zone : null,
            lap_index:
              typeof lap.lap_index === "number" ? lap.lap_index : index,
            total_elevation_gain:
              typeof lap.total_elevation_gain === "number"
                ? lap.total_elevation_gain
                : null,
          })),

          syncedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      synced.push({
        id: detail.id,
        name: detail.name,
        runType: inferredRunType,
        laps: laps.length,
      });
    }

    return NextResponse.json({
      success: true,
      syncedCount: synced.length,
      synced,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Unknown Strava sync error.",
      },
      { status: 500 }
    );
  }
}
