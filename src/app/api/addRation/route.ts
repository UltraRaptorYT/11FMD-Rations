import { NextResponse } from "next/server";
import { google } from "googleapis";
import type { AddRationBody } from "@/types";
import { fromISO, toISO, getMonFri } from "@/lib/utils";

// Auth setup
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const SHEET_ID = process.env.RATION_SHEET_ID!;
const SHEET_NAME = process.env.RATIONS_SHEET_NAME!;

const WRITE_COLS_START = "C";
const WRITE_COLS_END = "M";

function startOfWeekMonday(iso: string) {
  const d = fromISO(iso);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

function keyOf(
  weekStart: string,
  date: string,
  name: string,
  rationType: string,
) {
  return `${weekStart}|${date}|${name}|${rationType}`;
}

async function appendRowsAtC(
  spreadsheetId: string,
  sheetName: string,
  rowsCtoM: (string | number)[][],
) {
  if (rowsCtoM.length === 0) return;

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [sheetName],
    includeGridData: false,
  });

  const sheet = meta.data.sheets?.find(
    (s) => s.properties?.title === sheetName,
  );

  if (sheet?.properties?.sheetId == null) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const sheetId = sheet.properties.sheetId;
  const currentRowCount = sheet.properties.gridProperties?.rowCount ?? 1000;

  // Read column C from row 2 onward
  const colC = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${WRITE_COLS_START}2:${WRITE_COLS_START}`,
  });

  const values = colC.data.values ?? [];

  // Find actual last used row in C
  let lastUsedRow = 1; // assume only header exists
  for (let i = values.length - 1; i >= 0; i--) {
    const cell = values[i]?.[0];
    if (cell !== undefined && String(cell).trim() !== "") {
      lastUsedRow = i + 2; // row number because range starts at row 2
      break;
    }
  }

  const nextRow = lastUsedRow + 1;

  const neededLastRow = nextRow + rowsCtoM.length - 1;
  if (neededLastRow > currentRowCount) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            appendDimension: {
              sheetId,
              dimension: "ROWS",
              length: neededLastRow - currentRowCount,
            },
          },
        ],
      },
    });
  }

  const data = rowsCtoM.map((row, i) => ({
    range: `${sheetName}!C${nextRow + i}:M${nextRow + i}`,
    values: [row],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AddRationBody & {
      editedBy?: string;
    };

    const name = (body?.name ?? "").trim();
    const rationType = (body?.rationType ?? "").trim();
    const weekStartInput = (body?.weekStart ?? "").trim();
    const plan = body?.plan;
    const editedBy = (body?.editedBy ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }
    if (!rationType) {
      return NextResponse.json(
        { error: "Missing rationType" },
        { status: 400 },
      );
    }
    if (!weekStartInput) {
      return NextResponse.json({ error: "Missing weekStart" }, { status: 400 });
    }
    if (!plan || typeof plan !== "object" || !plan.days) {
      return NextResponse.json({ error: "Missing plan.days" }, { status: 400 });
    }

    const weekStart = startOfWeekMonday(weekStartInput);
    const monFriDates = getMonFri(weekStart);
    const nowIso = new Date().toISOString();

    const desiredByKey = new Map<string, (string | number)[]>();

    for (const dateISO of monFriDates) {
      const day = plan.days[dateISO];

      const enabled = Boolean(day?.enabled);
      const b = enabled && day?.meals?.B ? 1 : 0;
      const l = enabled && day?.meals?.L ? 1 : 0;
      const din = enabled && day?.meals?.D ? 1 : 0;

      const hasAnyMeal = b + l + din > 0;
      const status = hasAnyMeal ? "ACTIVE" : "CANCELLED";

      const row: (string | number)[] = [
        weekStart,  // C
        dateISO,    // D
        name,       // E
        rationType, // F
        b,          // G
        l,          // H
        din,        // I
        status,     // J
        nowIso,     // K
        nowIso,     // L
        editedBy,   // M
      ];

      desiredByKey.set(keyOf(weekStart, dateISO, name, rationType), row);
    }

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!${WRITE_COLS_START}2:F`,
    });

    const existing = (readRes.data.values ?? []) as string[][];
    const rowByKey = new Map<string, number>();

    existing.forEach((r, idx) => {
      const ws = (r?.[0] ?? "").trim(); // C
      const dt = (r?.[1] ?? "").trim(); // D
      const nm = (r?.[2] ?? "").trim(); // E
      const rt = (r?.[3] ?? "").trim(); // F

      if (!ws || !dt || !nm || !rt) return;
      rowByKey.set(keyOf(ws, dt, nm, rt), idx + 2);
    });

    const updateRequests: {
      range: string;
      values: (string | number)[][];
    }[] = [];

    const appendValues: (string | number)[][] = [];

    for (const [k, rowValues] of desiredByKey.entries()) {
      const existingRowNumber = rowByKey.get(k);

      if (existingRowNumber != null) {
        updateRequests.push({
          range: `${SHEET_NAME}!${WRITE_COLS_START}${existingRowNumber}:${WRITE_COLS_END}${existingRowNumber}`,
          values: [rowValues],
        });
      } else {
        appendValues.push(rowValues);
      }
    }

    if (updateRequests.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: updateRequests,
        },
      });
    }

    if (appendValues.length > 0) {
      await appendRowsAtC(SHEET_ID, SHEET_NAME, appendValues);
    }

    return NextResponse.json(
      {
        ok: true,
        weekStart,
        name,
        rationType,
        editedBy: editedBy || null,
        updated: updateRequests.length,
        appended: appendValues.length,
        totalWritten: updateRequests.length + appendValues.length,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("POST addRation Error:", err);
    return NextResponse.json(
      { error: "Failed to add ration" },
      { status: 500 },
    );
  }
}