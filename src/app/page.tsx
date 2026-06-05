import HomeClient from "@/app/HomeClient";
import { getBaseUrl } from "@/lib/get-base-url";

async function getUsers(reload?: boolean) {
  const baseUrl = getBaseUrl() ?? "http://localhost:3000";
  const url = new URL("/api/getUsers", baseUrl);
  if (reload) url.searchParams.set("reload", "true");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return [];

  const data = (await res.json()) as { items?: string[]; rows?: string[][] };
  return data.items ?? data.rows?.map((r) => r[0]).filter(Boolean) ?? [];
}

async function getBookingWeeks() {
  const baseUrl = getBaseUrl() ?? "http://localhost:3000";
  const url = new URL("/api/getBookingWeeks", baseUrl);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    return {
      fallbackMinBookableWeekStart: null,
      weeks: [],
    };
  }

  const data = await res.json();
  return {
    fallbackMinBookableWeekStart:
      data?.fallbackMinBookableWeekStart ?? null,
    weeks: data?.weeks ?? [],
  };
}

async function getPublicHolidays() {
  const baseUrl = getBaseUrl() ?? "http://localhost:3000";
  const url = new URL("/api/getPublicHolidays", baseUrl);

  const res = await fetch(url.toString(), { cache: "no-store" }).catch(
    () => null,
  );
  if (!res?.ok) return [];

  const data = (await res.json()) as {
    holidays?: { date: string; holiday: string }[];
  };
  return data.holidays ?? [];
}

export default async function Page({
  searchParams,
}: {
  searchParams: { reload?: string };
}) {
  const reload = searchParams?.reload === "true";

  const [items, bookingWeeksData, publicHolidays] = await Promise.all([
    getUsers(reload),
    getBookingWeeks(),
    getPublicHolidays(),
  ]);

  return (
    <div className="w-full max-w-md mx-auto p-6">
      <HomeClient
        namelist={items}
        initialBookingWeeksData={bookingWeeksData}
        publicHolidays={publicHolidays}
      />
    </div>
  );
}
