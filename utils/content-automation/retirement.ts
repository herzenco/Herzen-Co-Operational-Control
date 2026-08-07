import type { AutomationJobType } from "./types";

export const MONTHLY_CONTENT_OPERATIONS_REQUEST_ID = "REQ-20260807-083244-monthly-content-operations-replacement";
export const MONTHLY_CONTENT_OPERATIONS_NAME = "Herzen Co. Monthly Content Operations";
export const MONTHLY_CONTENT_OPERATIONS_FLAG = "OCC_MONTHLY_CONTENT_OPERATIONS_ENABLED";

export const legacyContentAutomationJobTypes = [
  "monthly_generation",
  "weekly_review_pack",
  "publish_day_notice",
  "weekly_k2_refresh",
  "audit_retry",
] as const satisfies readonly AutomationJobType[];

export type LegacyAutomationSource =
  | "cron_route"
  | "manual_route"
  | "runner"
  | "whatsapp_delivery"
  | "website_publication"
  | "linkedin_publication";

export function monthlyContentOperationsEnabled(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
) {
  return String(env[MONTHLY_CONTENT_OPERATIONS_FLAG] || "").trim().toLowerCase() === "true";
}

export function isLegacyContentAutomationJobType(value: string): value is AutomationJobType {
  return (legacyContentAutomationJobTypes as readonly string[]).includes(value);
}

export function monthlyContentOperationsDisabledMessage(source: LegacyAutomationSource, jobType?: string) {
  const suffix = jobType ? ` Job: ${jobType}.` : "";
  if (source === "whatsapp_delivery") {
    return `OCC direct WhatsApp delivery is retired. Use Lupe's WhatsApp lane outside OCC.${suffix}`;
  }
  if (source === "website_publication" || source === "linkedin_publication") {
    return `${MONTHLY_CONTENT_OPERATIONS_NAME} is not activated yet, so OCC publication claims are disabled for Herzen Co.${suffix}`;
  }
  return `${MONTHLY_CONTENT_OPERATIONS_NAME} is the only future-state content system. The legacy OCC content-automation execution paths are disabled until the new workflow is fully implemented and activated.${suffix}`;
}

export function disabledAutomationResult(source: LegacyAutomationSource, jobType?: string) {
  return {
    code: "monthly_content_operations_not_activated",
    request_id: MONTHLY_CONTENT_OPERATIONS_REQUEST_ID,
    replacement: MONTHLY_CONTENT_OPERATIONS_NAME,
    source,
    job_type: jobType || null,
    activation_flag: MONTHLY_CONTENT_OPERATIONS_FLAG,
    message: monthlyContentOperationsDisabledMessage(source, jobType),
  };
}

export class LegacyContentAutomationDisabledError extends Error {
  code = "monthly_content_operations_not_activated";
  status = 409;
  result: ReturnType<typeof disabledAutomationResult>;

  constructor(source: LegacyAutomationSource, jobType?: string) {
    const result = disabledAutomationResult(source, jobType);
    super(result.message);
    this.name = "LegacyContentAutomationDisabledError";
    this.result = result;
  }
}

export function shouldBlockHerzenCoContentOperation(propertySlug: string | null | undefined) {
  return !monthlyContentOperationsEnabled() && String(propertySlug || "").trim().toLowerCase() === "herzen-co";
}
