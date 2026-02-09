"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
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
import type { Meal, RationType, DayPlan, WeekPlan } from "@/types";
import {
  fromISO,
  toISO,
  startOfDayLocal,
  startOfWeekMonday,
} from "@/lib/utils";

const MEALS: { key: Meal; label: string }[] = [
  { key: "B", label: "Breakfast" },
  { key: "L", label: "Lunch" },
  { key: "D", label: "Dinner" },
];

const RATION_OPTIONS: { value: RationType; label: string }[] = [
  { value: "nm", label: "Non-Muslim" },
  { value: "m", label: "Muslim" },
  { value: "nmsd", label: "Non-Muslim Special Diet" },
  { value: "vi", label: "Vegetarian Indian" },
  { value: "vc", label: "Vegetarian Chinese" },
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

export default function WeeklyRationPlanner({
  namelist,
}: WeeklyRationPlannerProps) {
  const baseKey = "rationDetails";
  const nameKey = `${baseKey}:name`;
  const defaultRationKey = `${baseKey}:defaultRationType`;

  const minWeekStartISO = useMemo(() => getMinBookableWeekStartISO(), []);
  const [name, setName] = useState("");
  const [defaultRationType, setDefaultRationType] = useState<RationType | "">(
    "",
  );

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
      setDefaultRationType(
        (localStorage.getItem(defaultRationKey) as any) ?? "",
      );
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
      if (defaultRationType)
        localStorage.setItem(defaultRationKey, defaultRationType);
      else localStorage.removeItem(defaultRationKey);
    } catch {}
  }, [defaultRationType, defaultRationKey]);

  // Load week draft when weekStart changes
  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 1) Try server if we have a name
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
              if (data.rationType && !defaultRationType) {
                setDefaultRationType(data.rationType);
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

      // 2) fallback to local draft
      const raw = localStorage.getItem(draftKey);
      setPlan(normalizeOrRebuildDraft(raw, weekStart));
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [
    name,
    weekStart,
    draftKey,
    submittedKey,
    defaultRationType,
    normalizeOrRebuildDraft, // if yours is outside, remove from deps
  ]);

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
    Boolean(defaultRationType) &&
    hasUnsavedChanges;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      const res = await fetch("/api/addRation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          rationType: defaultRationType,
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

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {/* Identity */}
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="name">Your Name</Label>

          <Combobox
            items={namelist}
            value={name}
            onValueChange={(val) => setName(val || "")}
          >
            <ComboboxInput id="name" placeholder="Enter your name" />
            <ComboboxContent>
              <ComboboxEmpty>No name found</ComboboxEmpty>
              <ComboboxList>
                {(item) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>

        <div className="space-y-2">
          <Label>Ration Type (Default)</Label>
          <Select
            value={defaultRationType}
            onValueChange={(v) => setDefaultRationType(v as any)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose ration type" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {RATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <p className="text-xs opacity-70">
            This ration type will be applied to all bookings (no per-day
            override).
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={goToCurrentBookingWeek}
          disabled={weekStart === minWeekStartISO}
          title="Jump to earliest editable week"
        >
          This week
        </Button>
        <Button
          variant="outline"
          onClick={goToCurrentBookingWeek}
          disabled={weekStart === minWeekStartISO}
          title="Jump to earliest editable week"
        >
          Booking Now
        </Button>
      </div>

      {/* Week nav */}
      <div className="flex items-center justify-between">
        <div className="font-medium">
          Week of {plan.weekStart} (Mon–Fri)
          <div className="text-xs opacity-70">
            Earliest editable week starts {minWeekStartISO} (2-week lead time)
            {readOnlyWeek ? (
              <span className="ml-2 text-xs font-medium">(Read-only)</span>
            ) : null}
            {hasUnsavedChanges && !readOnlyWeek ? (
              <span className="ml-2 text-xs font-medium text-orange-600">
                (Unsaved changes)
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={prevWeek}>
            Prev
          </Button>

          <Button variant="outline" onClick={nextWeek}>
            Next
          </Button>
        </div>
      </div>

      {/* Week grid */}
      <div className="space-y-3">
        {dayKeys.map((dateISO) => {
          const day = plan.days[dateISO];
          const locked = readOnlyWeek || isPastDateLocked(dateISO);

          return (
            <div key={dateISO} className="border rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  {formatDayLabel(dateISO)}
                  {locked ? (
                    <span className="ml-2 text-xs opacity-60">(Locked)</span>
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
      <div className="flex gap-2">
        <Button
          variant="destructive"
          onClick={clearWeek}
          disabled={readOnlyWeek}
        >
          Clear week
        </Button>

        <Button className="flex-1" disabled={!canSubmit} onClick={handleSubmit}>
          Submit
        </Button>
      </div>
    </div>
  );
}
