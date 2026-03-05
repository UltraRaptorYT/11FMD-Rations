import { NextResponse } from "next/server";
import { google } from "googleapis";
import { fromISO, toISO, startOfWeekMonday, getMonFri } from "@/lib/utils";

// Auth setup
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

const SHEET_ID = process.env.RATION_SHEET_ID!;
const BOOKINGS_SHEET_NAME = process.env.RATIONS_SHEET_NAME!;

const WRITE_COLS_START = "C";
const WRITE_COLS_END = "L";

function toBool01(v: any) {
  if (v === 1 || v === "1" || v === true || v === "TRUE") return true;
  return false;
}

type DayBooking = {
  name: string;
  rationType: string;
  meals: { B: boolean; L: boolean; D: boolean };
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const weekStartParam = (url.searchParams.get("weekStart") ?? "").trim();

    if (!weekStartParam) {
      return NextResponse.json({ error: "Missing weekStart" }, { status: 400 });
    }

    const weekStart = toISO(startOfWeekMonday(fromISO(weekStartParam)));
    const monFri = getMonFri(weekStart);

    // Initialize empty days
    const days: Record<string, DayBooking[]> = {};
    for (const date of monFri) {
      days[date] = [];
    }

    // Read sheet — same column layout as getAllRations
    // C week_start, D date, E name, F ration_type, G B, H L, I D, J status, K submitted_at, L updated_at
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${BOOKINGS_SHEET_NAME}!${WRITE_COLS_START}2:${WRITE_COLS_END}`,
    });

    const rows = (res.data.values ?? []) as any[][];

    for (const r of rows) {
      const rowWeekStart = (r?.[0] ?? "").toString().trim(); // C
      const rowDate = (r?.[1] ?? "").toString().trim(); // D
      const rowName = (r?.[2] ?? "").toString().trim(); // E
      const rowRationType = (r?.[3] ?? "").toString().trim(); // F
      const b = r?.[4]; // G
      const l = r?.[5]; // H
      const d = r?.[6]; // I
      const status = (r?.[7] ?? "").toString().trim().toUpperCase(); // J

      if (!rowWeekStart || !rowDate || !rowName) continue;
      if (rowWeekStart !== weekStart) continue;
      if (!days[rowDate]) continue; // not Mon–Fri of this week

      const isActive = status ? status !== "CANCELLED" : true;
      if (!isActive) continue;

      const Bsel = toBool01(b);
      const Lsel = toBool01(l);
      const Dsel = toBool01(d);

      // Only include if at least one meal is booked
      if (!Bsel && !Lsel && !Dsel) continue;

      days[rowDate].push({
        name: rowName,
        rationType: rowRationType,
        meals: { B: Bsel, L: Lsel, D: Dsel },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        weekStart,
        days,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("GET getAdminRations Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch admin rations" },
      { status: 500 },
    );
  }
}
