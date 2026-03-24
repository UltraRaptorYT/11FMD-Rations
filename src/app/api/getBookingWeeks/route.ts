import { NextResponse } from "next/server";
import { google } from "googleapis";
import { fromISO, toISO, startOfWeekMonday, startOfDayLocal } from "@/lib/utils";

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

function addDaysLocal(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function getFallbackMinBookableWeekStartISO() {
  const lead = addDaysLocal(
    startOfDayLocal(),
    Number(process.env.NEXT_PUBLIC_LEAD_TIME) * 7 + 4,
  );
  return toISO(startOfWeekMonday(lead));
}

function toBool(v: unknown): boolean | null {
  if (v === true || v === "TRUE" || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "FALSE" || v === "false" || v === 0 || v === "0") return false;
  return null;
}

function toOverride(v: unknown): "LOCK" | "UNLOCK" | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "LOCK" || s === "UNLOCK") return s;
  return null;
}

export async function GET() {
  try {
    const fallbackMinBookableWeekStart = getFallbackMinBookableWeekStartISO();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${BOOKING_WEEKS_SHEET_NAME}!A2:D`,
    });

    const rows = (res.data.values ?? []) as unknown[][];

    const weeks = rows
      .map((r) => {
        const rawWeekStart = String(r?.[0] ?? "").trim();
        if (!rawWeekStart) return null;

        const weekStart = toISO(startOfWeekMonday(fromISO(rawWeekStart)));
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
        };
      })
      .filter(Boolean);

    return NextResponse.json(
      {
        ok: true,
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
