import { NextRequest, NextResponse } from "next/server";
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../../../../lib/firebase";

async function refreshAccessTokenIfNeeded(connection: any) {
  const now = Math.floor(Date.now() / 1000);

  if (connection.expiresAt && connection.expiresAt > now + 60) {
    return connection;
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET");
  }

  const refreshResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    }),
  });

  const refreshData = await refreshResponse.json();

  if (!refreshResponse.ok) {
    throw new Error(refreshData?.message || "Failed to refresh Strava token.");
  }

  const updatedConnection = {
    ...connection,
    accessToken: refreshData.access_token,
    refreshToken: refreshData.refresh_token,
    expiresAt: refreshData.expires_at,
    updatedAt: new Date().toISOString(),
  };

  await setDoc(doc(db, "stravaConnections", connection.athleteId), updatedConnection, {
    merge: true,
  });

  return updatedConnection;
}

function secondsToDisplayTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes < 10 ? `0${minutes}` : minutes}:${
      seconds < 10 ? `0${seconds}` : seconds
    }`;
  }

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
}

function mapStravaRunType(activity: any) {
  const sportType = String(activity.sport_type || activity.type || "").toLowerCase();
  const workoutType = activity.workout_type;

  if (sportType.includes("trail")) return "long";
  if (workoutType === 1) return "race";
  if (workoutType === 2) return "long";
  if (workoutType === 3) return "workout";
  if (sportType.includes("run")) return "easy";

  return "other";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const athleteId = body?.athleteId;

    if (!athleteId) {
      return NextResponse.json(
        { error: "athleteId is required." },
        { status: 400 }
      );
    }

    const connectionQuery = query(
      collection(db, "stravaConnections"),
      where("athleteId", "==", athleteId)
    );

    const connectionSnapshot = await getDocs(connectionQuery);

    if (connectionSnapshot.empty) {
      return NextResponse.json(
        { error: "No Strava connection found for this athlete." },
        { status: 404 }
      );
    }

    let connection = connectionSnapshot.docs[0].data();
    connection = await refreshAccessTokenIfNeeded(connection);

    const activitiesResponse = await fetch(
      "https://www.strava.com/api/v3/athlete/activities?per_page=50&page=1",
      {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
        },
      }
    );

    const activities = await activitiesResponse.json();

    if (!activitiesResponse.ok) {
      return NextResponse.json(
        { error: activities?.message || "Failed to fetch Strava activities." },
        { status: 500 }
      );
    }

    let imported = 0;

    for (const activity of activities) {
      const sportType = activity.sport_type || activity.type || "";
      const allowedSports = ["Run", "TrailRun", "VirtualRun"];

      if (!allowedSports.includes(sportType)) {
        continue;
      }

      const runId = `strava_${activity.id}`;

      const distanceMeters = Number(activity.distance || 0);
      const distanceKm = distanceMeters / 1000;

      const movingTimeSeconds = Number(activity.moving_time || 0);
      const elapsedTimeSeconds = Number(activity.elapsed_time || 0);

      const averageHeartrate = activity.average_heartrate
        ? Number(activity.average_heartrate)
        : null;

      const maxHeartrate = activity.max_heartrate
        ? Number(activity.max_heartrate)
        : null;

      const averageCadence = activity.average_cadence
        ? Number(activity.average_cadence)
        : null;

      const averageSpeedMps = activity.average_speed
        ? Number(activity.average_speed)
        : null;

      const maxSpeedMps = activity.max_speed
        ? Number(activity.max_speed)
        : null;

      const totalElevationGain = activity.total_elevation_gain
        ? Number(activity.total_elevation_gain)
        : 0;

      const paceSecondsPerKm =
        distanceKm > 0 && movingTimeSeconds > 0
          ? movingTimeSeconds / distanceKm
          : null;

      const averagePaceDisplay =
        paceSecondsPerKm !== null
          ? `${Math.floor(paceSecondsPerKm / 60)}:${
              Math.round(paceSecondsPerKm % 60) < 10
                ? `0${Math.round(paceSecondsPerKm % 60)}`
                : Math.round(paceSecondsPerKm % 60)
            }`
          : "";

      await setDoc(
        doc(db, "runs", runId),
        {
          source: "strava",
          stravaActivityId: String(activity.id),
          athleteId: String(connection.athleteId),

          date: activity.start_date_local
            ? String(activity.start_date_local).slice(0, 10)
            : "",

          startDate: activity.start_date || "",
          startDateLocal: activity.start_date_local || "",

          name: activity.name || "",
          notes: activity.name || "",

          distance: distanceKm.toFixed(2),
          distanceMeters,

          time: secondsToDisplayTime(movingTimeSeconds),
          movingTimeSeconds,
          elapsedTimeSeconds,

          pace: averagePaceDisplay,
          paceSecondsPerKm,

          runType: mapStravaRunType(activity),
          rawSportType: sportType,
          workoutType: activity.workout_type ?? null,

          avgHr: averageHeartrate ? String(Math.round(averageHeartrate)) : "",
          averageHeartrate,
          maxHeartrate,

          elevation: String(Math.round(totalElevationGain)),
          totalElevationGain,

          averageCadence,
          averageSpeedMps,
          maxSpeedMps,

          trainer: !!activity.trainer,
          commute: !!activity.commute,
          manual: !!activity.manual,
          private: !!activity.private,

          achievementCount: Number(activity.achievement_count || 0),
          kudosCount: Number(activity.kudos_count || 0),

          aiAnalysis: null,

          rawStrava: activity,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );

      imported += 1;
    }

    return NextResponse.json({
      success: true,
      imported,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Something went wrong during Strava sync." },
      { status: 500 }
    );
  }
}
