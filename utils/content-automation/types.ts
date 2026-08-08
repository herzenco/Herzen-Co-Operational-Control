export type AutomationJobType = "monthly_generation" | "weekly_review_pack" | "publish_day_notice" | "weekly_k2_refresh" | "audit_retry";

export type AuditResult = {
  provider: "manus" | "anthropic";
  seo_score: number;
  aeo_score: number;
  seo_explanation: string;
  aeo_explanation: string;
  passed: boolean;
  summary: string;
  blockers: string[];
  rewrite_guidance: string;
  model: string;
  rubric_version: string;
  trace_id: string;
  evaluated_at: string;
  raw_response?: Record<string, unknown>;
};

export type ModelTrace = {
  provider: "openai" | "anthropic";
  model: string;
  prompt_version: string;
  trace_id: string;
  provider_request_id: string | null;
  completed_at: string;
};

export type TracedGeneration<T> = { value: T; trace: ModelTrace };

export type PlannedTopic = {
  topic_key: string;
  title: string;
  rationale: string;
  timely: boolean;
  target_audience: string;
  conversion_goal: string;
  cta: string;
  publish_at: string;
  source_links: string[];
};

export type GeneratedAsset = {
  title: string;
  body: string;
  caption?: string;
  slug: string;
  seo_title: string;
  meta_description: string;
  reasoning_summary: string;
};

export type GenerationPair = { blog: GeneratedAsset; linkedin: GeneratedAsset };

export interface JsonModel {
  generate<T>(system: string, prompt: string): Promise<T>;
  generateTraced?<T>(system: string, prompt: string, promptVersion: string): Promise<TracedGeneration<T>>;
}

export interface Auditor {
  name: "manus" | "anthropic";
  audit(asset: GeneratedAsset, context: Record<string, unknown>): Promise<AuditResult>;
}

export type DeliveryItem = { title: string; review_url: string };
