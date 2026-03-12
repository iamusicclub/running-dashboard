
import { NextRequest, NextResponse } from "next/server";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
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

function mapStravaSportTypeToRunType(sportType: string) {
  const value = (sportType || "").toLowerCase();

  if (value.includes("run")) return "easy";
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

      const movingTime = Number(activity.moving_time || 0);
      const hours = Math.floor(movingTime / 3600);
      const minutes = Math.floor((movingTime % 3600) / 60);
      const seconds = movingTime % 60;

      const formattedTime =
        hours > 0
          ? `${hours}:${minutes < 10 ? `0${minutes}` : minutes}:${seconds < 10 ? `0${seconds}` : seconds}`
          : `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;

      await setDoc(
        doc(db, "runs", runId),
        {
          source: "strava",
          stravaActivityId: String(activity.id),
          athleteId: String(connection.athleteId),
          date: activity.start_date_local
            ? String(activity.start_date_local).slice(0, 10)
            : "",
          distance: ((activity.distance || 0) / 1000).toFixed(2),
          time: formattedTime,
          notes: activity.name || "",
          runType: mapStravaSportTypeToRunType(sportType),
          avgHr: activity.average_heartrate ? String(Math.round(activity.average_heartrate)) : "",
          elevation: activity.total_elevation_gain
            ? String(Math.round(activity.total_elevation_gain))
            : "",
          rawSportType: sportType,
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
