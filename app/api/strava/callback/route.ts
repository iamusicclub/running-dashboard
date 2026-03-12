import { NextRequest, NextResponse } from "next/server";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../../../lib/firebase";

export async function GET(req: NextRequest) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET" },
      { status: 500 }
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const scope = searchParams.get("scope");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/runs?strava=denied", req.url));
  }

  if (!code) {
    return NextResponse.json(
      { error: "No Strava authorization code received." },
      { status: 400 }
    );
  }

  const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    return NextResponse.json(
      { error: tokenData?.message || "Failed to exchange Strava code." },
      { status: 500 }
    );
  }

  const athleteId = String(tokenData?.athlete?.id || "default-user");

  await setDoc(
    doc(db, "stravaConnections", athleteId),
    {
      athleteId,
      scope: scope || "",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_at,
      athlete: tokenData.athlete || null,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  return NextResponse.redirect(new URL(`/runs?strava=connected&athlete=${athleteId}`, req.url));
}
