export type CalendarRecord = Record<string, unknown>;

const NEW_YORK = "America/New_York";

function validTime(value: unknown) {
  if (!value) return null;
  const milliseconds = new Date(String(value)).getTime();
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

export function scheduledDateKey(value: unknown) {
  const milliseconds = validTime(value);
  if (milliseconds === null) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NEW_YORK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(milliseconds);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function compareByScheduledDate(left: CalendarRecord, right: CalendarRecord) {
  const leftTime = validTime(left.publish_at);
  const rightTime = validTime(right.publish_at);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime;
  if (leftTime !== null) return -1;
  if (rightTime !== null) return 1;
  const createdComparison = String(left.created_at || "").localeCompare(String(right.created_at || ""));
  return createdComparison || String(left.id || "").localeCompare(String(right.id || ""));
}

export function scheduledDateLabel(value: unknown, includeTime = true) {
  const milliseconds = validTime(value);
  if (milliseconds === null) return "Unscheduled";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(milliseconds);
}

export type ApprovalEligibility = "actionable" | "overdue" | "future" | "inactive";

export function approvalEligibility(
  approval: CalendarRecord,
  contentById: Map<string, CalendarRecord>,
  now = new Date(),
  windowDays = 7,
): ApprovalEligibility {
  if (String(approval.status || "pending") !== "pending") return "inactive";
  const contentItemId = String(approval.content_item_id || "");
  const linkedContent = contentItemId ? contentById.get(contentItemId) : undefined;
  if (contentItemId && !linkedContent) return "inactive";
  if (linkedContent && String(linkedContent.status) === "cancelled") return "inactive";
  const scheduledAt = linkedContent ? linkedContent.publish_at : approval.due_at;
  const scheduledKey = scheduledDateKey(scheduledAt);
  const todayKey = scheduledDateKey(now);
  if (!scheduledKey || !todayKey) return "inactive";
  if (scheduledKey < todayKey) return "overdue";
  return scheduledKey <= addCalendarDays(todayKey, windowDays) ? "actionable" : "future";
}

export function approvalScheduledAt(approval: CalendarRecord, contentById: Map<string, CalendarRecord>) {
  const contentItemId = String(approval.content_item_id || "");
  return contentItemId ? contentById.get(contentItemId)?.publish_at : approval.due_at;
}
