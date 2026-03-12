
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

function buildSignals(runs: Run[]) {
  const totalRuns = runs.length;
  const totalDistance = runs.reduce(
    (sum, run) => sum + parseFloat(run.distance || "0"),
    0
  );

  const distances = runs.map((run) => parseFloat(run.distance || "0")).filter((n) => n > 0);
  const avgDistance = average(distances);

  const avgHr = average(
    runs.map((run) => parseFloat(run.avgHr || "0")).filter((n) => n > 0)
  );

  const avgPaceSeconds = average(
    runs
      .map((run) => calculatePaceSeconds(run.time, run.distance))
      .filter((n): n is number => n !== null)
  );

  const runTypeCounts: Record<string, number> = {
    easy: 0,
    long: 0,
    tempo: 0,
    interval: 0,
    race: 0,
    recovery: 0,
    other: 0,
  };

  for (const run of runs) {
    const key = (run.runType || "other").toLowerCase();
    if (runTypeCounts[key] !== undefined) {
      runTypeCounts[key] += 1;
    } else {
      runTypeCounts.other += 1;
    }
  }

  const longestRun = Math.max(...distances, 0);

  const recentRuns = runs.slice(0, 3);
  const olderRuns = runs.slice(3, 6);

  const recentAvgPace = average(
    recentRuns
      .map((run) => calculatePaceSeconds(run.time, run.distance))
      .filter((n): n is number => n !== null)
  );

  const olderAvgPace = average(
    olderRuns
      .map((run) => calculatePaceSeconds(run.time, run.distance))
      .filter((n): n is number => n !== null)
  );

  let paceTrend = "stable";
  if (recentAvgPace && olderAvgPace) {
    if (recentAvgPace < olderAvgPace * 0.98) paceTrend = "improving";
    if (recentAvgPace > olderAvgPace * 1.02) paceTrend = "slowing";
  }

  const latestRun = runs[0]
    ? {
        date: runs[0].date,
        distance: runs[0].distance,
        time: runs[0].time,
        runType: runs[0].runType,
        avgHr: runs[0].avgHr,
        elevation: runs[0].elevation,
        notes: runs[0].notes,
        paceSeconds: calculatePaceSeconds(runs[0].time, runs[0].distance),
      }
    : null;

  return {
    totalRuns,
    totalDistance: Number(totalDistance.toFixed(1)),
    avgDistance: avgDistance ? Number(avgDistance.toFixed(1)) : null,
    avgHr: avgHr ? Math.round(avgHr) : null,
    avgPaceSeconds: avgPaceSeconds ? Math.round(avgPaceSeconds) : null,
    longestRun: Number(longestRun.toFixed(1)),
    runTypeCounts,
    paceTrend,
    latestRun,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { runs } = await req.json();

    if (!Array.isArray(runs) || runs.length === 0) {
      return NextResponse.json(
        { error: "No runs were provided." },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing." },
        { status: 500 }
      );
    }

    const signals = buildSignals(runs.slice(0, 12));

    const prompt = `
You are a thoughtful running coach.
Use only the structured training data below.
Do not invent workouts, injuries, weather, splits, or race results.
Be specific, concise, and useful.

Training data:
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
            name: "coaching_summary",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                headline: { type: "string" },
                summary: { type: "string" },
                positives: {
                  type: "array",
                  items: { type: "string" },
                },
                watchouts: {
                  type: "array",
                  items: { type: "string" },
                },
                next_step: { type: "string" },
              },
              required: [
                "headline",
                "summary",
                "positives",
                "watchouts",
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
