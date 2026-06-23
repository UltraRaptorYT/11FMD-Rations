import { NextResponse } from "next/server";
import { google } from "googleapis";
import { fromISO, getMonFri, startOfWeekMonday, toISO } from "@/lib/utils";
import { requireApiSecret } from "@/lib/require-api-secret";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

const SHEET_ID = process.env.RATION_SHEET_ID!;
const NAMELIST_SHEET_NAME = process.env.NAMELIST_SHEET_NAME!;
const RATIONS_SHEET_NAME = process.env.RATIONS_SHEET_NAME!;

function isISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = fromISO(value);
  return !Number.isNaN(parsed.getTime()) && toISO(parsed) === value;
}

export async function GET(request: Request) {
  const unauthorized = requireApiSecret(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const date = (url.searchParams.get("date") ?? "").trim();

    if (!date) {
      return NextResponse.json(
        {
          error: "Missing date",
          example: "/api/getNotSubmitted?date=2026-06-22",
        },
        { status: 400 },
      );
    }

    if (!isISODate(date)) {
      return NextResponse.json(
        { error: "Invalid date. Use YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const weekStart = toISO(startOfWeekMonday(fromISO(date)));
    const weekDates = getMonFri(weekStart);

    const [namesResponse, rationsResponse] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        // A name, B platoon, C rank
        range: `${NAMELIST_SHEET_NAME}!A2:C`,
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        // C week_start, D date, E name, F ration_type, G/H/I meals, J status
        range: `${RATIONS_SHEET_NAME}!C2:J`,
      }),
    ]);

    const names = [
      ...new Set(
        (namesResponse.data.values ?? [])
          .filter((row) =>
            !String(row?.[2] ?? "").trim().toUpperCase().includes("ME"),
          )
          .map((row) => String(row?.[0] ?? "").trim())
          .filter(Boolean),
      ),
    ];

    const submittedNameKeys = new Set<string>();

    for (const row of rationsResponse.data.values ?? []) {
      const rowWeekStart = String(row?.[0] ?? "").trim();
      const name = String(row?.[2] ?? "").trim();

      if (rowWeekStart === weekStart && name) {
        submittedNameKeys.add(name.toLocaleLowerCase());
      }
    }

    const notSubmitted = names.filter(
      (name) => !submittedNameKeys.has(name.toLocaleLowerCase()),
    );

    return NextResponse.json(
      {
        ok: true,
        queriedDate: date,
        weekStart,
        weekEnd: weekDates[weekDates.length - 1],
        count: notSubmitted.length,
        notSubmitted,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("GET getNotSubmitted Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch people who have not submitted" },
      { status: 500 },
    );
  }
}
