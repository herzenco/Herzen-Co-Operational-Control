import type { AutomationJobType } from "./types";

const ZONE = "America/New_York";

function etParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function isLastMonday(date: Date) {
  const parts = etParts(date);
  if (parts.weekday !== "Mon") return false;
  const day = Number(parts.day);
  const month = Number(parts.month);
  const year = Number(parts.year);
  return new Date(Date.UTC(year, month - 1, day + 7)).getUTCMonth() !== month - 1;
}

export function nextMonthStart(date: Date) {
  const parts = etParts(date);
  return `${Number(parts.month) === 12 ? Number(parts.year) + 1 : parts.year}-${String((Number(parts.month) % 12) + 1).padStart(2, "0")}-01`;
}

export function shouldRun(jobType: AutomationJobType, date: Date) {
  const parts = etParts(date);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (jobType === "monthly_generation") return isLastMonday(date) && hour === 9;
  if (jobType === "weekly_review_pack") return parts.weekday === "Mon" && hour === 9;
  if (jobType === "publish_day_notice") return hour === 8;
  if (jobType === "weekly_k2_refresh") return parts.weekday === "Mon" && hour === 7;
  return minute % 15 === 0;
}

export function nextScheduledAt(jobType: AutomationJobType, from: Date) {
  const cursor = new Date(from.getTime() + 60_000);
  cursor.setUTCSeconds(0, 0);
  for (let index = 0; index < 60 * 24 * 40; index += 1) {
    if (shouldRun(jobType, cursor)) return cursor.toISOString();
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error(`Could not calculate the next ${jobType} run.`);
}

export const automationTimeZone = ZONE;

