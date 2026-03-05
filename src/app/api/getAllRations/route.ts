import { NextResponse } from "next/server";
import { google } from "googleapis";
import { fromISO, toISO, startOfWeekMonday, getMonFri } from "@/lib/utils";
import type { Meal, DayPlan, WeekPlan } from "@/types";

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
const BOOKINGS_SHEET_NAME = process.env.RATIONS_SHEET_NAME!;

const WRITE_COLS_START = "C";
const WRITE_COLS_END = "L";

function toBool01(v: any) {
  if (v === 1 || v === "1" || v === true || v === "TRUE") return true;
  return false;
}

type WeekEntry = {
  rationType: string | null;
  plan: WeekPlan;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }

    // Read C..L (skip A,B formula column)
    // C week_start, D date, E name, F ration_type, G B, H L, I D, J status, K submitted_at, L updated_at
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${BOOKINGS_SHEET_NAME}!${WRITE_COLS_START}2:${WRITE_COLS_END}`,
    });

    const rows = (res.data.values ?? []) as any[][];

    // Group by weekStart
    const weeksMap = new Map<string, WeekEntry>();

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
      if (rowName !== name) continue;

      // Normalize week start
      const weekStart = toISO(startOfWeekMonday(fromISO(rowWeekStart)));

      // Get or create week entry
      if (!weeksMap.has(weekStart)) {
        const days: Record<string, DayPlan> = {};
        for (const date of getMonFri(weekStart)) {
          days[date] = {
            enabled: false,
            meals: { B: false, L: false, D: false },
          };
        }
        weeksMap.set(weekStart, {
          rationType: null,
          plan: { weekStart, days },
        });
      }

      const entry = weeksMap.get(weekStart)!;

      // Only process Mon–Fri dates belonging to this week
      if (!entry.plan.days[rowDate]) continue;

      const isActive = status ? status !== "CANCELLED" : true;

      const Bsel = isActive && toBool01(b);
      const Lsel = isActive && toBool01(l);
      const Dsel = isActive && toBool01(d);

      entry.plan.days[rowDate] = {
        enabled: Bsel || Lsel || Dsel,
        meals: { B: Bsel, L: Lsel, D: Dsel },
      };

      if (rowRationType) entry.rationType = rowRationType;
    }

    // Convert map to a plain object keyed by weekStart
    const weeks: Record<string, WeekEntry> = {};
    for (const [ws, entry] of weeksMap) {
      weeks[ws] = entry;
    }

    return NextResponse.json(
      {
        ok: true,
        name,
        weeks,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("GET getAllRations Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch rations" },
      { status: 500 },
    );
  }
}
