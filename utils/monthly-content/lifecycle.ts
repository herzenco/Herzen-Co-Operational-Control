export const MONTHLY_CONTENT_STAGES = [
  "planned", "research_pending", "research_ready", "editorial_ready", "drafting",
  "qa_in_progress", "revision_required", "ready_for_lupe", "ready_for_tito",
  "approved", "scheduled", "published", "performance_tracking", "completed",
] as const;

export const MONTHLY_CONTENT_EXCEPTIONS = [
  "blocked", "recovery_required", "rejected", "cancelled", "archived", "superseded",
] as const;

export type MonthlyContentStage = typeof MONTHLY_CONTENT_STAGES[number];
export type MonthlyContentStatus = MonthlyContentStage | typeof MONTHLY_CONTENT_EXCEPTIONS[number];

export const AUTOMATED_NEXT: Partial<Record<MonthlyContentStatus, MonthlyContentStatus>> = {
  planned: "research_pending",
  research_pending: "research_ready",
  research_ready: "editorial_ready",
  editorial_ready: "drafting",
  drafting: "qa_in_progress",
  qa_in_progress: "ready_for_lupe",
  revision_required: "drafting",
};

export const OWNER_BY_STAGE: Partial<Record<MonthlyContentStatus, "K2" | "C-3PO" | "OpenAI" | "Anthropic" | "Lupe" | "Tito">> = {
  planned: "K2", research_pending: "K2", research_ready: "C-3PO", editorial_ready: "OpenAI",
  drafting: "OpenAI", qa_in_progress: "Anthropic", revision_required: "OpenAI",
  ready_for_lupe: "Lupe", ready_for_tito: "Tito",
};

export function assertTransition(from: MonthlyContentStatus, to: MonthlyContentStatus) {
  if (MONTHLY_CONTENT_EXCEPTIONS.includes(to as never)) return;
  const expected = AUTOMATED_NEXT[from];
  const human = from === "ready_for_lupe" && to === "ready_for_tito"
    || from === "ready_for_lupe" && to === "revision_required"
    || from === "qa_in_progress" && to === "revision_required"
    || from === "ready_for_tito" && ["approved", "revision_required", "rejected"].includes(to)
    || from === "approved" && to === "scheduled"
    || from === "scheduled" && to === "published"
    || from === "published" && to === "performance_tracking"
    || from === "performance_tracking" && to === "completed";
  if (expected !== to && !human) throw new Error(`Invalid Monthly Content Operations transition: ${from} -> ${to}.`);
}

export function stageIdempotencyKey(contentItemId: string, stage: MonthlyContentStatus, revision: number) {
  return `monthly-content:v2:${contentItemId}:${stage}:r${revision}`;
}

export function isStale(lastActivity: string | null | undefined, now = new Date(), minutes = 30) {
  return !lastActivity || now.getTime() - new Date(lastActivity).getTime() > minutes * 60_000;
}
