import { NextResponse } from "next/server";
import { google } from "googleapis";
import type { AddRationBody } from "@/types";
import { fromISO, toISO } from "@/lib/utils";

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

const WRITE_COLS_START = "B";
const WRITE_COLS_END = "K";
function startOfWeekMonday(iso: string) {
  const d = fromISO(iso);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // Sun=0..Sat=6
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}
function getMonFri(weekStartISO: string) {
  const monday = fromISO(weekStartISO);
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    out.push(toISO(d));
  }
  return out;
}

function keyOf(weekStart: string, date: string, name: string) {
  return `${weekStart}|${date}|${name}`;
}

async function appendRowsAtB(
  spreadsheetId: string,
  sheetName: string,
  rowsBtoK: (string | number)[][],
) {
  if (rowsBtoK.length === 0) return;

  // Find next empty row by looking at column B (week_start)
  const colB = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!B2:B`,
  });

  const existingCount = (colB.data.values ?? []).length;
  const startRow = existingCount + 2; // because B2 is first data row

  // Write each row into its exact B..K target range
  const data = rowsBtoK.map((row, i) => ({
    range: `${sheetName}!B${startRow + i}:K${startRow + i}`,
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
    const body = (await request.json()) as AddRationBody;

    const name = (body?.name ?? "").trim();
    const rationType = (body?.rationType ?? "").trim();
    const weekStartInput = (body?.weekStart ?? "").trim();
    const plan = body?.plan;

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

    // normalize weekStart to Monday (local)
    const weekStart = startOfWeekMonday(weekStartInput);

    // We enforce writing Mon–Fri only based on weekStart
    const monFriDates = getMonFri(weekStart);

    const nowIso = new Date().toISOString();

    // Build desired rows for Mon–Fri
    // Each row is B..K (10 cols)
    // [week_start, date, name, ration_type, B, L, D, status, submitted_at, updated_at]
    const desiredByKey = new Map<string, (string | number)[]>();

    for (const dateISO of monFriDates) {
      const day = plan.days[dateISO];

      const enabled = Boolean(day?.enabled);
      const b = enabled && day?.meals?.B ? 1 : 0;
      const l = enabled && day?.meals?.L ? 1 : 0;
      const din = enabled && day?.meals?.D ? 1 : 0;

      // If enabled but no meals ticked, treat as CANCELLED (or you can force enabled=false on client)
      const hasAnyMeal = b + l + din > 0;
      const status = hasAnyMeal ? "ACTIVE" : "CANCELLED";

      const row: (string | number)[] = [
        weekStart, // B
        dateISO, // C
        name, // D
        rationType, // E
        b, // F
        l, // G
        din, // H
        status, // I
        nowIso, // J (submitted_at)
        nowIso, // K (updated_at)
      ];

      desiredByKey.set(keyOf(weekStart, dateISO, name), row);
    }

    // 1) Read existing rows to find upserts
    // Read B2:D (week_start,date,name) to locate matching keys and row numbers
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!B2:D`,
    });

    const existing = (readRes.data.values ?? []) as string[][];
    // Map bookingKey -> sheetRowNumber (1-indexed)
    const rowByKey = new Map<string, number>();

    // Row numbers: data starts at row 2, so index 0 -> row 2
    existing.forEach((r, idx) => {
      const ws = (r?.[0] ?? "").trim();
      const dt = (r?.[1] ?? "").trim();
      const nm = (r?.[2] ?? "").trim();
      if (!ws || !dt || !nm) return;
      rowByKey.set(keyOf(ws, dt, nm), idx + 2);
    });

    // 2) Build update requests + append rows
    const updateRequests: {
      range: string;
      values: (string | number)[][];
    }[] = [];

    const appendValues: (string | number)[][] = [];

    for (const [k, rowValues] of desiredByKey.entries()) {
      const existingRowNumber = rowByKey.get(k);

      if (existingRowNumber) {
        updateRequests.push({
          range: `${SHEET_NAME}!${WRITE_COLS_START}${existingRowNumber}:${WRITE_COLS_END}${existingRowNumber}`,
          values: [rowValues],
        });
      } else {
        appendValues.push(rowValues);
      }
    }

    // 3) Perform batch updates (updates)
    if (updateRequests.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: updateRequests,
        },
      });
    }

    // 4) Append new rows (B..K only; A booking_id is formula)
    if (appendValues.length > 0) {
      await appendRowsAtB(SHEET_ID, SHEET_NAME, appendValues);
    }

    return NextResponse.json(
      {
        ok: true,
        weekStart,
        name,
        rationType,
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
