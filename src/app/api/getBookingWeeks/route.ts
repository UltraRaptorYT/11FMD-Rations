import { NextResponse } from "next/server";
import { google } from "googleapis";
import { fromISO, toISO, startOfDayLocal, startOfWeekMonday } from "@/lib/utils";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const SHEET_ID = process.env.RATION_SHEET_ID!;
const BOOKING_WEEKS_SHEET_NAME = process.env.BOOKING_WEEKS_SHEET_NAME!;
const CONFIG_SHEET_NAME = process.env.CONFIG_SHEET_NAME || "CONFIG";

type BookingWeekStatus = {
  weekStart: string;
  autoLocked: boolean | null;
  adminOverride: "LOCK" | "UNLOCK" | null;
  finalLocked: boolean;
  source: "booking_weeks" | "fallback_env";
};

function addDaysLocal(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function getFallbackMinBookableWeekStartISO(leadTimeWeeks: number) {
  const lead = addDaysLocal(startOfDayLocal(), leadTimeWeeks * 7 + 4);
  return toISO(startOfWeekMonday(lead));
}

function toBool(v: unknown): boolean | null {
  if (
    v === true ||
    v === "TRUE" ||
    v === "true" ||
    v === 1 ||
    v === "1"
  ) {
    return true;
  }
  if (
    v === false ||
    v === "FALSE" ||
    v === "false" ||
    v === 0 ||
    v === "0"
  ) {
    return false;
  }
  return null;
}

function toOverride(v: unknown): "LOCK" | "UNLOCK" | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "LOCK" || s === "UNLOCK") return s;
  return null;
}

function parseSheetDate(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;

  // ISO format: 2026-01-05
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    try {
      return fromISO(raw);
    } catch {
      return null;
    }
  }

  // Fallback for sheet display strings like 5-Jan-2026
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  return null;
}

function getConfigValue(rows: unknown[][], key: string): string | null {
  for (const row of rows) {
    const k = String(row?.[0] ?? "").trim();
    const v = String(row?.[1] ?? "").trim();
    if (k === key) return v;
  }
  return null;
}

export async function GET() {
  try {
    // 1) Read config
    const configRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${CONFIG_SHEET_NAME}!A2:B`,
    });

    const configRows = (configRes.data.values ?? []) as unknown[][];
    const leadTimeWeeks =
      Number(getConfigValue(configRows, "lead_time_weeks")) ||
      Number(process.env.NEXT_PUBLIC_LEAD_TIME) ||
      3;

    const fallbackMinBookableWeekStart =
      getFallbackMinBookableWeekStartISO(leadTimeWeeks);

    // 2) Read booking weeks
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${BOOKING_WEEKS_SHEET_NAME}!A2:D`,
    });

    const rows = (res.data.values ?? []) as unknown[][];

    const weeks: BookingWeekStatus[] = rows
      .map((r) => {
        const rawWeekStart = String(r?.[0] ?? "").trim();
        if (!rawWeekStart) return null;

        const parsedWeekStart = parseSheetDate(rawWeekStart);
        if (!parsedWeekStart) return null;

        const weekStart = toISO(startOfWeekMonday(parsedWeekStart));
        const autoLocked = toBool(r?.[1]);
        const adminOverride = toOverride(r?.[2]);
        const finalLockedRaw = toBool(r?.[3]);

        const fallbackLocked = weekStart < fallbackMinBookableWeekStart;

        return {
          weekStart,
          autoLocked,
          adminOverride,
          finalLocked: finalLockedRaw ?? fallbackLocked,
          source: finalLockedRaw === null ? "fallback_env" : "booking_weeks",
        } as BookingWeekStatus;
      })
      .filter((w): w is BookingWeekStatus => w !== null);

    return NextResponse.json(
      {
        ok: true,
        leadTimeWeeks,
        fallbackMinBookableWeekStart,
        weeks,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("GET getBookingWeeks Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch booking weeks" },
      { status: 500 },
    );
  }
}
