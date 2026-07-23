import { NextRequest, NextResponse } from "next/server";

const SPREADSHEET_ID =
  "1ze7UzVXiR3aBFODizWmT3KF5kTsIzlqEcIi06a9ZHlA";

const DEFAULT_SHEET_GID = "0";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

type DayName = (typeof DAY_NAMES)[number];

type ParsedCsvRow = {
  rowNumber: number;
  cells: string[];
};

type DistanceRange = {
  minimumKm: number | null;
  maximumKm: number | null;
  display: string;
};

type PlannedSession = {
  id: string;
  sourceRowNumber: number;
  weekEndingDate: string;
  plannedDate: string;
  dayName: DayName;
  dayIndex: number;
  rawText: string;
  title: string;
  sessionType:
    | "recovery"
    | "easy"
    | "steady"
    | "tempo"
    | "threshold"
    | "interval"
    | "marathon-pace"
    | "long-run"
    | "race"
    | "rest"
    | "cross-training"
    | "other";
  isRestDay: boolean;
  isKeySession: boolean;
  distance: DistanceRange;
  targetPaceText: string | null;
};

type TrainingWeek = {
  id: string;
  sourceRowNumber: number;
  weekEndingDate: string;
  weekStartingDate: string;
  totalVolumeText: string;
  totalVolumeKm: number | null;
  performanceText: string;
  phase: string | null;
  sessions: PlannedSession[];
};

function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];

  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (character === "," && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if (
      (character === "\n" || character === "\r") &&
      !insideQuotes
    ) {
      if (
        character === "\r" &&
        nextCharacter === "\n"
      ) {
        index += 1;
      }

      currentRow.push(currentCell.trim());

      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }

      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += character;
  }

  currentRow.push(currentCell.trim());

  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function normaliseRows(rows: string[][]): ParsedCsvRow[] {
  return rows.map((cells, index) => ({
    rowNumber: index + 1,
    cells,
  }));
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseBritishDate(value: string): Date | null {
  const cleaned = value
    .replace(/^WE\s*/i, "")
    .trim();

  const match = cleaned.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/
  );

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);

  if (year < 100) {
    year += 2000;
  }

  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);
  return result;
}

function normaliseText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectPhase(value: string) {
  const text = value.toUpperCase();

  if (text.includes("TAPER")) return "Taper";
  if (text.includes("SHARPEN")) return "Sharpen";
  if (text.includes("QUALITY")) return "Quality";
  if (text.includes("BASE")) return "Base";

  return null;
}

function inferSessionType(
  value: string
): PlannedSession["sessionType"] {
  const text = value.toLowerCase();

  if (
    text.includes("active recovery/rest") ||
    text === "rest" ||
    text.includes("full rest")
  ) {
    return "rest";
  }

  if (
    text.includes("race") ||
    text.includes("10k (a)") ||
    text.includes("half marathon") ||
    text.includes(" hm??") ||
    text.includes("parkrun")
  ) {
    return "race";
  }

  if (
    text.includes("marathon pace") ||
    text.includes("@ mp") ||
    text.includes(" mp ") ||
    text.includes("m pace")
  ) {
    return "marathon-pace";
  }

  if (
    text.includes("interval") ||
    /\d+\s*x\s*\d+/.test(text) ||
    /\d+x\d+/.test(text) ||
    text.includes("reps") ||
    text.includes("400m") ||
    text.includes("800m") ||
    text.includes("1000m") ||
    text.includes("1200m") ||
    text.includes("1500m") ||
    text.includes("1km") ||
    text.includes("2km")
  ) {
    return "interval";
  }

  if (
    text.includes("threshold") ||
    text.includes("10k effort") ||
    text.includes("5k effort")
  ) {
    return "threshold";
  }

  if (
    text.includes("tempo") ||
    text.includes("wave")
  ) {
    return "tempo";
  }

  if (
    text.includes("long run") ||
    text.includes("long easy") ||
    text.includes("mini session")
  ) {
    return "long-run";
  }

  if (
    text.includes("recovery") ||
    text.includes("rec pace") ||
    text.includes("plod") ||
    text.includes("leg flush")
  ) {
    return "recovery";
  }

  if (
    text.includes("steady") ||
    text.includes(" st ") ||
    text.includes("progressive")
  ) {
    return "steady";
  }

  if (
    text.includes("easy") ||
    text.includes("strides")
  ) {
    return "easy";
  }

  if (
    text.includes("bike") ||
    text.includes("cycle") ||
    text.includes("swim") ||
    text.includes("cross train")
  ) {
    return "cross-training";
  }

  return "other";
}

function inferTitle(
  value: string,
  sessionType: PlannedSession["sessionType"]
) {
  const lines = normaliseText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const firstMeaningfulLine = lines.find(
    (line) =>
      !["BASE", "QUALITY", "SHARPEN", "TAPER"].includes(
        line.toUpperCase()
      )
  );

  if (firstMeaningfulLine) {
    return firstMeaningfulLine;
  }

  const fallbackTitles: Record<
    PlannedSession["sessionType"],
    string
  > = {
    recovery: "Recovery run",
    easy: "Easy run",
    steady: "Steady run",
    tempo: "Tempo session",
    threshold: "Threshold session",
    interval: "Interval session",
    "marathon-pace": "Marathon-pace session",
    "long-run": "Long run",
    race: "Race",
    rest: "Rest",
    "cross-training": "Cross training",
    other: "Planned session",
  };

  return fallbackTitles[sessionType];
}

function extractDistanceRange(value: string): DistanceRange {
  const text = value.toLowerCase();

  const rangeMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:\/|-|to)\s*(\d+(?:\.\d+)?)\s*km/
  );

  if (rangeMatch) {
    const first = Number(rangeMatch[1]);
    const second = Number(rangeMatch[2]);

    return {
      minimumKm: Math.min(first, second),
      maximumKm: Math.max(first, second),
      display: `${first}-${second} km`,
    };
  }

  const singleMatch = text.match(
    /(\d+(?:\.\d+)?)\s*km/
  );

  if (singleMatch) {
    const distance = Number(singleMatch[1]);

    return {
      minimumKm: distance,
      maximumKm: distance,
      display: `${distance} km`,
    };
  }

  return {
    minimumKm: null,
    maximumKm: null,
    display: "",
  };
}

function extractTargetPace(value: string) {
  const text = normaliseText(value);

  const paceExpressions = [
    /\b\d:\d{2}\s*\/?\s*km\b/i,
    /\b\d:\d{2}s?\b/i,
    /\b\d:\d{2}\s*-\s*\d:\d{2}\b/i,
    /\b\d:\d{2}\/\d{2}s?\b/i,
    /\bHM\/10k P\b/i,
    /\b10k Race Pace\b/i,
    /\b10k Effort\b/i,
    /\b5k effort\b/i,
    /\bRec Pace\b/i,
    /\bEasy Pace\b/i,
  ];

  const matches = paceExpressions
    .map((expression) => text.match(expression)?.[0])
    .filter((match): match is string => Boolean(match));

  if (matches.length === 0) {
    return null;
  }

  return Array.from(new Set(matches)).join(" | ");
}

function extractTotalVolumeKm(value: string) {
  const matches = Array.from(
    value.matchAll(/(\d+(?:\.\d+)?)\s*km/gi)
  );

  if (matches.length === 0) {
    return null;
  }

  const values = matches
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);

  if (values.length === 0) {
    return null;
  }

  /*
    The final figure in the total-volume cell is normally
    the completed or recorded weekly total.
  */
  return values[values.length - 1];
}

function isUsableSessionCell(value: string) {
  const cleaned = normaliseText(value);

  if (!cleaned) return false;

  const phaseOnly = [
    "BASE",
    "QUALITY",
    "SHARPEN",
    "TAPER",
  ].includes(cleaned.toUpperCase());

  return !phaseOnly;
}

function buildSession(
  sourceRowNumber: number,
  weekEndingDate: Date,
  dayIndex: number,
  rawValue: string
): PlannedSession | null {
  const rawText = normaliseText(rawValue);

  if (!isUsableSessionCell(rawText)) {
    return null;
  }

  const monday = addDays(weekEndingDate, -6);
  const plannedDate = addDays(monday, dayIndex);
  const sessionType = inferSessionType(rawText);
  const distance = extractDistanceRange(rawText);

  return {
    id: `${formatDateKey(plannedDate)}-${dayIndex}`,
    sourceRowNumber,
    weekEndingDate: formatDateKey(weekEndingDate),
    plannedDate: formatDateKey(plannedDate),
    dayName: DAY_NAMES[dayIndex],
    dayIndex,
    rawText,
    title: inferTitle(rawText, sessionType),
    sessionType,
    isRestDay: sessionType === "rest",
    isKeySession:
      sessionType === "threshold" ||
      sessionType === "interval" ||
      sessionType === "tempo" ||
      sessionType === "marathon-pace" ||
      sessionType === "long-run" ||
      sessionType === "race",
    distance,
    targetPaceText: extractTargetPace(rawText),
  };
}

function buildTrainingWeeks(
  rows: ParsedCsvRow[]
): TrainingWeek[] {
  const weeks: TrainingWeek[] = [];

  for (const row of rows) {
    const weekEndingDate = parseBritishDate(
      row.cells[0] || ""
    );

    if (!weekEndingDate) {
      continue;
    }

    const monday = addDays(weekEndingDate, -6);

    const sessionCells = row.cells.slice(1, 8);

    const phase =
  sessionCells
    .map(detectPhase)
    .find(
      (
        value
      ): value is Exclude<
        ReturnType<typeof detectPhase>,
        null
      > => value !== null
    ) ?? null;

    const sessions = sessionCells
      .map((cell, dayIndex) =>
        buildSession(
          row.rowNumber,
          weekEndingDate,
          dayIndex,
          cell || ""
        )
      )
      .filter(
        (session): session is PlannedSession =>
          session !== null
      );

    const totalVolumeText = normaliseText(
      row.cells[8] || ""
    );

    const performanceText = normaliseText(
      row.cells[9] || ""
    );

    weeks.push({
      id: formatDateKey(weekEndingDate),
      sourceRowNumber: row.rowNumber,
      weekEndingDate: formatDateKey(weekEndingDate),
      weekStartingDate: formatDateKey(monday),
      totalVolumeText,
      totalVolumeKm:
        extractTotalVolumeKm(totalVolumeText),
      performanceText,
      phase,
      sessions,
    });
  }

  return weeks.sort((first, second) =>
    first.weekStartingDate.localeCompare(
      second.weekStartingDate
    )
  );
}

export async function GET(request: NextRequest) {
  try {
    const requestedGid =
      request.nextUrl.searchParams.get("gid");

    const sheetGid =
      requestedGid || DEFAULT_SHEET_GID;

    const csvUrl =
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}` +
      `/export?format=csv&gid=${sheetGid}`;

    const response = await fetch(csvUrl, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "text/csv",
      },
    });

    if (!response.ok) {
      const responseText = await response.text();

      return NextResponse.json(
        {
          success: false,
          error: `Google Sheets request failed with status ${response.status}.`,
          details: responseText.slice(0, 500),
        },
        {
          status: response.status,
        }
      );
    }

    const contentType =
      response.headers.get("content-type") || "";

    const csvText = await response.text();

    if (
      contentType.includes("text/html") ||
      csvText.trim().startsWith("<!DOCTYPE html") ||
      csvText.trim().startsWith("<html")
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Google returned HTML rather than CSV data.",
          guidance:
            "Confirm that the requested sheet tab is published and publicly readable.",
        },
        {
          status: 502,
        }
      );
    }

    const parsedRows = normaliseRows(
      parseCsv(csvText)
    );

    const weeks = buildTrainingWeeks(parsedRows);

    const sessions = weeks.flatMap(
      (week) => week.sessions
    );

    const availableYears = Array.from(
      new Set(
        weeks.map((week) =>
          Number(week.weekStartingDate.slice(0, 4))
        )
      )
    ).sort((first, second) => first - second);

    return NextResponse.json({
      success: true,
      spreadsheetId: SPREADSHEET_ID,
      sheetGid,
      sourceRowCount: parsedRows.length,
      parsedWeekCount: weeks.length,
      parsedSessionCount: sessions.length,
      availableYears,
      firstWeek:
        weeks.length > 0
          ? weeks[0].weekStartingDate
          : null,
      finalWeek:
        weeks.length > 0
          ? weeks[weeks.length - 1].weekEndingDate
          : null,
      warning:
        availableYears.includes(2026)
          ? null
          : "No 2026 training weeks were found in this sheet tab. Confirm that gid=0 is the correct tab for the Malaga 2026 plan.",
      weeks,
      sessions,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "An unknown training-plan error occurred.",
      },
      {
        status: 500,
      }
    );
  }
}
