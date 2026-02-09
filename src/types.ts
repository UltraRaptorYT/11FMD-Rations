export type Meal = "B" | "L" | "D";

export type RationType = "nm" | "m" | "nmsd" | "vi" | "vc";

export type DayPlan = {
  enabled: boolean;
  meals: Record<Meal, boolean>;
};

export type WeekPlan = {
  weekStart: string;
  days: Record<string, DayPlan>;
};

export type AddRationBody = {
  name: string;
  rationType: RationType;
  weekStart: string;
  plan: WeekPlan;
};
