// Everything in the app runs on Bangkok time (UTC+7, no daylight saving).
const OFFSET_MS = 7 * 60 * 60 * 1000;

export interface WeekTime {
  weekday: number; // 0 = Monday … 6 = Sunday
  hour: number;    // 0 … 23
  minute: number;  // 0 … 59
}

export function bangkokNow(date: Date = new Date()): WeekTime {
  const d = new Date(date.getTime() + OFFSET_MS);
  return {
    weekday: (d.getUTCDay() + 6) % 7,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** Slot index 0…167 for (weekday, hour). */
export const slotIndex = (weekday: number, hour: number) => weekday * 24 + hour;
