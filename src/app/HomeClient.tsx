"use client";

import * as React from "react";
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

type Meal = "B" | "L" | "D";
type RationType = "nm" | "m" | "nmsd" | "vi" | "vc";

type DayPlan = {
  enabled: boolean;
  meals: Record<Meal, boolean>;
};

type WeekPlan = {
  weekStart: string; // Monday local ISO date
  days: Record<string, DayPlan>; // Mon–Fri only
};

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

// ---------- LOCAL date helpers ----------
function toLocalISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function fromISO(iso: string) {
  return new Date(`${iso}T00:00:00`);
}
function startOfDayLocal(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDaysLocal(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function startOfWeekMondayLocal(date = new Date()) {
  const d = startOfDayLocal(date);
  const day = d.getDay(); // Sun=0..Sat=6
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
function nextWeekStartISO(weekStartISO: string, deltaWeeks: number) {
  const base = fromISO(weekStartISO);
  const moved = addDaysLocal(base, deltaWeeks * 7);
  return toLocalISO(startOfWeekMondayLocal(moved));
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
  const normalizedWeekStartISO = toLocalISO(
    startOfWeekMondayLocal(fromISO(weekStartISO)),
  );
  const weekStart = fromISO(normalizedWeekStartISO);

  const days: Record<string, DayPlan> = {};
  for (let i = 0; i < 5; i++) {
    const iso = toLocalISO(addDaysLocal(weekStart, i));
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
  return toLocalISO(startOfWeekMondayLocal(lead));
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

  const minWeekStartISO = React.useMemo(() => getMinBookableWeekStartISO(), []);

  const [name, setName] = React.useState("");
  const [defaultRationType, setDefaultRationType] = React.useState<
    RationType | ""
  >("");

  // 👇 start at min bookable week, but allow going backwards for viewing
  const [weekStart, setWeekStart] = React.useState<string>(minWeekStartISO);

  const draftKey = `${baseKey}:weekDraft:${weekStart}`;
  const [plan, setPlan] = React.useState<WeekPlan>(() =>
    buildDefaultWeek(minWeekStartISO),
  );

  const dayKeys = React.useMemo(
    () => Object.keys(plan.days).sort(),
    [plan.days],
  );

  // Week is read-only if it’s before booking window (2-week lead time)
  const readOnlyWeek = weekStart < minWeekStartISO;

  // Load identity
  React.useEffect(() => {
    try {
      setName(localStorage.getItem(nameKey) ?? "");
      setDefaultRationType(
        (localStorage.getItem(defaultRationKey) as any) ?? "",
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist identity
  React.useEffect(() => {
    try {
      if (name) localStorage.setItem(nameKey, name);
      else localStorage.removeItem(nameKey);
    } catch {}
  }, [name, nameKey]);

  React.useEffect(() => {
    try {
      if (defaultRationType)
        localStorage.setItem(defaultRationKey, defaultRationType);
      else localStorage.removeItem(defaultRationKey);
    } catch {}
  }, [defaultRationType, defaultRationKey]);

  // Load week draft when weekStart changes
  React.useEffect(() => {
    const raw = localStorage.getItem(draftKey);
    setPlan(normalizeOrRebuildDraft(raw, weekStart));
  }, [draftKey, weekStart]);

  // Persist week draft (still okay; drafts for past weeks are harmless)
  React.useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(plan));
    } catch {}
  }, [draftKey, plan]);

  const prevWeek = () => setWeekStart(nextWeekStartISO(weekStart, -1));
  const nextWeek = () => setWeekStart(nextWeekStartISO(weekStart, +1));

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
    try {
      localStorage.removeItem(draftKey);
    } catch {}
  };

  const selectedCount = React.useMemo(() => {
    let count = 0;
    for (const dateISO of Object.keys(plan.days)) {
      const day = plan.days[dateISO];
      if (!day.enabled) continue;
      if (isPastDateLocked(dateISO)) continue;
      for (const m of Object.keys(day.meals) as Meal[]) {
        if (day.meals[m]) count++;
      }
    }
    return count;
  }, [plan]);

  const canSubmit =
    !readOnlyWeek &&
    Boolean(name.trim()) &&
    Boolean(defaultRationType) &&
    selectedCount > 0;

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

      {/* Week nav */}
      <div className="flex items-center justify-between">
        <div className="font-medium">
          Week of {plan.weekStart} (Mon–Fri)
          <div className="text-xs opacity-70">
            Earliest editable week starts {minWeekStartISO} (2-week lead time)
            {readOnlyWeek ? (
              <span className="ml-2 text-xs font-medium">(Read-only)</span>
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

        <Button
          className="flex-1"
          disabled={!canSubmit}
          onClick={() => {
            console.log("SUBMIT PAYLOAD", {
              name: name.trim(),
              rationType: defaultRationType,
              weekStart: plan.weekStart,
              plan,
            });
          }}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}
