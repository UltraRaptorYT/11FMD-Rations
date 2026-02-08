import { NextResponse } from "next/server";
import { google } from "googleapis";

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
const SHEET_NAME = process.env.NAMELIST_SHEET_NAME!;

// ---- Simple in-memory TTL cache (per server instance) ----
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<any>>();

function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCache<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

const TTL_MS = 60_000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceReload = url.searchParams.get("reload") === "true"; // ?reload=true

  const cacheKey = `${SHEET_ID}:${SHEET_NAME}:A2:A`;

  try {
    if (!forceReload) {
      const cached = getCache<string[][]>(cacheKey);
      if (cached) {
        return NextResponse.json(
          { source: "cache", rows: cached },
          { status: 200 },
        );
      }
    }

    // If reload=true OR no cache hit -> call API
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A2:A`,
    });

    const rows = (res.data.values || []) as string[][];

    // refresh cache even on forced reload
    setCache(cacheKey, rows, TTL_MS);

    return NextResponse.json(
      { source: forceReload ? "api_forced" : "api", rows },
      { status: 200 },
    );
  } catch (err) {
    console.error("GET RSVP Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch RSVP" },
      { status: 500 },
    );
  }
}
