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

// local ISO helpers (avoid UTC drift)
function normalizeWeekStartISO(weekStartISO: string) {
  return toISO(startOfWeekMonday(fromISO(weekStartISO)));
}

function buildEmptyWeek(weekStartISO: string): WeekPlan {
  const weekStart = normalizeWeekStartISO(weekStartISO);
  const days: Record<string, DayPlan> = {};
  for (const date of getMonFri(weekStart)) {
    days[date] = { enabled: false, meals: { B: false, L: false, D: false } };
  }
  return { weekStart, days };
}

function toBool01(v: any) {
  // sheet might store "1"/"0", 1/0, TRUE/FALSE, etc.
  if (v === 1 || v === "1" || v === true || v === "TRUE") return true;
  return false;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") ?? "").trim();
    const weekStartParam = (url.searchParams.get("weekStart") ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }
    if (!weekStartParam) {
      return NextResponse.json({ error: "Missing weekStart" }, { status: 400 });
    }

    const weekStart = normalizeWeekStartISO(weekStartParam);
    const plan = buildEmptyWeek(weekStart);

    // Read B..K (skip A formula column)
    // B week_start, C date, D name, E ration_type, F B, G L, H D, I status, J submitted_at, K updated_at
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${BOOKINGS_SHEET_NAME}!B2:K`,
    });

    const rows = (res.data.values ?? []) as any[][];

    let rationType: string | null = null;

    for (const r of rows) {
      const rowWeekStart = (r?.[0] ?? "").toString().trim(); // B
      const rowDate = (r?.[1] ?? "").toString().trim(); // C
      const rowName = (r?.[2] ?? "").toString().trim(); // D
      const rowRationType = (r?.[3] ?? "").toString().trim(); // E
      const b = r?.[4]; // F
      const l = r?.[5]; // G
      const d = r?.[6]; // H
      const status = (r?.[7] ?? "").toString().trim().toUpperCase(); // I

      if (!rowWeekStart || !rowDate || !rowName) continue;
      if (rowWeekStart !== weekStart) continue;
      if (rowName !== name) continue;

      // only Mon–Fri of this week
      if (!plan.days[rowDate]) continue;

      const isActive = status ? status !== "CANCELLED" : true;

      const Bsel = isActive && toBool01(b);
      const Lsel = isActive && toBool01(l);
      const Dsel = isActive && toBool01(d);

      plan.days[rowDate] = {
        enabled: Bsel || Lsel || Dsel,
        meals: { B: Bsel, L: Lsel, D: Dsel },
      };

      if (rowRationType) rationType = rowRationType;
    }

    return NextResponse.json(
      {
        ok: true,
        name,
        weekStart,
        rationType,
        plan,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("GET getRation Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch rations" },
      { status: 500 },
    );
  }
}
