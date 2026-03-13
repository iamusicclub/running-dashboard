import { NextRequest, NextResponse } from "next/server";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../../../lib/firebase";

const TOKEN_COLLECTION = "stravaAuth";
const TOKEN_DOC_ID = "primary";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      return NextResponse.redirect(new URL(`/runs?error=${encodeURIComponent(error)}`, request.url));
    }

    if (!code) {
      return NextResponse.redirect(
        new URL("/runs?error=Missing%20Strava%20authorization%20code", request.url)
      );
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        new URL("/runs?error=Missing%20STRAVA_CLIENT_ID%20or%20STRAVA_CLIENT_SECRET", request.url)
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
      cache: "no-store",
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      return NextResponse.redirect(
        new URL(`/runs?error=${encodeURIComponent(`Failed to exchange Strava code: ${text}`)}`, request.url)
      );
    }

    const tokenData = await tokenResponse.json();

    await setDoc(
      doc(db, TOKEN_COLLECTION, TOKEN_DOC_ID),
      {
        access_token: tokenData.access_token || "",
        refresh_token: tokenData.refresh_token || "",
        expires_at: tokenData.expires_at || null,
        athlete: tokenData.athlete || null,
        scope: tokenData.scope || "",
        token_type: tokenData.token_type || "",
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.redirect(new URL("/runs?strava=connected", request.url));
  } catch (error: any) {
    return NextResponse.redirect(
      new URL(
        `/runs?error=${encodeURIComponent(error?.message || "Unknown Strava callback error")}`,
        request.url
      )
    );
  }
}
