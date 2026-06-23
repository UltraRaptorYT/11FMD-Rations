import { NextResponse } from "next/server";
import { requireApiSecret } from "@/lib/require-api-secret";

const PUBLIC_HOLIDAYS_DATASET_ID =
  process.env.PUBLIC_HOLIDAYS_DATASET_ID ??
  "d_8ef23381f9417e4d4254ee8b4dcdb176";

const DATA_GOV_SEARCH_URL = "https://data.gov.sg/api/action/datastore_search";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type PublicHoliday = {
  date: string;
  day: string;
  holiday: string;
};

type CacheEntry = {
  value: PublicHoliday[];
  expiresAt: number;
};

let cache: CacheEntry | null = null;

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function fetchPublicHolidays() {
  const url = new URL(DATA_GOV_SEARCH_URL);
  url.searchParams.set("resource_id", PUBLIC_HOLIDAYS_DATASET_ID);
  url.searchParams.set("limit", "500");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`data.gov.sg returned ${res.status}`);
  }

  const data = (await res.json()) as {
    success?: boolean;
    result?: { records?: unknown[] };
  };

  if (!data.success || !Array.isArray(data.result?.records)) {
    throw new Error("Unexpected data.gov.sg public holidays response");
  }

  return data.result.records
    .map((record) => {
      const row = record as Record<string, unknown>;
      const date = clean(row.date);
      const holiday = clean(row.holiday);
      const day = clean(row.day);

      if (!isISODate(date) || !holiday) return null;
      return { date, day, holiday };
    })
    .filter((row): row is PublicHoliday => row !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function GET(request: Request) {
  const unauthorized = requireApiSecret(request);
  if (unauthorized) return unauthorized;

  try {
    if (cache && Date.now() < cache.expiresAt) {
      return NextResponse.json({
        ok: true,
        source: "cache",
        holidays: cache.value,
      });
    }

    const holidays = await fetchPublicHolidays();
    cache = { value: holidays, expiresAt: Date.now() + CACHE_TTL_MS };

    return NextResponse.json({
      ok: true,
      source: "data.gov.sg",
      datasetId: PUBLIC_HOLIDAYS_DATASET_ID,
      holidays,
    });
  } catch (err) {
    console.error("GET getPublicHolidays Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch public holidays", holidays: [] },
      { status: 500 },
    );
  }
}
