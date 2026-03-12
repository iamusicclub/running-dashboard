import { NextRequest, NextResponse } from "next/server";

type Run = {
  id?: string;
  date: string;
  distance: string;
  time: string;
  notes: string;
  runType: string;
  avgHr: string;
  elevation: string;
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

function calculatePaceSeconds(time: string, distance: string) {
  const distanceNum = parseFloat(distance);

  if (!time || !distanceNum || distanceNum <= 0) {
    return null;
  }

  const totalSeconds = timeToSeconds(time);

  if (!totalSeconds) {
    return null;
  }

  return totalSeconds / distanceNum;
}

function average(numbers: number[]) {
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function buildRunSignals(run: Run, allRuns: Run[]) {
  const distance = parseFloat(run.distance || "0");
  const avgHr = parseFloat(run.avgHr || "0");
  const paceSeconds = calculatePaceSeconds(run.time, run.distance);

  const recentRuns = allRuns.slice(0, 8);

  const avgDistance = average(
    recentRuns.map((r) => parseFloat(r.distance || "0")).filter((n) => n > 0)
  );

  const avgRecentHr = average(
    recentRuns.map((r) => parseFloat(r.avgHr || "0")).filter((n) => n > 0)
  );

  const avgRecentPace = average(
    recentRuns
      .map((r) => calculatePaceSeconds(r.time, r.distance))
      .filter((n): n is number => n !== null)
  );

  const longerThanRecent = !!avgDistance && distance > avgDistance * 1.2;
  const shorterThanRecent = !!avgDistance && distance < avgDistance * 0.8;
  const fasterThanRecent = !!avgRecentPace && !!paceSeconds && paceSeconds < avgRecentPace * 0.97;
  const slowerThanRecent = !!avgRecentPace && !!paceSeconds && paceSeconds > avgRecentPace * 1.03;
  const hrHigherThanRecent = !!avgRecentHr && avgHr > avgRecentHr * 1.05;

  return {
    run,
    metrics: {
      distanceKm: distance || null,
      time: run.time || null,
      paceSecondsPerKm: paceSeconds ? Math.round(paceSeconds) : null,
      avgHr: avgHr || null,
      elevationMeters: parseFloat(run.elevation || "0") || null,
      runType: run.runType || "unknown",
    },
    comparisons: {
      avgRecentDistanceKm: avgDistance ? Number(avgDistance.toFixed(1)) : null,
      avgRecentHr: avgRecentHr ? Math.round(avgRecentHr) : null,
      avgRecentPaceSecondsPerKm: avgRecentPace ? Math.round(avgRecentPace) : null,
      longerThanRecent,
      shorterThanRecent,
      fasterThanRecent,
      slowerThanRecent,
      hrHigherThanRecent,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const { run, allRuns } = await req.json();

    if (!run || !allRuns || !Array.isArray(allRuns)) {
      return NextResponse.json(
        { error: "Run and allRuns are required." },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing." },
        { status: 500 }
      );
    }

    const signals = buildRunSignals(run, allRuns);

    const prompt = `
You are a thoughtful running coach.
Use only the structured run data below.
Do not invent injuries, weather, workouts, goals, or splits.
Be specific, concise, and practical.

Structured run data:
${JSON.stringify(signals, null, 2)}
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "run_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                headline: { type: "string" },
                summary: { type: "string" },
                what_went_well: {
                  type: "array",
                  items: { type: "string" },
                },
                watchouts: {
                  type: "array",
                  items: { type: "string" },
                },
                impact_on_training: { type: "string" },
                next_step: { type: "string" },
              },
              required: [
                "headline",
                "summary",
                "what_went_well",
                "watchouts",
                "impact_on_training",
                "next_step",
              ],
            },
          },
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "OpenAI request failed." },
        { status: 500 }
      );
    }

    const rawText =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      data.output?.[0]?.content?.[0]?.value ||
      "";

    const parsed = JSON.parse(rawText);

    return NextResponse.json(parsed);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Something went wrong." },
      { status: 500 }
    );
  }
}
