"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useEffect, useState, useMemo, useCallback } from "react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

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
function formatDayLabel(iso: string) {
  const d = fromISO(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
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
  const lead = addDaysLocal(startOfDayLocal(), 14);
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

export default function RationPlanner({ namelist }: WeeklyRationPlannerProps) {
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

  // --------- Unsaved-change guard (per-week) ---------
  // We keep a "last submitted" snapshot in localStorage. If current plan differs, block nav.
  const submittedKey = `${baseKey}:weekSubmitted:${weekStart}`;

  const stableStringify = useCallback(
    (obj: unknown) => JSON.stringify(obj),
    [],
  );

  const [submittedFingerprint, setSubmittedFingerprint] = useState<string>("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(submittedKey);
      setSubmittedFingerprint(raw ?? "");
    } catch {
      setSubmittedFingerprint("");
    }
  }, [submittedKey]);

  const currentFingerprint = useMemo(
    () => stableStringify(plan),
    [plan, stableStringify],
  );

  const hasUnsavedChanges = useMemo(() => {
    // If nothing submitted yet, treat as unsaved only when user has made any selection
    if (!submittedFingerprint) {
      // “dirty” if any enabled day OR any meal selected
      for (const dateISO of Object.keys(plan.days)) {
        const d = plan.days[dateISO];
        if (d.enabled) return true;
        if (d.meals.B || d.meals.L || d.meals.D) return true;
      }
      return false;
    }
    return currentFingerprint !== submittedFingerprint;
  }, [submittedFingerprint, currentFingerprint, plan.days]);

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
    fn();
  };

  // Load identity
  useEffect(() => {
    try {
      setName(localStorage.getItem(nameKey) ?? "");
      setRationType((localStorage.getItem(rationKey) as any) ?? "");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist identity
  useEffect(() => {
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

  // Load week draft when weekStart changes
  useEffect(() => {
    let cancelled = false;

    setPlan(buildDefaultWeek(weekStart));

    async function load() {
      if (name.trim()) {
        try {
          const qs = new URLSearchParams({
            name: name.trim(),
            weekStart,
          });
          const res = await fetch(`/api/getRation?${qs.toString()}`);
          if (res.ok) {
            const data = await res.json();
            if (!cancelled && data?.plan?.days) {
              setPlan(data.plan);

              // Optional: if server returns rationType, hydrate default ration
              if (data.rationType && !rationType) {
                setRationType(data.rationType);
              }

              // Also set submitted fingerprint to allow navigation
              try {
                localStorage.setItem(submittedKey, JSON.stringify(data.plan));
                setSubmittedFingerprint(JSON.stringify(data.plan));
              } catch {}

              return; // stop here (server is source of truth)
            }
          }
        } catch {
          // ignore and fallback
        }
      }

      if (!cancelled) {
        const raw = localStorage.getItem(draftKey);
        setPlan(normalizeOrRebuildDraft(raw, weekStart));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [name, weekStart, draftKey, submittedKey, rationType]);

  // Persist week draft
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
    if (readOnlyWeek) return;
    if (isPastDateLocked(dateISO)) return;

    setPlan((prev) => {
      const next = structuredClone(prev);
      next.days[dateISO].enabled = enabled;
      if (!enabled) next.days[dateISO].meals = { B: false, L: false, D: false };
      return next;
    });
  };

  const toggleMeal = (dateISO: string, meal: Meal) => {
    if (readOnlyWeek) return;
    if (isPastDateLocked(dateISO)) return;

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
    hasUnsavedChanges;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      const res = await fetch("/api/addRation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          rationType: rationType,
          weekStart: plan.weekStart,
          plan,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error("Submit failed", {
          description: err?.error ?? "Please try again.",
        });
        return;
      }

      // ✅ only mark submitted after success
      localStorage.setItem(submittedKey, JSON.stringify(plan));
      setSubmittedFingerprint(JSON.stringify(plan));

      toast.success("Submitted", {
        description: "Your rations have been saved.",
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

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold text-white tracking-tight">
          Ration Planner
        </h1>
        <p className="text-xs" style={{ color: "#555" }}>
          Book and manage your weekly rations
        </p>
      </div>
      <Tabs defaultValue="plan" className="w-full gap-6">
        <TabsList className="w-full group-data-[orientation=horizontal]/tabs:h-12">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="myBookings">My Bookings</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
        </TabsList>
        <TabsContent value="plan" className="gap-6 flex flex-col">
          <div className="space-y-3 bg-muted p-4 rounded-lg">
            <div className="space-y-2 relative">
              <Label
                className="text-xs font-semibold tracking-wider uppercase"
                style={{ color: "#c8a97e" }}
              >
                Your Name
              </Label>
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
                      <Button
                        key={n}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                          n === name
                            ? "text-white"
                            : "text-neutral-400 hover:text-white"
                        }`}
                        style={n === name ? { backgroundColor: "#252525" } : {}}
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
                      </Button>
                    ))}
                  </div>
                </div>
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
                    Mon-Fri · 2-week lead time
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

                  return (
                    <div
                      key={dateISO}
                      className="rounded-xl p-4 transition-all duration-300 border"
                      style={{
                        backgroundColor: day.enabled ? "#1a1812" : "#111111",
                        border: day.enabled
                          ? "1px solid #3d3520"
                          : "1px solid #1e1e1e",
                      }}
                    >
                      <div className="flex items-center gap-4">
                        {/* Date badge */}
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
                            <span className="ml-2 text-xs opacity-60 text-orange-500">
                              (Locked)
                            </span>
                          ) : null}
                        </div>

                        {/* Meal toggles */}
                        <div className="flex-1 flex items-center gap-2">
                          {day.enabled &&
                            MEALS.map((m) => (
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
                                {m.label}
                              </Button>
                            ))}
                        </div>

                        {/* Toggle button */}
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
                      <div className="flex items-center justify-between">
                        <div className="font-medium">
                          {formatDayLabel(dateISO)}
                          {locked ? (
                            <span className="ml-2 text-xs opacity-60">
                              (Locked)
                            </span>
                          ) : null}
                        </div>

                        <Button
                          variant={day.enabled ? "default" : "outline"}
                          onClick={() => setDayEnabled(dateISO, !day.enabled)}
                          disabled={locked}
                        >
                          {day.enabled ? "Have ration" : "No ration"}
                        </Button>
                      </div>

                      {day.enabled && (
                        <div className="flex flex-wrap gap-2">
                          {MEALS.map((m) => (
                            <Button
                              key={m.key}
                              variant={day.meals[m.key] ? "default" : "outline"}
                              onClick={() => toggleMeal(dateISO, m.key)}
                              disabled={locked}
                            >
                              {m.label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  onClick={clearWeek}
                  disabled={readOnlyWeek}
                  className="h-10 bg-[#1a1111] disabled:opacity-50 text-sm font-medium transition-all"
                  style={{
                    border: "1px solid #3d2020",
                    color: "#e85555",
                  }}
                >
                  Clear
                </Button>
                <Button
                  className="flex-1 py-3 h-10 text-sm font-bold transition-all duration-300"
                  style={
                    canSubmit
                      ? {
                          background:
                            "linear-gradient(135deg, #c8a97e 0%, #a88a5e 100%)",
                          color: "#0a0a0a",
                          boxShadow: "0 4px 20px #c8a97e44",
                        }
                      : {
                          backgroundColor: "#1a1a1a",
                          color: "#444",
                          border: "1px solid #252525",
                        }
                  }
                  onClick={handleSubmit}
                >
                  Submit Rations
                </Button>
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="myBookings">Change your password here.</TabsContent>
        <TabsContent value="admin">Change your password here.</TabsContent>
      </Tabs>
    </div>
  );
}
