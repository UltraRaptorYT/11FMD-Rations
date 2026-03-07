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
const WRITE_COLS_END = "M"; // CHANGED: was "L", now "M" to include edited_by

function startOfWeekMonday(iso: string) {
  const d = fromISO(iso);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

function keyOf(weekStart: string, date: string, name: string) {
  return `${weekStart}|${date}|${name}`;
}

async function appendRowsAtC(
  spreadsheetId: string,
  sheetName: string,
  rowsCtoM: (string | number)[][],
) {
  if (rowsCtoM.length === 0) return;

  const colC = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${WRITE_COLS_START}2:${WRITE_COLS_START}`,
  });

  const existingCount = (colC.data.values ?? []).length;
  const startRow = existingCount + 2;

  const data = rowsCtoM.map((row, i) => ({
    range: `${sheetName}!${WRITE_COLS_START}${startRow + i}:${WRITE_COLS_END}${startRow + i}`,
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
    const editedBy = (body?.editedBy ?? "").trim(); // CHANGED: read editedBy

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

    // Build desired rows for Mon–Fri
    // Each row is C..M (11 cols)
    // [week_start, date, name, ration_type, B, L, D, status, submitted_at, updated_at, edited_by]
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
        weekStart, // C
        dateISO, // D
        name, // E
        rationType, // F
        b, // G
        l, // H
        din, // I
        status, // J
        nowIso, // K (submitted_at)
        nowIso, // L (updated_at)
        editedBy, // M (edited_by) — empty string if self-edit
      ];

      desiredByKey.set(keyOf(weekStart, dateISO, name), row);
    }

    // Read existing rows to find upserts
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!${WRITE_COLS_START}2:E`,
    });

    const existing = (readRes.data.values ?? []) as string[][];
    const rowByKey = new Map<string, number>();

    existing.forEach((r, idx) => {
      const ws = (r?.[0] ?? "").trim();
      const dt = (r?.[1] ?? "").trim();
      const nm = (r?.[2] ?? "").trim();
      if (!ws || !dt || !nm) return;
      rowByKey.set(keyOf(ws, dt, nm), idx + 2);
    });

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
