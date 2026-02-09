import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fromISO(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

export function toISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function startOfDayLocal(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfWeekMonday(date = new Date()) {
  const d = startOfDayLocal(date);
  const day = d.getDay(); // Sun=0..Sat=6
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function getMonFri(weekStartISO: string) {
  const monday = fromISO(weekStartISO);
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    out.push(toISO(d));
  }
  return out;
}
