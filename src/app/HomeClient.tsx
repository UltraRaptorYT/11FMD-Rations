"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useEffect, useState, useMemo, useCallback, JSX } from "react";
import type { Meal, RationType, DayPlan, WeekPlan } from "@/types";
import {
  fromISO,
  toISO,
  startOfDayLocal,
  startOfWeekMonday,
} from "@/lib/utils";
import Pill from "@/components/Pill";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE || "none";
const EDIT_MODE = process.env.NEXT_PUBLIC_EDIT_MODE || "self_only"; // FIX #3
const CAN_EDIT_ANY = EDIT_MODE === "edit_any";
const TRACK_EDITED_BY = AUTH_MODE !== "none" && CAN_EDIT_ANY;

const MEALS: { key: Meal; label: string }[] = [
  { key: "B", label: "Breakfast" },
  { key: "L", label: "Lunch" },
  { key: "D", label: "Dinner" },
];

const RATION_OPTIONS: { value: RationType; label: string; color: string }[] = [
  { value: "nm", label: "Non-Muslim", color: "#6366f1" },
  { value: "m", label: "Muslim", color: "#10b981" },
  { value: "nmsd", label: "NM Special Diet", color: "#f59e0b" },
  { value: "vi", label: "Veg Indian", color: "#ef4444" },
  { value: "vc", label: "Veg Chinese", color: "#ec4899" },
];

// ---------- LOCAL date helpers (no UTC drift) ----------
function addDaysLocal(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function nextWeekStartISO(weekStartISO: string, deltaWeeks: number) {
  const base = fromISO(weekStartISO);
  const moved = addDaysLocal(base, deltaWeeks * 7);
  return toISO(startOfWeekMonday(moved));
}

function buildDefaultWeek(weekStartISO: string): WeekPlan {
  const normalizedWeekStartISO = toISO(
    startOfWeekMonday(fromISO(weekStartISO)),
  );
  const weekStart = fromISO(normalizedWeekStartISO);

  const days: Record<string, DayPlan> = {};
  for (let i = 0; i < 5; i++) {
    const iso = toISO(addDaysLocal(weekStart, i));
    days[iso] = { enabled: false, meals: { B: false, L: false, D: false } };
  }
  return { weekStart: normalizedWeekStartISO, days };
}

function isPastDateLocked(dateISO: string) {
  const today = startOfDayLocal();
  const d = fromISO(dateISO);
  return d < today;
}

function getMinBookableWeekStartISO() {
  const lead = addDaysLocal(
    startOfDayLocal(),
    Number(process.env.NEXT_PUBLIC_LEAD_TIME) * 7 + 4,
  );
  return toISO(startOfWeekMonday(lead));
}

function normalizeOrRebuildDraft(
  raw: string | null,
  weekStartISO: string,
): WeekPlan {
  const expected = buildDefaultWeek(weekStartISO);
  const expectedKeys = Object.keys(expected.days).sort();

  if (!raw) return expected;

  try {
    const parsed = JSON.parse(raw) as Partial<WeekPlan> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.days) return expected;

    const parsedKeys = Object.keys(parsed.days).sort();
    if (parsedKeys.join("|") !== expectedKeys.join("|")) return expected;

    return {
      weekStart: expected.weekStart,
      days: parsed.days as WeekPlan["days"],
    };
  } catch {
    return expected;
  }
}

type WeeklyRationPlannerProps = {
  namelist: string[];
};

// ─── Monthly Overview (unchanged) ────────────────────────────
type MonthlyOverviewProps = {
  serverCache: Record<string, { rationType: string | null; plan: WeekPlan }>;
  name: string;
};

type MonthlyBooking = {
  iso: string;
  enabled: boolean;
  meals: { B: boolean; L: boolean; D: boolean };
};

function MonthlyOverview({ serverCache, name }: MonthlyOverviewProps) {
  const today = startOfDayLocal();
  const [monthOffset, setMonthOffset] = useState(0);

  const viewDate = new Date(
    today.getFullYear(),
    today.getMonth() + monthOffset,
    1,
  );
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const monthLabel = viewDate.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  const monthBookings = useMemo(() => {
    const result: Record<number, MonthlyBooking> = {};
    for (const entry of Object.values(serverCache)) {
      if (!entry.plan?.days) continue;
      for (const [dateISO, dayPlan] of Object.entries(entry.plan.days)) {
        const d = fromISO(dateISO);
        if (d.getFullYear() !== viewYear || d.getMonth() !== viewMonth)
          continue;
        if (dayPlan.enabled) {
          result[d.getDate()] = {
            iso: dateISO,
            enabled: dayPlan.enabled,
            meals: { ...dayPlan.meals },
          };
        }
      }
    }
    return result;
  }, [serverCache, viewYear, viewMonth]);

  const stats = useMemo(() => {
    let b = 0,
      l = 0,
      d = 0;
    for (const booking of Object.values(monthBookings)) {
      if (booking.meals.B) b++;
      if (booking.meals.L) l++;
      if (booking.meals.D) d++;
    }
    return {
      days: Object.keys(monthBookings).length,
      B: b,
      L: l,
      D: d,
      total: b + l + d,
    };
  }, [monthBookings]);

  const weekdayGrid = useMemo(() => {
    const weeks: { dayNum: number; date: Date }[][] = [];
    let currentWeek: { dayNum: number; date: Date }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewYear, viewMonth, d);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue;
      if (dow === 1 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push({ dayNum: d, date });
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);
    return weeks;
  }, [viewYear, viewMonth, daysInMonth]);

  const dayHeaders = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  if (!name.trim()) {
    return (
      <p className="text-sm text-muted-foreground">
        Select your name to view bookings.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          className="px-3"
          onClick={() => setMonthOffset((p) => p - 1)}
        >
          ←
        </Button>
        <span className="text-lg font-bold text-white">{monthLabel}</span>
        <Button
          variant="outline"
          className="px-3"
          onClick={() => setMonthOffset((p) => p + 1)}
        >
          →
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Days", value: stats.days, color: "#c8a97e" },
          { label: "Breakfast", value: stats.B, color: "#6366f1" },
          { label: "Lunch", value: stats.L, color: "#10b981" },
          { label: "Dinner", value: stats.D, color: "#f59e0b" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl p-3 text-center"
            style={{ backgroundColor: "#161616", border: "1px solid #222" }}
          >
            <div className="text-2xl font-bold" style={{ color: stat.color }}>
              {stat.value}
            </div>
            <div
              className="text-[10px] font-semibold tracking-wider uppercase"
              style={{ color: "#666" }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      <div
        className="rounded-2xl p-4"
        style={{ backgroundColor: "#131313", border: "1px solid #222" }}
      >
        <div className="grid grid-cols-5 gap-1 mb-2">
          {dayHeaders.map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-bold tracking-wider uppercase py-1"
              style={{ color: "#555" }}
            >
              {d}
            </div>
          ))}
        </div>
        {weekdayGrid.map((week, wi) => {
          const padBefore = week[0].date.getDay() - 1;
          const padAfter = 5 - week[week.length - 1].date.getDay();
          return (
            <div key={wi} className="grid grid-cols-5 gap-1">
              {Array.from({ length: padBefore }).map((_, i) => (
                <div key={`pb-${wi}-${i}`} />
              ))}
              {week.map(({ dayNum, date }) => {
                const booking = monthBookings[dayNum];
                const isToday = toISO(date) === toISO(today);
                const mealCount = booking
                  ? [booking.meals.B, booking.meals.L, booking.meals.D].filter(
                      Boolean,
                    ).length
                  : 0;
                return (
                  <div
                    key={dayNum}
                    className="relative flex flex-col items-center justify-center rounded-lg py-2 transition-all"
                    style={{
                      backgroundColor: booking ? "#1a1812" : "transparent",
                      border: isToday
                        ? "1px solid #c8a97e"
                        : booking
                          ? "1px solid #2a2518"
                          : "1px solid transparent",
                      minHeight: "52px",
                    }}
                  >
                    <span
                      className={`text-sm font-medium ${booking ? "text-white" : "text-neutral-600"}`}
                    >
                      {dayNum}
                    </span>
                    {booking && mealCount > 0 && (
                      <div className="flex gap-0.5 mt-1">
                        {Array.from({ length: mealCount }).map((_, j) => (
                          <div
                            key={j}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: "#c8a97e" }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {Array.from({ length: padAfter }).map((_, i) => (
                <div key={`pa-${wi}-${i}`} />
              ))}
            </div>
          );
        })}
      </div>

      <div
        className="flex items-center justify-center gap-6 text-xs"
        style={{ color: "#666" }}
      >
        <span className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "#c8a97e" }}
          />
          Ration booked
        </span>
        <span className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "#333" }}
          />
          No ration
        </span>
      </div>

      <div className="space-y-1.5">
        {Object.keys(monthBookings).length === 0 ? (
          <div
            className="rounded-xl p-4 text-center"
            style={{ backgroundColor: "#131313", border: "1px solid #1e1e1e" }}
          >
            <p className="text-sm" style={{ color: "#666" }}>
              No rations booked for {monthLabel}
            </p>
          </div>
        ) : (
          Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const date = new Date(viewYear, viewMonth, dayNum);
            if (date.getDay() === 0 || date.getDay() === 6) return null;
            const booking = monthBookings[dayNum];
            if (!booking) return null;
            return (
              <div
                key={dayNum}
                className="flex items-center justify-between rounded-lg px-4 py-2.5"
                style={{
                  backgroundColor: "#161616",
                  border: "1px solid #1e1e1e",
                }}
              >
                <span className="text-sm font-medium text-white">
                  {date.toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <div className="flex gap-1.5">
                  {MEALS.map((m) => (
                    <span
                      key={m.key}
                      className="px-2 py-0.5 rounded text-[10px] font-bold"
                      style={
                        booking.meals[m.key]
                          ? { backgroundColor: "#c8a97e22", color: "#c8a97e" }
                          : { backgroundColor: "transparent", color: "#333" }
                      }
                    >
                      {m.key}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Admin View ──────────────────────────────────────────────
type AdminBooking = {
  name: string;
  rationType: string;
  meals: { B: boolean; L: boolean; D: boolean };
  status: "active" | "cancelled";
};

type AdminDayData = {
  iso: string;
  label: string;
  bookings: AdminBooking[];
  total: number;
  B: number;
  L: number;
  D: number;
};

// FIX #1 + #2: Admin with Not Indented + date picker
function AdminView({ namelist }: { namelist: string[] }) {
  const today = startOfDayLocal();
  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [selectedDate, setSelectedDate] = useState(toISO(today));
  const [adminData, setAdminData] = useState<Record<string, AdminBooking[]>>(
    {},
  );
  const [submittedNames, setSubmittedNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const selectedWeekStart = useMemo(
    () => toISO(startOfWeekMonday(fromISO(selectedDate))),
    [selectedDate],
  );

  useEffect(() => {
    let cancelled = false;
    async function fetchAdmin() {
      setIsLoading(true);
      try {
        const qs = new URLSearchParams({ weekStart: selectedWeekStart });
        const res = await fetch(`/api/getAdminRations?${qs.toString()}`);
        if (!res.ok) {
          console.error(`[AdminView] getAdminRations returned ${res.status}`);
          return;
        }
        const data = await res.json();
        if (!cancelled && data?.days) {
          setAdminData(data.days);
          setSubmittedNames(data.submittedNames ?? []);
        }
      } catch (e) {
        console.error("[AdminView] fetch error:", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchAdmin();
    return () => {
      cancelled = true;
    };
  }, [selectedWeekStart]);

  const navigateDate = (delta: number) => {
    const unit = viewMode === "day" ? 1 : 7;
    const d = fromISO(selectedDate);
    const next = addDaysLocal(d, delta * unit);
    if (viewMode === "day") {
      const dow = next.getDay();
      if (dow === 0) next.setDate(next.getDate() + (delta > 0 ? 1 : -2));
      if (dow === 6) next.setDate(next.getDate() + (delta > 0 ? 2 : -1));
    }
    setSelectedDate(toISO(next));
  };

  // Calendar date selection
  const handleCalendarSelect = (iso: string) => {
    if (viewMode === "day") {
      const d = fromISO(iso);
      const dow = d.getDay();
      if (dow === 0) d.setDate(d.getDate() + 1);
      if (dow === 6) d.setDate(d.getDate() + 2);
      setSelectedDate(toISO(d));
    } else {
      setSelectedDate(toISO(startOfWeekMonday(fromISO(iso))));
    }
    setCalendarOpen(false);
  };

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = fromISO(selectedDate);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Sync calendar month when selectedDate changes externally
  useEffect(() => {
    const d = fromISO(selectedDate);
    setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() });
  }, [selectedDate]);

  const dayStats = useMemo(() => {
    const allBookings = adminData[selectedDate] || [];
    const active = allBookings.filter((b) => b.status === "active");
    const cancelled = allBookings.filter((b) => b.status === "cancelled");
    const byType: Record<
      string,
      { count: number; B: number; L: number; D: number }
    > = {};
    for (const o of RATION_OPTIONS) {
      byType[o.value] = { count: 0, B: 0, L: 0, D: 0 };
    }
    for (const b of active) {
      if (!byType[b.rationType])
        byType[b.rationType] = { count: 0, B: 0, L: 0, D: 0 };
      byType[b.rationType].count++;
      if (b.meals.B) byType[b.rationType].B++;
      if (b.meals.L) byType[b.rationType].L++;
      if (b.meals.D) byType[b.rationType].D++;
    }
    return { total: active.length, byType, active, cancelled };
  }, [adminData, selectedDate]);

  // FIX #1: Three groups — not submitted, not indented, names present in day
  const dayNameSets = useMemo(() => {
    const allBookings = adminData[selectedDate] || [];
    const activeNames = new Set(
      allBookings.filter((b) => b.status === "active").map((b) => b.name),
    );
    const cancelledNames = new Set(
      allBookings.filter((b) => b.status === "cancelled").map((b) => b.name),
    );
    const submittedSet = new Set(submittedNames);

    // Not Indented = submitted the planner but has no booking (active or cancelled) for THIS day
    // Not Submitted = never touched the planner for this week
    const notSubmitted = namelist.filter((n) => !submittedSet.has(n));

    return { notSubmitted };
  }, [adminData, selectedDate, submittedNames, namelist]);

  type CopyTarget = "submitted" | "notSubmitted" | "cancelled";
  const [copiedList, setCopiedList] = useState<CopyTarget | null>(null);

  useEffect(() => {
    setCopiedList(null);
  }, [selectedDate]);

  const copyNames = async (names: string[], which: CopyTarget) => {
    try {
      await navigator.clipboard.writeText(names.join("\n"));
      setCopiedList(which);
      setTimeout(() => setCopiedList(null), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const weekDays = useMemo((): AdminDayData[] => {
    const ws = fromISO(selectedWeekStart);
    const result: AdminDayData[] = [];
    for (let i = 0; i < 5; i++) {
      const iso = toISO(addDaysLocal(ws, i));
      const allBookings = adminData[iso] || [];
      const active = allBookings.filter((b) => b.status === "active");
      result.push({
        iso,
        label: fromISO(iso).toLocaleDateString("en-GB", { weekday: "short" }),
        bookings: active,
        total: active.length,
        B: active.filter((b) => b.meals.B).length,
        L: active.filter((b) => b.meals.L).length,
        D: active.filter((b) => b.meals.D).length,
      });
    }
    return result;
  }, [adminData, selectedWeekStart]);

  const weekTotals = useMemo(() => {
    return weekDays.reduce(
      (acc, d) => ({
        total: acc.total + d.total,
        B: acc.B + d.B,
        L: acc.L + d.L,
        D: acc.D + d.D,
      }),
      { total: 0, B: 0, L: 0, D: 0 },
    );
  }, [weekDays]);

  const maxBar =
    viewMode === "week"
      ? Math.max(...weekDays.map((d) => d.total), 1)
      : Math.max(...Object.values(dayStats.byType).map((t) => t.count), 1);

  // Quick lookup for namelist membership (for NEW badge)
  const namelistSet = useMemo(() => new Set(namelist), [namelist]);

  const dateLabel =
    viewMode === "day"
      ? fromISO(selectedDate).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : `Week of ${fromISO(selectedWeekStart).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  // Helper to render a name list section
  const renderNameList = (
    title: string,
    names: string[] | AdminBooking[],
    badgeBg: string,
    badgeColor: string,
    dotColor: string,
    copyKey: CopyTarget,
    emptyText: string,
    emptyColor: string,
    showMeals?: boolean,
  ) => {
    const nameArr = showMeals
      ? (names as AdminBooking[]).map((b) => b.name)
      : (names as string[]);
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between px-1 mb-2">
          <div className="flex items-center gap-2">
            <div
              className="text-xs font-semibold tracking-wider uppercase"
              style={{ color: "#666" }}
            >
              {title}
            </div>
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: badgeBg, color: badgeColor }}
            >
              {nameArr.length}
            </span>
          </div>
          {nameArr.length > 0 && (
            <Button
              variant="outline"
              className="text-[10px] h-7 px-2.5"
              style={{
                border: "1px solid #2a2a2a",
                color: copiedList === copyKey ? "#4ade80" : "#999",
              }}
              onClick={() => copyNames(nameArr, copyKey)}
            >
              {copiedList === copyKey ? "Copied!" : "Copy names"}
            </Button>
          )}
        </div>
        {nameArr.length === 0 ? (
          <div
            className="rounded-lg px-4 py-3 text-center"
            style={{ backgroundColor: "#131313", border: "1px solid #1a1a1a" }}
          >
            <span className="text-xs" style={{ color: emptyColor }}>
              {emptyText}
            </span>
          </div>
        ) : showMeals ? (
          (names as AdminBooking[]).map((b, i) => {
            const rt = RATION_OPTIONS.find((o) => o.value === b.rationType);
            const isUnknown = !namelistSet.has(b.name);
            return (
              <div
                key={`${b.name}-${i}`}
                className="flex items-center justify-between rounded-lg px-4 py-2.5"
                style={{
                  backgroundColor: "#131313",
                  border: isUnknown
                    ? "1px solid #7c3aed33"
                    : "1px solid #1a1a1a",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: rt?.color || dotColor }}
                  />
                  <span className="text-xs font-medium text-neutral-300">
                    {b.name}
                  </span>
                  {isUnknown && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: "#7c3aed22",
                        color: "#a78bfa",
                      }}
                    >
                      NEW
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  {MEALS.map((m) => (
                    <span
                      key={m.key}
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                      style={
                        b.meals[m.key]
                          ? { color: "#c8a97e" }
                          : { color: "#333" }
                      }
                    >
                      {m.key}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          (names as string[]).map((n) => (
            <div
              key={n}
              className="flex items-center rounded-lg px-4 py-2.5"
              style={{
                backgroundColor: "#131313",
                border: "1px solid #1a1a1a",
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: dotColor }}
                />
                <span className="text-xs font-medium" style={{ color: "#666" }}>
                  {n}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* View mode toggle */}
      <div
        className="flex gap-1 p-1 rounded-xl"
        style={{ backgroundColor: "#1a1a1a" }}
      >
        {(
          [
            { key: "day", label: "Daily" },
            { key: "week", label: "Weekly" },
          ] as const
        ).map((v) => (
          <button
            key={v.key}
            onClick={() => setViewMode(v.key)}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${viewMode === v.key ? "text-white" : "text-neutral-500"}`}
            style={viewMode === v.key ? { backgroundColor: "#2a2a2a" } : {}}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Date nav with calendar popover */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          className="px-3"
          onClick={() => navigateDate(-1)}
        >
          ←
        </Button>
        <div className="text-center relative">
          <button
            className="text-sm font-bold text-white cursor-pointer transition-all flex items-center gap-1.5"
            onClick={() => setCalendarOpen((p) => !p)}
          >
            {dateLabel}
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className={`transition-transform ${calendarOpen ? "rotate-180" : ""}`}
            >
              <path
                d="M2 3.5L5 6.5L8 3.5"
                stroke="#c8a97e"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {isLoading && (
            <div className="text-[10px] mt-0.5" style={{ color: "#c8a97e" }}>
              Loading...
            </div>
          )}

          {/* Calendar popover */}
          {calendarOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setCalendarOpen(false)}
              />
              <div
                className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2 rounded-xl p-3 shadow-2xl"
                style={{
                  backgroundColor: "#1a1a1a",
                  border: "1px solid #2a2a2a",
                  minWidth: "280px",
                }}
              >
                {/* Month/Year header */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    className="p-1 rounded-md transition-all hover:bg-white/5"
                    style={{ color: "#999" }}
                    onClick={() =>
                      setCalendarMonth((prev) => {
                        const d = new Date(prev.year, prev.month - 1, 1);
                        return { year: d.getFullYear(), month: d.getMonth() };
                      })
                    }
                  >
                    ←
                  </button>
                  <span className="text-sm font-semibold text-white">
                    {new Date(
                      calendarMonth.year,
                      calendarMonth.month,
                    ).toLocaleDateString("en-GB", {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                  <button
                    className="p-1 rounded-md transition-all hover:bg-white/5"
                    style={{ color: "#999" }}
                    onClick={() =>
                      setCalendarMonth((prev) => {
                        const d = new Date(prev.year, prev.month + 1, 1);
                        return { year: d.getFullYear(), month: d.getMonth() };
                      })
                    }
                  >
                    →
                  </button>
                </div>
                {/* Day headers */}
                <div className="grid grid-cols-5 gap-0.5 mb-1">
                  {["Mo", "Tu", "We", "Th", "Fr"].map((d) => (
                    <div
                      key={d}
                      className="text-center text-[10px] font-bold py-1"
                      style={{ color: "#555" }}
                    >
                      {d}
                    </div>
                  ))}
                </div>
                {/* Day grid */}
                <div className="grid grid-cols-5 gap-0.5">
                  {(() => {
                    const daysInMonth = new Date(
                      calendarMonth.year,
                      calendarMonth.month + 1,
                      0,
                    ).getDate();

                    const todayISO = toISO(today);
                    const selectedWeekMon = toISO(
                      startOfWeekMonday(fromISO(selectedDate)),
                    );

                    const weeks: JSX.Element[][] = [];
                    let currentWeek: JSX.Element[] = [];

                    for (let d = 1; d <= daysInMonth; d++) {
                      const date = new Date(
                        calendarMonth.year,
                        calendarMonth.month,
                        d,
                      );
                      const iso = toISO(date);
                      const dow = date.getDay(); // 0 Sun, 6 Sat

                      if (dow === 0 || dow === 6) continue;

                      const mondayIndex = dow - 1; // Mon=0 ... Fri=4
                      const isToday = iso === todayISO;
                      const isSelected =
                        viewMode === "day"
                          ? iso === selectedDate
                          : toISO(startOfWeekMonday(date)) === selectedWeekMon;

                      if (dow === 1 && currentWeek.length > 0) {
                        while (currentWeek.length < 5) {
                          currentWeek.push(
                            <div
                              key={`tail-pad-${weeks.length}-${currentWeek.length}`}
                            />,
                          );
                        }
                        weeks.push(currentWeek);
                        currentWeek = [];
                      }

                      while (currentWeek.length < mondayIndex) {
                        currentWeek.push(
                          <div key={`pad-${d}-${currentWeek.length}`} />,
                        );
                      }

                      currentWeek.push(
                        <button
                          key={d}
                          onClick={() => handleCalendarSelect(iso)}
                          className="relative flex items-center justify-center rounded-md py-1.5 text-xs font-medium transition-all"
                          style={{
                            backgroundColor: isSelected
                              ? "#c8a97e"
                              : "transparent",
                            color: isSelected
                              ? "#0a0a0a"
                              : isToday
                                ? "#c8a97e"
                                : "#ccc",
                            cursor: "pointer",
                            fontWeight: isToday || isSelected ? 700 : 400,
                          }}
                        >
                          {d}
                          {isToday && !isSelected && (
                            <span
                              className="absolute bottom-0.5 w-1 h-1 rounded-full"
                              style={{ backgroundColor: "#c8a97e" }}
                            />
                          )}
                        </button>,
                      );
                    }

                    if (currentWeek.length > 0) {
                      while (currentWeek.length < 5) {
                        currentWeek.push(
                          <div key={`final-pad-${currentWeek.length}`} />,
                        );
                      }
                      weeks.push(currentWeek);
                    }

                    return weeks.flat();
                  })()}
                </div>
                {/* Quick actions */}
                <div
                  className="flex gap-2 mt-3 pt-2"
                  style={{ borderTop: "1px solid #252525" }}
                >
                  <button
                    className="flex-1 text-[10px] font-medium py-1.5 rounded-md transition-all hover:bg-white/5"
                    style={{ color: "#c8a97e" }}
                    onClick={() => {
                      setSelectedDate(toISO(today));
                      setCalendarOpen(false);
                    }}
                  >
                    Today
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <Button
          variant="outline"
          className="px-3"
          onClick={() => navigateDate(1)}
        >
          →
        </Button>
      </div>

      {viewMode === "day" ? (
        <>
          {/* Total headcount */}
          <div
            className="rounded-2xl p-5 text-center"
            style={{ backgroundColor: "#161616", border: "1px solid #222" }}
          >
            <div className="text-5xl font-black" style={{ color: "#c8a97e" }}>
              {dayStats.total}
            </div>
            <div
              className="text-xs font-semibold tracking-wider uppercase mt-1"
              style={{ color: "#666" }}
            >
              Total indents
            </div>
            <div className="flex justify-center gap-6 mt-3">
              {MEALS.map((m) => {
                const count = dayStats.active.filter(
                  (b) => b.meals[m.key],
                ).length;
                return (
                  <div key={m.key} className="text-center">
                    <div className="text-lg font-bold text-white">{count}</div>
                    <div
                      className="text-[10px] uppercase tracking-wider"
                      style={{ color: "#666" }}
                    >
                      {m.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* By ration type */}
          {dayStats.total > 0 && (
            <div className="space-y-2">
              <div
                className="text-xs font-semibold tracking-wider uppercase px-1"
                style={{ color: "#666" }}
              >
                By Ration Type
              </div>
              {RATION_OPTIONS.map((o) => {
                const stat = dayStats.byType[o.value];
                if (!stat || stat.count === 0) return null;
                const pct = (stat.count / maxBar) * 100;
                return (
                  <div
                    key={o.value}
                    className="rounded-xl p-4"
                    style={{
                      backgroundColor: "#161616",
                      border: "1px solid #1e1e1e",
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: o.color }}
                        />
                        <span className="text-sm font-medium text-white">
                          {o.label}
                        </span>
                      </div>
                      <span
                        className="text-sm font-bold"
                        style={{ color: o.color }}
                      >
                        {stat.count}
                      </span>
                    </div>
                    <div
                      className="h-2 rounded-full overflow-hidden"
                      style={{ backgroundColor: "#222" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: o.color,
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <div
                      className="flex gap-4 mt-2 text-[10px] font-semibold tracking-wider uppercase"
                      style={{ color: "#555" }}
                    >
                      <span>B: {stat.B}</span>
                      <span>L: {stat.L}</span>
                      <span>D: {stat.D}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* FIX #1: All 3 categories */}
          {renderNameList(
            "Indented",
            dayStats.active,
            "#1a1812",
            "#c8a97e",
            "#666",
            "submitted",
            "No active bookings for this day",
            "#555",
            true,
          )}

          {dayStats.cancelled.length > 0 &&
            renderNameList(
              "Not Indented",
              dayStats.cancelled,
              "#1a1511",
              "#f59e0b",
              "#f59e0b66",
              "cancelled",
              "",
              "#555",
              true,
            )}

          {renderNameList(
            "Not Submitted",
            dayNameSets.notSubmitted,
            "#1a1111",
            "#ef4444",
            "#ef444466",
            "notSubmitted",
            "Everyone has submitted!",
            "#4ade80",
          )}
        </>
      ) : (
        <>
          {/* Week totals */}
          <div
            className="rounded-2xl p-5 text-center"
            style={{ backgroundColor: "#161616", border: "1px solid #222" }}
          >
            <div className="text-4xl font-black" style={{ color: "#c8a97e" }}>
              {weekTotals.total}
            </div>
            <div
              className="text-xs font-semibold tracking-wider uppercase mt-1"
              style={{ color: "#666" }}
            >
              Total indent-days
            </div>
            <div className="flex justify-center gap-6 mt-3">
              {[
                { key: "B" as const, label: "Breakfast", val: weekTotals.B },
                { key: "L" as const, label: "Lunch", val: weekTotals.L },
                { key: "D" as const, label: "Dinner", val: weekTotals.D },
              ].map((m) => (
                <div key={m.key} className="text-center">
                  <div className="text-lg font-bold text-white">{m.val}</div>
                  <div
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: "#666" }}
                  >
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bar chart */}
          <div
            className="rounded-2xl p-5"
            style={{ backgroundColor: "#131313", border: "1px solid #1e1e1e" }}
          >
            <div
              className="flex items-end justify-between gap-3"
              style={{ height: "160px" }}
            >
              {weekDays.map((day) => {
                const pct = (day.total / maxBar) * 100;
                return (
                  <div
                    key={day.iso}
                    className="flex-1 flex flex-col items-center justify-end h-full gap-2"
                  >
                    <span
                      className="text-xs font-bold"
                      style={{ color: "#c8a97e" }}
                    >
                      {day.total}
                    </span>
                    <div
                      className="w-full rounded-t-lg transition-all duration-500"
                      style={{
                        height: `${Math.max(pct, 4)}%`,
                        background:
                          "linear-gradient(180deg, #c8a97e 0%, #8a7050 100%)",
                        opacity: 0.8,
                      }}
                    />
                    <span
                      className="text-[10px] font-bold tracking-wider"
                      style={{ color: "#666" }}
                    >
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per day breakdown */}
          <div className="space-y-2">
            {weekDays.map((day) => (
              <button
                key={day.iso}
                className="w-full flex items-center justify-between rounded-xl px-4 py-3 transition-all hover:bg-white/[0.02]"
                style={{
                  backgroundColor: "#161616",
                  border: "1px solid #1e1e1e",
                }}
                onClick={() => {
                  setSelectedDate(day.iso);
                  setViewMode("day");
                }}
              >
                <span className="text-sm font-medium text-white">
                  {fromISO(day.iso).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <div className="flex items-center gap-4">
                  <div
                    className="flex gap-3 text-[10px] font-semibold tracking-wider uppercase"
                    style={{ color: "#666" }}
                  >
                    <span>B:{day.B}</span>
                    <span>L:{day.L}</span>
                    <span>D:{day.D}</span>
                  </div>
                  <span
                    className="text-sm font-bold min-w-[24px] text-right"
                    style={{ color: "#c8a97e" }}
                  >
                    {day.total}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────
export default function RationPlanner({ namelist }: WeeklyRationPlannerProps) {
  const auth = useAuth();
  const baseKey = "rationDetails";
  const nameKey = `${baseKey}:name`;
  const rationKey = `${baseKey}:rationType`;
  const [rationType, setRationType] = useState<RationType | "">("");
  const [nameSearch, setNameSearch] = useState("");
  const [showNameDropdown, setShowNameDropdown] = useState(false);
  const minWeekStartISO = useMemo(() => getMinBookableWeekStartISO(), []);
  const [name, setName] = useState("");

  const [weekStart, setWeekStart] = useState<string>(minWeekStartISO);

  const draftKey = `${baseKey}:weekDraft:${weekStart}`;
  const [plan, setPlan] = useState<WeekPlan>(() =>
    buildDefaultWeek(minWeekStartISO),
  );

  const dayKeys = useMemo(() => Object.keys(plan.days).sort(), [plan.days]);
  const readOnlyWeek = weekStart < minWeekStartISO;

  const submittedKey = `${baseKey}:weekSubmitted:${weekStart}`;
  const submittedRationKey = `${baseKey}:weekSubmittedRation:${weekStart}`;
  const stableStringify = useCallback(
    (obj: unknown) => JSON.stringify(obj),
    [],
  );

  const [submittedFingerprint, setSubmittedFingerprint] = useState<string>("");
  const [submittedRationType, setSubmittedRationType] = useState<string>("");

  useEffect(() => {
    try {
      setSubmittedFingerprint(localStorage.getItem(submittedKey) ?? "");
      setSubmittedRationType(localStorage.getItem(submittedRationKey) ?? "");
    } catch {
      setSubmittedFingerprint("");
      setSubmittedRationType("");
    }
  }, [submittedKey, submittedRationKey]);

  const currentFingerprint = useMemo(
    () => stableStringify(plan),
    [plan, stableStringify],
  );

  const hasAnyRation = useMemo(
    () => Object.values(plan.days).some((d) => d.enabled),
    [plan.days],
  );

  const enabledDaysWithNoMeals = useMemo(() => {
    const bad: string[] = [];
    for (const [dateISO, day] of Object.entries(plan.days)) {
      if (day.enabled && !day.meals.B && !day.meals.L && !day.meals.D)
        bad.push(dateISO);
    }
    return bad;
  }, [plan.days]);

  const hasIncompleteDays = enabledDaysWithNoMeals.length > 0;

  const submittedWithNoRation = useMemo(() => {
    if (!submittedFingerprint) return false;
    try {
      const submitted = JSON.parse(submittedFingerprint) as WeekPlan;
      return !Object.values(submitted.days).some((d) => d.enabled);
    } catch {
      return false;
    }
  }, [submittedFingerprint]);

  const hasUnsavedChanges = useMemo(() => {
    if (submittedRationType && rationType !== submittedRationType) return true;
    if (!submittedFingerprint) {
      for (const dateISO of Object.keys(plan.days)) {
        const d = plan.days[dateISO];
        if (d.enabled) return true;
        if (d.meals.B || d.meals.L || d.meals.D) return true;
      }
      return false;
    }
    return currentFingerprint !== submittedFingerprint;
  }, [
    submittedFingerprint,
    submittedRationType,
    rationType,
    currentFingerprint,
    plan.days,
  ]);

  const [noRationConfirmed, setNoRationConfirmed] = useState(false);

  useEffect(() => {
    setNoRationConfirmed(false);
  }, [weekStart]);
  useEffect(() => {
    if (hasAnyRation) setNoRationConfirmed(false);
  }, [hasAnyRation]);

  // FIX #3: Track if editing someone else
  const isEditingOther =
    AUTH_MODE !== "none" && CAN_EDIT_ANY && auth.name
      ? name !== "" && name !== auth.name
      : false;

  // Check if current sgID user is in the namelist
  const isUserInNamelist = useMemo(() => {
    if (AUTH_MODE === "none" || !auth.name) return true;
    return namelist.includes(auth.name);
  }, [auth.name, namelist]);

  // FIX #4: Block nav when no rations + not confirmed + not already submitted as empty
  const guardNavigate = (fn: () => void) => {
    if (readOnlyWeek) {
      fn();
      return;
    }
    if (hasUnsavedChanges) {
      toast.error("You have unsaved changes", {
        description: "Please submit before switching weeks.",
      });
      return;
    }
    // Block when all days are off, not yet confirmed, and not already submitted as no-ration
    if (
      !hasAnyRation &&
      !noRationConfirmed &&
      !submittedWithNoRation &&
      submittedFingerprint !== ""
    ) {
      toast.error("No rations selected", {
        description:
          "Please confirm 'no rations' or select meals before switching weeks.",
      });
      return;
    }
    if (
      !hasAnyRation &&
      !noRationConfirmed &&
      submittedFingerprint === "" &&
      name.trim() &&
      rationType
    ) {
      toast.error("No rations selected", {
        description:
          "Please confirm 'no rations' or select meals before switching weeks.",
      });
      return;
    }
    fn();
  };

  const cacheKey = `${baseKey}:serverCache:${name.trim()}`;
  const [serverCache, setServerCache] = useState<
    Record<string, { rationType: string | null; plan: WeekPlan }>
  >({});
  const [isFetching, setIsFetching] = useState(false);

  // Load identity
  useEffect(() => {
    if (AUTH_MODE !== "none" && auth.name) {
      setName(
        CAN_EDIT_ANY ? localStorage.getItem(nameKey) || auth.name : auth.name,
      );
    } else if (AUTH_MODE === "none") {
      try {
        setName(localStorage.getItem(nameKey) ?? "");
      } catch {}
    }
    try {
      setRationType((localStorage.getItem(rationKey) as RationType) ?? "");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.name]);

  // Persist identity (name only in none mode or edit_any mode)
  useEffect(() => {
    if (AUTH_MODE !== "none" && !CAN_EDIT_ANY) return;
    try {
      if (name) localStorage.setItem(nameKey, name);
      else localStorage.removeItem(nameKey);
    } catch {}
  }, [name, nameKey]);

  useEffect(() => {
    try {
      if (rationType) localStorage.setItem(rationKey, rationType);
      else localStorage.removeItem(rationKey);
    } catch {}
  }, [rationType, rationKey]);

  // Bulk fetch
  useEffect(() => {
    if (!name.trim()) {
      setServerCache({});
      return;
    }
    let cancelled = false;
    async function fetchAll() {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached && !cancelled) setServerCache(JSON.parse(cached));
      } catch {}
      setIsFetching(true);
      try {
        const res = await fetch(
          `/api/getAllRations?${new URLSearchParams({ name: name.trim() })}`,
        );
        if (!res.ok) {
          console.error(`[RationPlanner] getAllRations ${res.status}`);
          return;
        }
        const data = await res.json();
        if (!cancelled && data?.weeks) {
          const weeks = data.weeks as Record<
            string,
            { rationType: string | null; plan: WeekPlan }
          >;
          setServerCache(weeks);
          try {
            localStorage.setItem(cacheKey, JSON.stringify(weeks));
          } catch {}
          if (!rationType) {
            for (const entry of Object.values(weeks)) {
              if (entry.rationType) {
                setRationType(entry.rationType as RationType);
                break;
              }
            }
          }
          for (const [ws, entry] of Object.entries(weeks)) {
            try {
              localStorage.setItem(
                `${baseKey}:weekSubmitted:${ws}`,
                JSON.stringify(entry.plan),
              );
              if (entry.rationType)
                localStorage.setItem(
                  `${baseKey}:weekSubmittedRation:${ws}`,
                  entry.rationType,
                );
            } catch {}
          }
        }
      } catch (e) {
        console.error("[RationPlanner] fetch error:", e);
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    }
    fetchAll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, cacheKey]);

  useEffect(() => {
    const cached = serverCache[weekStart];
    if (cached?.plan?.days) {
      setPlan(cached.plan);
      try {
        localStorage.setItem(submittedKey, JSON.stringify(cached.plan));
        setSubmittedFingerprint(JSON.stringify(cached.plan));
        if (cached.rationType) {
          localStorage.setItem(submittedRationKey, cached.rationType);
          setSubmittedRationType(cached.rationType);
        }
      } catch {}
    } else {
      try {
        setPlan(
          normalizeOrRebuildDraft(localStorage.getItem(draftKey), weekStart),
        );
      } catch {
        setPlan(buildDefaultWeek(weekStart));
      }
      setSubmittedFingerprint("");
      setSubmittedRationType("");
    }
  }, [weekStart, serverCache, draftKey, submittedKey, submittedRationKey]);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(plan));
    } catch {}
  }, [draftKey, plan]);

  const prevWeek = () =>
    guardNavigate(() => setWeekStart(nextWeekStartISO(weekStart, -1)));
  const nextWeek = () =>
    guardNavigate(() => setWeekStart(nextWeekStartISO(weekStart, +1)));

  const setDayEnabled = (dateISO: string, enabled: boolean) => {
    if (readOnlyWeek || isPastDateLocked(dateISO)) return;
    setPlan((prev) => {
      const next = structuredClone(prev);
      next.days[dateISO].enabled = enabled;
      if (!enabled) next.days[dateISO].meals = { B: false, L: false, D: false };
      return next;
    });
  };

  const toggleMeal = (dateISO: string, meal: Meal) => {
    if (readOnlyWeek || isPastDateLocked(dateISO)) return;
    setPlan((prev) => {
      const next = structuredClone(prev);
      const day = next.days[dateISO];
      if (!day.enabled) return prev;
      day.meals[meal] = !day.meals[meal];
      return next;
    });
  };

  const clearWeek = () => {
    if (readOnlyWeek) return;
    setPlan(buildDefaultWeek(weekStart));
    toast.info("Cleared", { description: "Click Submit to save changes." });
  };

  const goToCurrentBookingWeek = () =>
    guardNavigate(() => setWeekStart(minWeekStartISO));

  const canSubmit =
    !readOnlyWeek &&
    Boolean(name.trim()) &&
    Boolean(rationType) &&
    !hasIncompleteDays &&
    (hasUnsavedChanges || noRationConfirmed);

  const handleSubmit = async () => {
    if (hasIncompleteDays) {
      const labels = enabledDaysWithNoMeals
        .map((iso) =>
          fromISO(iso).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
          }),
        )
        .join(", ");
      toast.error("Select at least 1 meal per day", {
        description: `Missing meals: ${labels}`,
      });
      return;
    }
    if (!canSubmit) return;

    try {
      const res = await fetch("/api/addRation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          rationType,
          weekStart: plan.weekStart,
          plan,
          // FIX #3: track who made the edit
          ...(TRACK_EDITED_BY && auth.name ? { editedBy: auth.name } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error("Submit failed", {
          description: err?.error ?? "Please try again.",
        });
        return;
      }

      localStorage.setItem(submittedKey, JSON.stringify(plan));
      setSubmittedFingerprint(JSON.stringify(plan));
      localStorage.setItem(submittedRationKey, rationType);
      setSubmittedRationType(rationType);
      setNoRationConfirmed(false);

      setServerCache((prev) => {
        const next = { ...prev };
        next[plan.weekStart] = { rationType, plan: structuredClone(plan) };
        try {
          localStorage.setItem(cacheKey, JSON.stringify(next));
        } catch {}
        return next;
      });

      toast.success("Submitted", {
        description: hasAnyRation
          ? "Your rations have been saved."
          : "Confirmed: no rations for this week.",
      });
    } catch {
      toast.error("Submit failed", {
        description: "Network error. Try again.",
      });
    }
  };

  const filteredNames = namelist.filter((n) =>
    n.toLowerCase().includes(nameSearch.toLowerCase()),
  );

  // Login gate
  if (AUTH_MODE !== "none" && auth.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-sm" style={{ color: "#666" }}>
          Loading...
        </p>
      </div>
    );
  }
  if (AUTH_MODE !== "none" && !auth.isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 max-w-md mx-auto text-center">
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Ration Planner
          </h1>
          <p className="text-xs" style={{ color: "#555" }}>
            Book and manage your weekly rations
          </p>
        </div>
        <div
          className="rounded-2xl p-8 space-y-4 w-full mb-auto"
          style={{ backgroundColor: "#161616", border: "1px solid #252525" }}
        >
          <p className="text-sm" style={{ color: "#999" }}>
            Sign in with Singpass to get started.
          </p>
          <Button
            className="w-full py-3 text-sm font-bold"
            style={{
              background: "linear-gradient(135deg, #c8a97e 0%, #a88a5e 100%)",
              color: "#0a0a0a",
            }}
            onClick={auth.login}
          >
            Login with Singpass
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="text-center space-y-1 relative">
        <h1 className="text-xl font-bold text-white tracking-tight">
          Ration Planner
        </h1>
        <p className="text-xs" style={{ color: "#555" }}>
          Book and manage your weekly rations
        </p>
        {AUTH_MODE !== "none" && (
          <button
            onClick={auth.logout}
            className="absolute right-0 top-0 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all hover:bg-white/5"
            style={{ border: "1px solid #2a2a2a", color: "#666" }}
          >
            Logout
          </button>
        )}
      </div>
      <Tabs defaultValue="plan" className="w-full gap-6">
        <TabsList className="w-full group-data-[orientation=horizontal]/tabs:h-12">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="myBookings">My Bookings</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
        </TabsList>
        <TabsContent value="plan" className="gap-6 flex flex-col">
          <div className="space-y-3 bg-muted p-4 rounded-lg">
            {/* FIX #3: Name section — 3 modes */}
            <div className="space-y-2 relative">
              <Label
                className="text-xs font-semibold tracking-wider uppercase"
                style={{ color: "#c8a97e" }}
              >
                {AUTH_MODE !== "none" && !CAN_EDIT_ANY
                  ? "Logged in as"
                  : CAN_EDIT_ANY
                    ? "Editing rations for"
                    : "Your Name"}
              </Label>

              {AUTH_MODE !== "none" && !CAN_EDIT_ANY ? (
                /* sgid + self_only: static name with NEW badge for unknown users */
                <>
                  <div
                    className="flex items-center rounded-xl px-4 py-3"
                    style={{
                      backgroundColor: "#0f0f0f",
                      border: !isUserInNamelist
                        ? "1px solid #7c3aed44"
                        : "1px solid #2a2a2a",
                    }}
                  >
                    <span className="flex-1 text-sm font-medium text-white">
                      {name || "Loading..."}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {!isUserInNamelist && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: "#7c3aed22",
                            color: "#a78bfa",
                          }}
                        >
                          NEW
                        </span>
                      )}
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: "#4ade8020",
                          color: "#4ade80",
                        }}
                      >
                        Verified
                      </span>
                    </div>
                  </div>
                  {!isUserInNamelist && (
                    <p
                      className="text-[11px] mt-1"
                      style={{ color: "#a78bfa" }}
                    >
                      Your name isn&apos;t in the roster yet. Your bookings are
                      saved — contact your admin to be added.
                    </p>
                  )}
                </>
              ) : (
                /* none OR sgid+edit_any: dropdown */
                <>
                  <div
                    className="flex items-center rounded-xl px-4 py-3 cursor-pointer transition-colors"
                    style={{
                      backgroundColor: "#0f0f0f",
                      border: "1px solid #2a2a2a",
                    }}
                    onClick={() => setShowNameDropdown(!showNameDropdown)}
                  >
                    <span className="flex-1 text-sm font-medium text-white">
                      {name || "Select name..."}
                    </span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      className={`transition-transform ${showNameDropdown ? "rotate-180" : ""}`}
                    >
                      <path
                        d="M2 4L6 8L10 4"
                        stroke="#666"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  {showNameDropdown && (
                    <div
                      className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-2xl"
                      style={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #2a2a2a",
                      }}
                    >
                      <div className="p-2">
                        <input
                          type="text"
                          value={nameSearch}
                          onChange={(e) => setNameSearch(e.target.value)}
                          placeholder="Search..."
                          className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-neutral-600 outline-none"
                          style={{
                            backgroundColor: "#0f0f0f",
                            border: "1px solid #333",
                          }}
                          autoFocus
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {filteredNames.map((n) => (
                          <button
                            key={n}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${n === name ? "text-white" : "text-neutral-400 hover:text-white"}`}
                            style={
                              n === name ? { backgroundColor: "#252525" } : {}
                            }
                            onMouseOver={(e) =>
                              (e.currentTarget.style.backgroundColor = "#222")
                            }
                            onMouseOut={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                n === name ? "#252525" : "")
                            }
                            onClick={() => {
                              setName(n);
                              setShowNameDropdown(false);
                              setNameSearch("");
                            }}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* FIX #3: editing-other notice */}
                  {isEditingOther && (
                    <p
                      className="text-[11px] font-medium mt-1"
                      style={{ color: "#f59e0b" }}
                    >
                      Editing on behalf of {name} (logged in as {auth.name})
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label
                className="text-xs font-semibold tracking-wider uppercase"
                style={{ color: "#c8a97e" }}
              >
                Ration Type
              </Label>
              <p className="text-xs opacity-70">
                This ration type will be applied to all bookings (no per-day
                override).
              </p>
              <div className="flex flex-wrap gap-2">
                {RATION_OPTIONS.map((o) => (
                  <Pill
                    key={o.value}
                    active={rationType === o.value}
                    color={o.color}
                    onClick={() => setRationType(o.value)}
                  >
                    {o.label}
                  </Pill>
                ))}
              </div>
            </div>
          </div>

          {!name.trim() || !rationType ? (
            <p className="text-sm text-muted-foreground">
              Please fill in your name and ration type above to start planning.
            </p>
          ) : isFetching && Object.keys(serverCache).length === 0 ? (
            <div className="flex items-center justify-center py-8 gap-2">
              <div
                className="w-4 h-4 rounded-full animate-pulse"
                style={{ backgroundColor: "#c8a97e" }}
              />
              <span className="text-sm" style={{ color: "#666" }}>
                Loading your rations...
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  Week of{" "}
                  {fromISO(plan.weekStart).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  <div className="text-xs mt-0.5" style={{ color: "#666" }}>
                    Mon-Fri · {process.env.NEXT_PUBLIC_LEAD_TIME ?? 3}-week lead
                    time
                    <br />
                    {readOnlyWeek ? (
                      <span className="text-xs font-medium text-white">
                        (Read-only)
                      </span>
                    ) : null}
                    {hasUnsavedChanges && !readOnlyWeek ? (
                      <span className="text-xs font-medium text-orange-600">
                        (Unsaved changes)
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="text-sm px-3"
                    onClick={prevWeek}
                  >
                    ←
                  </Button>
                  <Button
                    variant="outline"
                    onClick={goToCurrentBookingWeek}
                    disabled={weekStart === minWeekStartISO}
                    className="px-3 py-2 rounded-lg text-xs font-medium transition-all hover:bg-white/5"
                    style={{ border: "1px solid #2a2a2a", color: "#c8a97e" }}
                  >
                    Today
                  </Button>
                  <Button
                    variant="outline"
                    className="text-sm px-3"
                    onClick={nextWeek}
                  >
                    →
                  </Button>
                </div>
              </div>

              {/* Week grid */}
              <div className="space-y-3">
                {dayKeys.map((dateISO) => {
                  const day = plan.days[dateISO];
                  const dateObj = fromISO(dateISO);
                  const dayNum = dateObj.getDate();
                  const dayName = dateObj.toLocaleDateString("en-GB", {
                    weekday: "short",
                  });
                  const monthShort = dateObj.toLocaleDateString("en-GB", {
                    month: "short",
                  });
                  const locked = readOnlyWeek || isPastDateLocked(dateISO);
                  const isIncomplete =
                    day.enabled && !day.meals.B && !day.meals.L && !day.meals.D;

                  return (
                    <div
                      key={dateISO}
                      className="rounded-xl p-4 transition-all duration-300 border"
                      style={{
                        backgroundColor: day.enabled ? "#1a1812" : "#111111",
                        border: isIncomplete
                          ? "1px solid #7f1d1d"
                          : day.enabled
                            ? "1px solid #3d3520"
                            : "1px solid #1e1e1e",
                      }}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col items-center min-w-[44px]">
                          <span
                            className="text-[10px] font-bold tracking-wider uppercase"
                            style={{ color: day.enabled ? "#c8a97e" : "#555" }}
                          >
                            {dayName}
                          </span>
                          <span
                            className={`text-xl font-bold ${day.enabled ? "text-white" : "text-neutral-600"}`}
                          >
                            {dayNum}
                          </span>
                          <span
                            className="text-[10px]"
                            style={{ color: "#555" }}
                          >
                            {monthShort}
                          </span>
                          {locked ? (
                            <span className="text-xs opacity-60 text-orange-500">
                              (Locked)
                            </span>
                          ) : null}
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                          {day.enabled && (
                            <>
                              <div className="flex items-center gap-2">
                                {MEALS.map((m) => (
                                  <Button
                                    key={m.key}
                                    disabled={locked}
                                    onClick={() => toggleMeal(dateISO, m.key)}
                                    className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-200"
                                    style={
                                      day.meals[m.key]
                                        ? {
                                            backgroundColor: "#c8a97e22",
                                            border: "1px solid #c8a97e55",
                                            color: "#c8a97e",
                                          }
                                        : {
                                            backgroundColor: "transparent",
                                            border: "1px solid #2a2a2a",
                                            color: "#555",
                                          }
                                    }
                                  >
                                    {m.label.charAt(0)}
                                  </Button>
                                ))}
                              </div>
                              {isIncomplete && (
                                <p
                                  className="text-[11px] font-medium"
                                  style={{ color: "#ef4444" }}
                                >
                                  Select at least 1 meal
                                </p>
                              )}
                            </>
                          )}
                        </div>
                        <Button
                          onClick={() => setDayEnabled(dateISO, !day.enabled)}
                          className="relative w-12 h-7 rounded-full transition-all duration-300"
                          style={{
                            backgroundColor: day.enabled
                              ? "#c8a97e"
                              : "#2a2a2a",
                          }}
                        >
                          <div
                            className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300"
                            style={{
                              left: day.enabled
                                ? "calc(100% - 1.625rem)"
                                : "0.125rem",
                            }}
                          />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* No-ration banner */}
              {!hasAnyRation && !readOnlyWeek && (
                <div
                  className="rounded-xl p-4 flex items-center justify-between"
                  style={{
                    backgroundColor:
                      submittedWithNoRation && !hasUnsavedChanges
                        ? "#0f1a14"
                        : noRationConfirmed
                          ? "#111a11"
                          : "#1a1711",
                    border:
                      submittedWithNoRation && !hasUnsavedChanges
                        ? "1px solid #1a3d28"
                        : noRationConfirmed
                          ? "1px solid #1e3d1e"
                          : "1px solid #3d3520",
                  }}
                >
                  <div className="flex items-center gap-3">
                    {submittedWithNoRation && !hasUnsavedChanges && (
                      <div
                        className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
                        style={{ backgroundColor: "#4ade8020" }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M3 8.5L6.5 12L13 4"
                            stroke="#4ade80"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    )}
                    <div>
                      <p
                        className="text-sm font-medium"
                        style={{
                          color:
                            submittedWithNoRation && !hasUnsavedChanges
                              ? "#4ade80"
                              : noRationConfirmed
                                ? "#4ade80"
                                : "#c8a97e",
                        }}
                      >
                        {submittedWithNoRation && !hasUnsavedChanges
                          ? "No rations — submitted"
                          : noRationConfirmed
                            ? "No rations confirmed — submit to save"
                            : "No rations selected this week"}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#666" }}>
                        {submittedWithNoRation && !hasUnsavedChanges
                          ? "You've confirmed no indents for this week. Toggle days above to change."
                          : noRationConfirmed
                            ? "Click Submit to record that you won't be indenting."
                            : "If this is intentional, confirm below."}
                      </p>
                    </div>
                  </div>
                  {!noRationConfirmed &&
                    !(submittedWithNoRation && !hasUnsavedChanges) && (
                      <Button
                        variant="outline"
                        className="text-xs shrink-0"
                        style={{
                          border: "1px solid #3d3520",
                          color: "#c8a97e",
                        }}
                        onClick={() => setNoRationConfirmed(true)}
                      >
                        Confirm
                      </Button>
                    )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  onClick={clearWeek}
                  disabled={readOnlyWeek}
                  className="h-10 bg-[#1a1111] disabled:opacity-50 text-sm font-medium transition-all"
                  style={{ border: "1px solid #3d2020", color: "#e85555" }}
                >
                  Clear
                </Button>
                <Button
                  className="flex-1 py-3 h-10 text-sm font-bold transition-all duration-300"
                  disabled={!canSubmit}
                  style={
                    canSubmit
                      ? {
                          background:
                            noRationConfirmed && !hasAnyRation
                              ? "linear-gradient(135deg, #4ade80 0%, #22c55e 100%)"
                              : "linear-gradient(135deg, #c8a97e 0%, #a88a5e 100%)",
                          color: "#0a0a0a",
                          boxShadow:
                            noRationConfirmed && !hasAnyRation
                              ? "0 4px 20px #4ade8044"
                              : "0 4px 20px #c8a97e44",
                        }
                      : {
                          backgroundColor: "#1a1a1a",
                          color: "#444",
                          border: "1px solid #252525",
                        }
                  }
                  onClick={handleSubmit}
                >
                  {noRationConfirmed && !hasAnyRation
                    ? "Submit — No Rations"
                    : "Submit Rations"}
                </Button>
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="myBookings" className="gap-6 flex flex-col">
          <MonthlyOverview serverCache={serverCache} name={name} />
        </TabsContent>
        <TabsContent value="admin" className="gap-6 flex flex-col">
          <AdminView namelist={namelist} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
