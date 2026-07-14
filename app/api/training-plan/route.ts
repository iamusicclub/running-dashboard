import { NextResponse } from "next/server";

const SPREADSHEET_ID =
  "1ze7UzVXiR3aBFODizWmT3KF5kTsIzlqEcIi06a9ZHlA";

const SHEET_GID = "0";

type ParsedRow = {
  rowNumber: number;
  cells: string[];
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

      const rowContainsData = currentRow.some(
        (cell) => cell.length > 0
      );

      if (rowContainsData) {
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

function normaliseRows(rows: string[][]): ParsedRow[] {
  return rows.map((cells, index) => ({
    rowNumber: index + 1,
    cells,
  }));
}

export async function GET() {
  try {
    const csvUrl =
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}` +
      `/export?format=csv&gid=${SHEET_GID}`;

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
          guidance:
            "Confirm that the relevant sheet tab has been published to the web.",
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
            "Google returned an HTML page instead of CSV data.",
          guidance:
            "Publish the relevant Google Sheets tab to the web and confirm that it is publicly readable.",
        },
        {
          status: 502,
        }
      );
    }

    const rows = normaliseRows(parseCsv(csvText));

    return NextResponse.json({
      success: true,
      spreadsheetId: SPREADSHEET_ID,
      sheetGid: SHEET_GID,
      rowCount: rows.length,
      rows,
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
