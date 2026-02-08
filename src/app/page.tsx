import HomeClient from "./HomeClient";

async function getFrameworks(reload?: boolean) {
  // Use an absolute URL on the server. Prefer an env like NEXT_PUBLIC_BASE_URL in prod.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const url = new URL("/api/getUsers", baseUrl);
  if (reload) url.searchParams.set("reload", "true");

  // If you're already caching inside the route handler, you can disable Next fetch caching.
  const res = await fetch(url.toString(), { cache: "no-store" });

  if (!res.ok) return [];

  const data = (await res.json()) as { items?: string[]; rows?: string[][] };

  // pick one
  return data.items ?? data.rows?.map((r) => r[0]).filter(Boolean) ?? [];
}

export default async function Page({
  searchParams,
}: {
  searchParams: { reload?: string };
}) {
  const reload = searchParams?.reload === "true";
  const items = await getFrameworks(reload);

  return (
    <div className="w-full max-w-md mx-auto p-6">
      <HomeClient namelist={items} />
    </div>
  );
}
